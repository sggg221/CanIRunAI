import http from "node:http";
import { randomBytes, randomInt, timingSafeEqual, createHmac } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ActionSchema,
  PairSchema,
  ChatSchema,
  MAX_CHAT_BODY_BYTES,
} from "../../packages/protocol/index.ts";
import { getModel } from "../../packages/model-registry/index.ts";
import { runtime } from "../../packages/runtime-registry/index.ts";
import { Manager, LocalFailure } from "./manager.ts";
import { toOllamaMessages } from "./chat.ts";
import { ZodError } from "zod";
import { OLLAMA } from "./runtime.ts";
const ORIGINS = new Set(["http://localhost:3000", "https://canirun.ai"]);
export function allowedOrigin(origin: string | undefined) {
  return !!origin && ORIGINS.has(origin);
}
export function allowedHost(host: string | undefined, port: number) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
export async function createBridge(options: {
  dataDir: string;
  port?: number;
  pairCode?: string;
  onPairCode?: (code: string) => void;
}) {
  const port = options.port ?? 31415;
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const secretPath = path.join(options.dataDir, "secret");
  let secret: Buffer;
  try {
    secret = await readFile(secretPath);
  } catch {
    secret = randomBytes(32);
    await writeFile(secretPath, secret, { mode: 0o600 });
  }
  const manager = new Manager(options.dataDir);
  await manager.init();
  let pairCode = options.pairCode ?? String(randomInt(10000000, 100000000)),
    codeExpires = Date.now() + 600000;
  const sessions = new Map<string, { origin: string; expires: number }>(),
    challenges = new Map<string, { origin: string; expires: number }>(),
    limits = new Map<string, { count: number; reset: number }>();
  const freshCode = () => {
    pairCode = String(randomInt(10000000, 100000000));
    codeExpires = Date.now() + 600000;
    options.onPairCode?.(pairCode);
  };
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
    for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
    for (const [k, v] of limits) if (v.reset < now) limits.delete(k);
    if (now > codeExpires) freshCode();
  }, 60000);
  sweep.unref();
  function mint(origin: string) {
    const token = createHmac("sha256", secret).update(randomBytes(32)).digest("hex");
    const expires = Date.now() + 900000;
    sessions.set(token, { origin, expires });
    return { token, expiresAt: expires };
  }
  function rate(key: string, max: number) {
    const now = Date.now();
    const v = limits.get(key);
    if (!v || v.reset < now) {
      limits.set(key, { count: 1, reset: now + 60000 });
      return true;
    }
    return ++v.count <= max;
  }
  async function body(req: http.IncomingMessage, limit = 256000) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new Error("请求内容过大，请减少图片数量或尺寸。");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, data: unknown) => {
      if (res.writableEnded) return;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Origin");
    try {
      const origin = req.headers.origin,
        url = (req.url ?? "").split("?")[0];
      if (!allowedHost(req.headers.host, port))
        return reply(403, { error: { message: "Host rejected" } });
      if (!allowedOrigin(origin)) return reply(403, { error: { message: "Origin rejected" } });
      res.setHeader("Access-Control-Allow-Origin", origin!);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      if (!rate(origin! + ":all", 300))
        return reply(429, { error: { message: "Too many requests" } });
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      if (url === "/health" && req.method === "GET")
        return reply(200, {
          name: "CanIRunAI Bridge",
          version: "0.2.0",
          protocol: 1,
          capabilities: ["vision_chat"],
        });
      if (url === "/challenge" && req.method === "POST") {
        if (!rate(origin! + ":challenge", 10))
          return reply(429, { error: { message: "Please wait before pairing again" } });
        const challenge = randomBytes(24).toString("hex");
        challenges.set(challenge, { origin: origin!, expires: Date.now() + 60000 });
        return reply(200, { challenge });
      }
      if (url === "/pair" && req.method === "POST") {
        if (!rate(origin! + ":pair", 5))
          return reply(429, {
            error: { message: "Too many pairing attempts. Try again in a minute." },
          });
        const input = PairSchema.parse(await body(req)),
          c = challenges.get(input.challenge);
        challenges.delete(input.challenge);
        if (
          !c ||
          c.origin !== origin ||
          c.expires < Date.now() ||
          codeExpires < Date.now() ||
          !timingSafeEqual(Buffer.from(input.code), Buffer.from(pairCode))
        )
          return reply(401, { error: { message: "Invalid or expired pairing code" } });
        const session = mint(origin!);
        freshCode();
        return reply(200, session);
      }
      const token = req.headers.authorization?.replace(/^Bearer /, ""),
        session = token ? sessions.get(token) : undefined;
      if (!session || session.origin !== origin || session.expires < Date.now())
        return reply(401, { error: { message: "Pair with this Bridge to continue" } });
      if (url === "/session/rotate" && req.method === "POST") {
        sessions.delete(token!);
        return reply(200, mint(origin!));
      }
      if (url === "/session/revoke" && req.method === "POST") {
        sessions.delete(token!);
        return reply(200, { ok: true });
      }
      if (url === "/system" && req.method === "GET") return reply(200, await manager.device());
      if (url === "/status" && req.method === "GET") return reply(200, await manager.status());
      if (url === "/runtime" && req.method === "GET") return reply(200, runtime);
      if (url === "/models" && req.method === "GET") return reply(200, await manager.installed());
      if (url === "/v1/models" && ["GET", "POST"].includes(req.method!))
        return reply(200, {
          object: "list",
          data: (await manager.installed()).map((m) => ({
            id: m.modelId,
            object: "model",
            owned_by: "local",
          })),
        });
      if (url === "/action" && req.method === "POST") {
        const a = ActionSchema.parse(await body(req));
        let result: unknown;
        switch (a.action) {
          case "detect_hardware":
            result = await manager.device();
            break;
          case "list_models":
            result = await manager.installed();
            break;
          case "install_runtime":
            result = await manager.install();
            break;
          case "deploy":
            result = await manager.deploy(a.model_id, a.context_length, a.switch_confirmed);
            break;
          case "start_model":
            result = await manager.deploy(a.model_id, undefined, a.switch_confirmed);
            break;
          case "restart_model":
            if (manager.busy || manager.chatBusy)
              throw new LocalFailure("busy", "Wait for the current operation.", "none");
            await manager.stop(a.model_id);
            result = await manager.deploy(a.model_id, undefined, a.switch_confirmed);
            break;
          case "stop_model":
            if (manager.busy)
              throw new LocalFailure("busy", "Wait for deployment to finish.", "none");
            result = await manager.stop(a.model_id);
            break;
          case "delete_model":
            result = await manager.remove(a.model_id);
            break;
          case "benchmark_model":
            result = await manager.benchmark(a.model_id);
            break;
          case "pause_download":
            result = await manager.pause(a.deployment_id);
            break;
          case "cancel_deployment":
            result = await manager.pause(a.deployment_id, true);
            break;
          case "resume_download":
          case "retry_deployment":
            result = await manager.resume(a.deployment_id);
            break;
        }
        return reply(200, { ok: true, result });
      }
      if (url === "/v1/chat/completions" && req.method === "POST") {
        const input = ChatSchema.parse(await body(req, MAX_CHAT_BODY_BYTES)),
          model = getModel(input.model);
        const runtimeMessages = toOllamaMessages(input, model);
        if (manager.chatBusy || manager.busy)
          throw new LocalFailure("busy", "Another model operation is in progress.", "none");
        if (!(await manager.installed()).some((m) => m.modelId === model.id))
          throw new Error("Deploy the verified model first");
        if (!(await manager.running()).some((m: any) => m.modelId === model.id))
          throw new Error("Start this model before chatting");
        manager.chatBusy = true;
        const controller = new AbortController();
        res.on("close", () => controller.abort());
        try {
          const d = manager.deployments.find(
            (d) => d.modelId === model.id && d.stage === "running",
          );
          const result = await fetch(OLLAMA + "/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: model.variants[0].tag,
              messages: runtimeMessages,
              stream: input.stream,
              think: false,
              keep_alive: "30m",
              options: {
                num_ctx: d?.plan.context ?? 4096,
                num_predict: input.max_tokens,
                temperature: input.temperature,
              },
            }),
            signal: controller.signal,
          });
          if (!result.ok) throw new Error((await result.text()).slice(0, 500));
          const id = "chatcmpl-" + randomBytes(12).toString("hex"),
            created = Math.floor(Date.now() / 1000);
          if (!input.stream) {
            const out: any = await result.json();
            if (out.error) throw new Error(out.error);
            return reply(200, {
              id,
              object: "chat.completion",
              created,
              model: input.model,
              choices: [{ index: 0, message: out.message, finish_reason: "stop" }],
              usage: {
                prompt_tokens: out.prompt_eval_count,
                completion_tokens: out.eval_count,
                total_tokens: (out.prompt_eval_count ?? 0) + (out.eval_count ?? 0),
              },
            });
          }
          res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
          const reader = result.body!.getReader(),
            decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let n;
            while ((n = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, n);
              buffer = buffer.slice(n + 1);
              if (!line.trim()) continue;
              const out = JSON.parse(line);
              if (out.error) throw new Error(out.error);
              res.write(
                `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: input.model, choices: [{ index: 0, delta: { content: out.message?.content ?? "" }, finish_reason: out.done ? "stop" : null }] })}\n\n`,
              );
            }
          }
          res.end("data: [DONE]\n\n");
        } catch (e) {
          if (res.headersSent) {
            if (!res.writableEnded)
              res.end(
                `data: ${JSON.stringify({ error: { message: e instanceof Error ? e.message : "Inference failed" } })}\n\n`,
              );
          } else throw e;
        } finally {
          manager.chatBusy = false;
        }
        return;
      }
      reply(404, { error: { message: "Unknown endpoint" } });
    } catch (e) {
      if (e instanceof LocalFailure)
        return reply(409, { error: { code: e.code, message: e.message, fix: e.fix } });
      reply(400, {
        error: {
          message:
            e instanceof ZodError
              ? e.issues[0]?.message
              : e instanceof Error
                ? e.message
                : "Invalid request",
        },
      });
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 10000;
  server.on("close", () => clearInterval(sweep));
  return { server, manager, port, getPairCode: () => pairCode };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir =
    process.env.CANIRUN_DATA_DIR ??
    path.join(os.homedir(), "Library", "Application Support", "CanIRunAI");
  const show = (code: string) =>
    console.log(`\nCanIRunAI local pairing code: ${code} (valid 10 minutes)\n`);
  const bridge = await createBridge({ dataDir, onPairCode: show });
  bridge.server.listen(bridge.port, "127.0.0.1", () => {
    console.log(`CanIRunAI Bridge → http://127.0.0.1:${bridge.port}`);
    show(bridge.getPairCode());
  });
  bridge.server.on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  });
  process.on("SIGTERM", () => bridge.server.close(() => process.exit(0)));
  process.on("SIGINT", () => bridge.server.close(() => process.exit(0)));
}
