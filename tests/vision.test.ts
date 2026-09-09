import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatSchema, MAX_IMAGE_BYTES } from "../packages/protocol/index.ts";
import { getModel } from "../packages/model-registry/index.ts";
import { decodeImage, toOllamaMessages } from "../apps/bridge/chat.ts";
import { createBridge } from "../apps/bridge/server.ts";
import { toWireMessages, type ChatMessage } from "../apps/web/lib/chat-images.ts";
const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=",
  url = "data:image/png;base64," + base64;
const image = (value = url) => ({ type: "image_url" as const, image_url: { url: value } });
function input(model = "gemma3-4b") {
  return {
    model,
    messages: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "图片里是什么？" }, image()],
      },
    ],
    stream: false,
  };
}
test("OpenAI image parts become Ollama raw base64; ordinary text remains unchanged", () => {
  const parsed = ChatSchema.parse(input()),
    messages = toOllamaMessages(parsed, getModel(parsed.model));
  assert.deepEqual(messages, [{ role: "user", content: "图片里是什么？", images: [base64] }]);
  const text = ChatSchema.parse({
    model: "qwen3-0.6b",
    messages: [{ role: "user", content: "你好" }],
  });
  assert.deepEqual(toOllamaMessages(text, getModel(text.model)), text.messages);
});
test("image protocol rejects remote URLs, file paths, unsupported formats, too many images and oversized payloads", () => {
  for (const value of [
    "https://example.com/image.png",
    "file:///etc/passwd",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,invalid!",
    "data:image/png;base64," + Buffer.alloc(MAX_IMAGE_BYTES + 3).toString("base64"),
  ]) {
    const body = input();
    body.messages[0].content = [image(value)];
    assert.equal(ChatSchema.safeParse(body).success, false);
  }
  const many = input();
  many.messages[0].content = Array.from({ length: 5 }, () => image());
  assert.equal(ChatSchema.safeParse(many).success, false);
  assert.equal(
    ChatSchema.safeParse({ ...input(), messages: [{ role: "assistant", content: [image()] }] })
      .success,
    false,
  );
  assert.throws(
    () => decodeImage("data:image/png;base64," + Buffer.from("not a png").toString("base64")),
    /格式不符/,
  );
});
test("text-only models cannot receive images, even through direct API calls", () => {
  assert.throws(
    () => toOllamaMessages(ChatSchema.parse(input("qwen3-0.6b")), getModel("qwen3-0.6b")),
    /不支持图片/,
  );
});
test("image history sends the newest four pictures with their original turns and preserves thumbnails", () => {
  const messages: ChatMessage[] = Array.from({ length: 6 }, (_, i) => ({
    role: "user",
    content: "第" + i + "轮",
    images: [{ id: String(i), name: i + ".png", dataUrl: url, width: 1, height: 1 }],
  }));
  const wire = toWireMessages(messages);
  assert.equal(typeof wire[0].content, "string");
  assert.match(wire[0].content as string, /不在当前视觉上下文/);
  assert.equal(wire.filter((m) => Array.isArray(m.content)).length, 4);
  assert.equal(messages[0].images?.length, 1);
  assert.ok(ChatSchema.safeParse({ model: "gemma3-4b", messages: wire }).success);
});
test("paired HTTP API forwards vision input locally, streams output, and rejects text-model images before inference", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-vision-")),
    original = globalThis.fetch;
  const b = await createBridge({ dataDir: dir, port: 31419, pairCode: "12345678" });
  await new Promise<void>((r) => b.server.listen(31419, "127.0.0.1", r));
  let token = "",
    seen: any,
    calls = 0;
  b.manager.installed = async () => [
    { modelId: "gemma3-4b", tag: "gemma3:4b", bytes: 1 },
    { modelId: "qwen3-0.6b", tag: "qwen3:0.6b", bytes: 1 },
  ];
  b.manager.running = async () => [{ modelId: "gemma3-4b" }, { modelId: "qwen3-0.6b" }];
  globalThis.fetch = async (address, init) => {
    if (String(address) === "http://127.0.0.1:11434/api/chat") {
      calls++;
      seen = JSON.parse(String(init?.body));
      return seen.stream
        ? new Response(
            JSON.stringify({ message: { content: "这是一张测试图片。" }, done: true }) + "\n",
          )
        : Response.json({
            message: { role: "assistant", content: "这是一张测试图片。" },
            eval_count: 7,
          });
    }
    return original(address, init);
  };
  const request = (route: string, body: unknown) =>
    original("http://127.0.0.1:31419" + route, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    const c: any = await (await request("/challenge", {})).json();
    const paired: any = await (
      await request("/pair", { challenge: c.challenge, code: "12345678" })
    ).json();
    token = paired.token;
    let r = await request("/v1/chat/completions", input());
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as any).choices[0].message.content, "这是一张测试图片。");
    assert.equal(seen.model, "gemma3:4b");
    assert.deepEqual(seen.messages[0].images, [base64]);
    r = await request("/v1/chat/completions", { ...input(), stream: true });
    const stream = await r.text();
    assert.match(stream, /chat.completion.chunk/);
    assert.match(stream, /\[DONE\]/);
    const large = input();
    large.messages[0].content = [
      image(
        "data:image/png;base64," +
          Buffer.concat([Buffer.from(base64, "base64"), Buffer.alloc(250000)]).toString("base64"),
      ),
    ];
    r = await request("/v1/chat/completions", large);
    assert.equal(r.status, 200);
    assert.ok(seen.messages[0].images[0].length > 256000);
    r = await request("/v1/chat/completions", input("qwen3-0.6b"));
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(await r.json()), /不支持图片/);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
    b.server.closeAllConnections();
    await new Promise<void>((r) => b.server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
