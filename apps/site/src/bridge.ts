import { z } from "zod";
import {
  ActionSchema,
  DeploymentSchema,
  DeviceProfileSchema,
  RecommendationSchema,
  type ChatInput,
} from "../../../packages/protocol/index.ts";

export const BRIDGE_URL = "http://127.0.0.1:31415";
export const SESSION_KEY = "canirunai:bridge-session:v1";
const SessionSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().finite(),
});
export type Session = z.infer<typeof SessionSchema>;
export const BridgeStatusSchema = z.object({
  device: DeviceProfileSchema,
  runtime: z.object({ available: z.boolean(), version: z.string().nullable() }),
  installed: z.array(
    z.object({
      modelId: z.string(),
      tag: z.string().optional(),
      bytes: z.number(),
    }),
  ),
  running: z.array(
    z.object({
      modelId: z.string().nullable(),
      tag: z.string(),
      context: z.number(),
      memoryGB: z.number(),
    }),
  ),
  deployments: z.array(DeploymentSchema),
  recommendations: z.array(RecommendationSchema),
  busy: z.boolean(),
});
export type BridgeStatus = z.infer<typeof BridgeStatusSchema>;
export type BridgeAction = z.infer<typeof ActionSchema>;

export class BridgeError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export function restoreSession(
  storage: Pick<Storage, "getItem"> | undefined,
): Session | null {
  try {
    const parsed = SessionSchema.safeParse(
      JSON.parse(storage?.getItem(SESSION_KEY) ?? "null"),
    );
    return parsed.success && parsed.data.expiresAt > Date.now()
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
export function takePairCode(
  location: { hash: string; pathname: string; search: string },
  replace: (url: string) => void,
) {
  if (!location.hash.startsWith("#pair=")) return null;
  const code = new URLSearchParams(location.hash.slice(1)).get("pair");
  replace(location.pathname + location.search);
  if (!code || !/^\d{8}$/.test(code))
    throw new BridgeError("配对链接无效，请输入助手终端显示的 8 位配对码。");
  return code;
}

export class BridgeClient {
  private session: Session | null = null;
  private controller = new AbortController();
  private rotation: Promise<void> | null = null;
  private requests = new Set<Promise<Response>>();
  constructor(
    private readonly onSession: (session: Session | null) => void = () => {},
    private readonly fetcher: typeof fetch = (input, init) =>
      globalThis.fetch(input, init),
    private readonly base = BRIDGE_URL,
  ) {}
  get authenticated() {
    return !!this.session && this.session.expiresAt > Date.now();
  }
  get expiresAt() {
    return this.session?.expiresAt ?? 0;
  }
  restore(session: Session) {
    this.session = session;
  }
  cancel() {
    this.controller.abort();
    this.controller = new AbortController();
    this.rotation = null;
    this.requests.clear();
  }
  clear() {
    this.cancel();
    this.session = null;
    this.onSession(null);
  }
  private async request(
    path: string,
    body?: unknown,
    auth = true,
    signal?: AbortSignal,
    timeout = 30_000,
  ) {
    const controller = this.controller;
    if (auth && this.rotation) await this.rotation;
    controller.signal.throwIfAborted();
    signal?.throwIfAborted();
    const request = this.send(path, body, auth, signal, timeout);
    if (auth) this.requests.add(request);
    try {
      return await request;
    } finally {
      this.requests.delete(request);
    }
  }
  private async send(
    path: string,
    body?: unknown,
    auth = true,
    signal?: AbortSignal,
    timeout = 30_000,
  ) {
    const controller = this.controller;
    const token = this.session?.token;
    if (auth && !this.authenticated) {
      this.clear();
      throw new BridgeError("连接授权已过期，请重新配对。", 401);
    }
    let response: Response;
    try {
      response = await this.fetcher(this.base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(timeout),
          ...(signal ? [signal] : []),
        ]),
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (error) {
      if (controller.signal.aborted || signal?.aborted)
        throw new DOMException("已取消连接或操作", "AbortError");
      throw new BridgeError(
        "无法连接本地助手。请确认助手仍在运行、浏览器允许访问本地网络，并使用本页下载的新版助手。超时的操作可能仍在本机继续，请重新连接查看进度。",
      );
    }
    controller.signal.throwIfAborted();
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      if (response.status === 401 && token === this.session?.token && auth)
        this.clear();
      throw new BridgeError(
        response.status === 401 && auth
          ? "连接授权已过期，请重新配对。"
          : (data?.error?.message ?? "本地助手请求失败"),
        response.status,
      );
    }
    return response;
  }
  async probe() {
    const response = await this.request("/health", undefined, false);
    const health = await response.json();
    if (health.name !== "CanIRunAI Bridge" || health.protocol !== 1)
      throw new BridgeError("助手版本不兼容，请下载本页提供的新版助手。");
  }
  async pair(code: string) {
    if (!/^\d{8}$/.test(code)) throw new BridgeError("请输入 8 位数字配对码。");
    this.clear();
    const controller = this.controller;
    const challenge = await (
      await this.request("/challenge", {}, false)
    ).json();
    const session = SessionSchema.parse(
      await (
        await this.request(
          "/pair",
          { challenge: challenge.challenge, code },
          false,
        )
      ).json(),
    );
    controller.signal.throwIfAborted();
    this.session = session;
    this.onSession(session);
  }
  async status() {
    return BridgeStatusSchema.parse(
      await (await this.request("/status")).json(),
    );
  }
  rotate() {
    if (this.rotation) return this.rotation;
    const controller = this.controller;
    const task = (async () => {
      // Old-token requests must pass authentication before the server revokes it.
      await Promise.allSettled([...this.requests]);
      controller.signal.throwIfAborted();
      const session = SessionSchema.parse(
        await (await this.send("/session/rotate", {})).json(),
      );
      controller.signal.throwIfAborted();
      this.session = session;
      this.onSession(session);
    })();
    this.rotation = task;
    const finish = () => {
      if (this.rotation === task) this.rotation = null;
    };
    void task.then(finish, finish);
    return task;
  }
  async disconnect() {
    const token = this.session?.token;
    this.clear();
    if (token)
      await this.fetcher(this.base + "/session/revoke", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(5000),
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }).catch(() => {});
  }
  async action(action: BridgeAction) {
    const response = await this.request(
      "/action",
      ActionSchema.parse(action),
      true,
      undefined,
      660_000,
    );
    return (await response.json()).result as unknown;
  }
  async chat(
    input: ChatInput,
    signal: AbortSignal,
    onText: (text: string) => void,
  ) {
    const response = await this.request(
      "/v1/chat/completions",
      input,
      true,
      signal,
      660_000,
    );
    if (!response.body) throw new BridgeError("助手没有返回对话内容。");
    await readChatStream(response.body, onText, signal);
  }
}

export async function readChatStream(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  signal?: AbortSignal,
) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    answer = "",
    doneEvent = false;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  function event(block: string) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") {
      doneEvent = true;
      return;
    }
    const chunk = JSON.parse(data);
    if (chunk.error)
      throw new BridgeError(chunk.error.message ?? "本地推理失败");
    const content = chunk.choices?.[0]?.delta?.content;
    if (typeof content === "string") {
      answer += content;
      onText(answer);
    }
  }
  try {
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        event(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
      if (done) {
        if (buffer.trim()) event(buffer);
        break;
      }
    }
    if (!doneEvent)
      throw new BridgeError(
        "对话连接意外中断，请重试；已收到的文字保留在本页。",
      );
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
