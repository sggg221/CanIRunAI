// Explicit integration test: downloads the 523 MB verified model and runs local inference.
import { createBridge } from "../apps/bridge/server.ts";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
const dataDir = process.env.CANIRUN_SMOKE_DIR ?? path.resolve("../../work/smoke-data");
const b = await createBridge({ dataDir, port: 31418 });
await new Promise<void>((r) => b.server.listen(31418, "127.0.0.1", r));
let token = "";
async function call(route: string, body?: unknown) {
  const r = await fetch("http://127.0.0.1:31418" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: "http://localhost:3000",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result: any = await r.json();
  if (!r.ok) throw Error(JSON.stringify(result));
  return result;
}
const report: any = { date: new Date().toISOString() };
try {
  const c = await call("/challenge", {});
  token = (await call("/pair", { challenge: c.challenge, code: b.getPairCode() })).token;
  const status = await call("/status");
  report.device = status.device;
  console.log("Hardware:", status.device.chip, status.device.memoryGB + " GB");
  assert.ok(status.device.supported);
  assert.ok(status.recommendations.some((r: any) => r.result.compatible));
  const started = await call("/action", { action: "deploy", model_id: "qwen3-0.6b" });
  let last = "",
    d: any;
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    const s = await call("/status");
    d = s.deployments.find((x: any) => x.id === started.result.id);
    const line =
      d.stage +
      " " +
      Math.round((d.download.completed / Math.max(1, d.download.total)) * 100) +
      "%";
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (d.stage === "running") break;
    if (d.stage === "failed") throw Error(JSON.stringify(d.error));
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(d.stage, "running");
  report.deployment = d;
  const chat = await call("/v1/chat/completions", {
    model: "qwen3-0.6b",
    messages: [{ role: "user", content: "用中文回答：你在本地运行吗？请用一句话回答。" }],
    stream: false,
    max_tokens: 80,
  });
  assert.ok(chat.choices[0].message.content.length > 0);
  report.chat = chat;
  console.log("Local answer:", chat.choices[0].message.content);
  const stream = await fetch("http://127.0.0.1:31418/v1/chat/completions", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      model: "qwen3-0.6b",
      messages: [{ role: "user", content: "Reply with: hello local AI" }],
      stream: true,
      max_tokens: 30,
    }),
  });
  const text = await stream.text();
  assert.ok(text.includes("chat.completion.chunk"));
  assert.ok(text.includes("[DONE]"));
  assert.ok(!text.includes('"error"'));
  report.streaming = true;
  console.log("SSE streaming verified.");
  const bench = await call("/action", { action: "benchmark_model", model_id: "qwen3-0.6b" });
  report.benchmark = bench.result;
  console.log("Measured:", bench.result.tokensPerSecond, "tok/s");
  await call("/action", { action: "stop_model", model_id: "qwen3-0.6b" });
  assert.equal(
    (await call("/status")).running.some((m: any) => m.modelId === "qwen3-0.6b"),
    false,
  );
  report.stop = true;
  const restart = await call("/action", { action: "start_model", model_id: "qwen3-0.6b" });
  for (let i = 0; i < 90; i++) {
    const s = await call("/status");
    if (s.deployments.find((d: any) => d.id === restart.result.id)?.stage === "running") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok((await call("/status")).running.some((m: any) => m.modelId === "qwen3-0.6b"));
  report.restart = true;
  console.log("Stop / restart verified.");
  report.result = "passed";
} finally {
  await mkdir(path.dirname(dataDir), { recursive: true });
  await writeFile(
    path.join(path.dirname(dataDir), "smoke-result.json"),
    JSON.stringify(report, null, 2),
  );
  b.server.closeAllConnections();
  await new Promise<void>((r) => b.server.close(() => r()));
}
