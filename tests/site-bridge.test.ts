import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridge } from "../apps/bridge/server.ts";
import { getModel } from "../packages/model-registry/index.ts";
import type { DeviceProfile } from "../packages/protocol/index.ts";
import {
  BridgeClient,
  BridgeError,
  SESSION_KEY,
  readChatStream,
  restoreSession,
  takePairCode,
  type Session,
} from "../apps/site/src/bridge.ts";

const origin = "https://sggg221.github.io";
const fakeMac: DeviceProfile = {
  os: "darwin",
  osVersion: "test",
  architecture: "arm64",
  supported: true,
  model: "Explicit test fixture, not real hardware",
  chip: "Test chip",
  cpuCores: 8,
  gpuCores: 8,
  memoryGB: 16,
  freeMemoryGB: 12,
  diskFreeGB: 100,
  metal: "Test",
  neuralEngine: null,
  bandwidthGBs: null,
  powerMode: null,
};

const fakeWindows: DeviceProfile = {
  ...fakeMac, os: "win32", osVersion: "10.0.22631", architecture: "x64",
  model: "Explicit Windows test fixture, not real hardware", metal: null, gpuCores: null,
  gpus: [{ name: "TEST NVIDIA GPU", vendor: "nvidia", memoryGB: 24, freeMemoryGB: 20, source: "nvidia-smi" }],
  gpuDetectionComplete: true,
};

for (const fakeDevice of [fakeMac, fakeWindows])
test(`site bridge (${fakeDevice.os} fixture): real HTTP pairing, deployment, chat, rotation and revocation`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-site-bridge-"));
  const nativeFetch = globalThis.fetch;
  const bridge = await createBridge({
    dataDir: dir,
    port: 31421,
    pairCode: "12345678",
  });
  await new Promise<void>((resolve, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(31421, "127.0.0.1", resolve);
  });
  bridge.manager.device = async () => fakeDevice;
  const model = getModel("qwen3-0.6b"),
    variant = model.variants[0];
  let installed = false,
    running = false,
    pulled = false,
    chatCalls = 0;
  globalThis.fetch = async (address, init) => {
    const url = String(address);
    if (!url.startsWith("http://127.0.0.1:11434/"))
      return nativeFetch(address, init);
    if (url.endsWith("/api/version"))
      return Response.json({ version: "0.33.3" });
    if (url.endsWith("/api/tags"))
      return Response.json({
        models: installed
          ? [{ name: variant.tag, digest: variant.digest, size: variant.bytes }]
          : [],
      });
    if (url.endsWith("/api/ps"))
      return Response.json({
        models: running
          ? [{ name: variant.tag, size_vram: 2e9, context_length: 8192 }]
          : [],
      });
    if (url.endsWith("/api/pull")) {
      pulled = true;
      installed = true;
      return new Response(
        JSON.stringify({
          digest: variant.modelDigest,
          total: variant.bytes,
          completed: variant.bytes,
        }) + "\n",
      );
    }
    if (url.endsWith("/api/generate")) {
      running = JSON.parse(String(init?.body)).keep_alive !== 0;
      return Response.json({ done: true });
    }
    if (url.endsWith("/api/chat")) {
      chatCalls++;
      assert.equal(JSON.parse(String(init?.body)).model, variant.tag);
      return new Response(
        JSON.stringify({
          message: { content: "真实 HTTP 链路的模拟推理回复。" },
          done: true,
        }) + "\n",
      );
    }
    throw new Error(`Unexpected runtime request ${url}`);
  };
  let saved: Session | null = null;
  const client = new BridgeClient(
    (session) => {
      saved = session;
    },
    (url, init) =>
      nativeFetch(url, {
        ...init,
        headers: { ...init?.headers, Origin: origin },
      }),
    "http://127.0.0.1:31421",
  );
  try {
    await client.probe();
    await assert.rejects(client.status(), (e: BridgeError) => e.status === 401);
    await assert.rejects(client.pair("1234"), /8 位/);
    await assert.rejects(
      client.pair("00000000"),
      (e: BridgeError) => e.status === 401,
    );
    await client.pair("12345678");
    assert.equal(client.authenticated, true);
    const paired = saved as Session | null;
    assert.ok(paired);
    const status = await client.status();
    assert.equal(status.device.model, fakeDevice.model);
    assert.deepEqual(status.device.gpus, fakeDevice.gpus);
    assert.equal(status.runtime.version, "0.33.3");
    assert.equal(status.installed.length, 0);
    await assert.rejects(
      client.action({ action: "install_runtime", confirmed: false } as never),
    );
    assert.equal(pulled, false);
    await client.action({ action: "deploy", model_id: model.id });
    for (let i = 0; bridge.manager.busy && i < 100; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const deployed = await client.status();
    assert.equal(pulled, true);
    assert.equal(deployed.deployments[0].stage, "running");
    assert.equal(deployed.deployments[0].plan.backend, fakeDevice.os === "win32" ? "auto" : "metal");
    assert.equal(deployed.deployments[0].download.completed, variant.bytes);
    assert.ok(deployed.running.some((m) => m.modelId === model.id));
    let answer = "";
    await client.chat(
      {
        model: model.id,
        messages: [{ role: "user", content: "你好" }],
        stream: true,
        max_tokens: 100,
        temperature: 0.7,
      },
      new AbortController().signal,
      (text) => {
        answer = text;
      },
    );
    assert.equal(answer, "真实 HTTP 链路的模拟推理回复。");
    assert.equal(chatCalls, 1);
    await client.rotate();
    assert.notEqual((saved as Session | null)?.token, paired.token);
    const old = await nativeFetch("http://127.0.0.1:31421/status", {
      headers: { Origin: origin, Authorization: `Bearer ${paired.token}` },
    });
    assert.equal(old.status, 401);
    const wrongOrigin = await nativeFetch("http://127.0.0.1:31421/status", {
      headers: {
        Origin: "http://localhost:3000",
        Authorization: `Bearer ${(saved as Session | null)?.token}`,
      },
    });
    assert.equal(wrongOrigin.status, 401);
    await client.action({ action: "stop_model", model_id: model.id });
    assert.equal((await client.status()).running.length, 0);
    const token = (saved as Session | null)!.token;
    await client.disconnect();
    assert.equal(saved, null);
    assert.equal(client.authenticated, false);
    assert.equal(
      (
        await nativeFetch("http://127.0.0.1:31421/status", {
          headers: { Origin: origin, Authorization: `Bearer ${token}` },
        })
      ).status,
      401,
    );
  } finally {
    client.clear();
    globalThis.fetch = nativeFetch;
    bridge.server.closeAllConnections();
    await new Promise<void>((resolve) => bridge.server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("site bridge: session storage is optional, validated and expires", () => {
  const good = { token: "a".repeat(64), expiresAt: Date.now() + 60_000 };
  assert.deepEqual(
    restoreSession({
      getItem: (key) => {
        assert.equal(key, SESSION_KEY);
        return JSON.stringify(good);
      },
    }),
    good,
  );
  assert.equal(restoreSession(undefined), null);
  assert.equal(
    restoreSession({
      getItem() {
        throw new Error("storage denied");
      },
    }),
    null,
  );
  for (const value of [
    "not json",
    JSON.stringify({ ...good, expiresAt: 1 }),
    JSON.stringify({ token: "invalid", expiresAt: good.expiresAt }),
  ])
    assert.equal(restoreSession({ getItem: () => value }), null);
});

test("site bridge: pairing code fragments are consumed without forwarding or persisting them", () => {
  let replaced = "";
  assert.equal(
    takePairCode(
      { pathname: "/CanIRunAI/", search: "", hash: "#pair=12345678" },
      (url) => {
        replaced = url;
      },
    ),
    "12345678",
  );
  assert.equal(replaced, "/CanIRunAI/");
  assert.equal(
    takePairCode({ pathname: "/", search: "", hash: "#config?memory=16" }, () =>
      assert.fail(),
    ),
    null,
  );
  assert.throws(
    () =>
      takePairCode({ pathname: "/", search: "", hash: "#pair=bad" }, (url) => {
        replaced = url;
      }),
    /无效/,
  );
  assert.equal(replaced, "/");
});

function fragmented(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
}
test("site bridge: SSE parser handles fragmented UTF-8 and CRLF, and rejects errors or truncated replies", async () => {
  let result = "";
  await readChatStream(
    fragmented(
      ': keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"你好🌱"}}]}\r\n\r\ndata: [DONE]\r\n\r\n',
    ),
    (text) => {
      result = text;
    },
  );
  assert.equal(result, "你好🌱");
  await assert.rejects(
    readChatStream(
      fragmented('data: {"error":{"message":"runtime failed"}}\n\n'),
      () => {},
    ),
    /runtime failed/,
  );
  await assert.rejects(
    readChatStream(fragmented('data: {"choices":[]}\n\n'), () => {}),
    /意外中断/,
  );
  let cancelled = false;
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const reading = readChatStream(stream, () => {}, abort.signal);
  abort.abort();
  await assert.rejects(reading, { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("site bridge: disconnect aborts pending reads and late pairing cannot restore authorization", async () => {
  let release!: () => void,
    saved: Session | null = null;
  const client = new BridgeClient(
    (session) => {
      saved = session;
    },
    async (url) => {
      if (String(url).endsWith("/challenge"))
        return Response.json({ challenge: "a".repeat(48) });
      if (String(url).endsWith("/pair")) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return Response.json({
          token: "b".repeat(64),
          expiresAt: Date.now() + 60_000,
        });
      }
      throw new Error(String(url));
    },
  );
  const pending = client.pair("12345678");
  for (let i = 0; !release && i < 10; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  await client.disconnect();
  release();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(saved, null);
  assert.equal(client.authenticated, false);
});
