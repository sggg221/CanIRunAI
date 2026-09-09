import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Manager } from "../apps/bridge/manager.ts";
import { models } from "../packages/model-registry/index.ts";
import type { DeviceProfile } from "../packages/protocol/index.ts";
const device: DeviceProfile = {
  os: "darwin",
  osVersion: "15",
  architecture: "arm64",
  supported: true,
  model: "Test Mac",
  chip: "Test",
  cpuCores: 8,
  gpuCores: 8,
  memoryGB: 16,
  freeMemoryGB: 12,
  diskFreeGB: 100,
  metal: "Metal",
  neuralEngine: null,
  bandwidthGBs: null,
  powerMode: null,
};
async function waitUntil(fn: () => boolean) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Timed out waiting for state transition");
}
test("download pause and daemon restart preserve progress; resume verifies before launch", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-deploy-"));
  const original = globalThis.fetch;
  const v = models[0].variants[0];
  let installed = false,
    running = false,
    pulls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/version")) return Response.json({ version: "test" });
    if (url.endsWith("/api/tags"))
      return Response.json({
        models: installed ? [{ name: v.tag, digest: v.digest, size: v.bytes }] : [],
      });
    if (url.endsWith("/api/ps"))
      return Response.json({
        models: running ? [{ name: v.tag, size: 2e9, context_length: 8192 }] : [],
      });
    if (url.endsWith("/api/generate")) {
      running = true;
      return Response.json({ done: true });
    }
    if (url.endsWith("/api/pull")) {
      pulls++;
      const sequence = pulls;
      return new Response(
        new ReadableStream({
          start(controller) {
            const event = {
              digest: v.modelDigest,
              total: v.bytes,
              completed: sequence === 1 ? v.bytes * 0.4 : v.bytes,
            };
            controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
            if (sequence === 1)
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            else {
              installed = true;
              controller.close();
            }
          },
        }),
      );
    }
    throw Error(url);
  };
  try {
    const m = new Manager(dir);
    await m.init();
    m.device = async () => device;
    const d = await m.deploy(models[0].id);
    await waitUntil(() => d.download.completed > 0);
    await m.pause(d.id);
    await waitUntil(() => !m.busy);
    assert.equal(d.stage, "paused");
    assert.ok(d.download.completed > 0);
    await m.persist();
    const restarted = new Manager(dir);
    await restarted.init();
    restarted.device = async () => device;
    assert.equal(restarted.deployments[0].stage, "paused");
    assert.ok(restarted.deployments[0].download.completed > 0);
    await restarted.resume(d.id);
    await waitUntil(() => !restarted.busy);
    assert.equal(restarted.deployments[0].stage, "running");
    assert.equal(pulls, 2);
    assert.ok(restarted.deployments[0].logs.some((l) => l.includes("SHA-256")));
  } finally {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  }
});
test("an upstream revision mismatch fails closed before model launch", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-corrupt-")),
    original = globalThis.fetch;
  let launched = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/version")) return Response.json({ version: "test" });
    if (url.endsWith("/api/tags")) return Response.json({ models: [] });
    if (url.endsWith("/api/ps")) return Response.json({ models: [] });
    if (url.endsWith("/api/pull")) return new Response('{"status":"success"}\n');
    if (url.endsWith("/api/generate")) {
      launched = true;
      return Response.json({});
    }
    throw Error(url);
  };
  try {
    const m = new Manager(dir);
    await m.init();
    m.device = async () => device;
    const d = await m.deploy(models[0].id);
    await waitUntil(() => !m.busy);
    assert.equal(d.stage, "failed");
    assert.equal(d.error?.code, "model_corrupt");
    assert.equal(launched, false);
  } finally {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  }
});


test("an installed audited older revision cannot satisfy a new deployment", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-revision-"));
  const original = globalThis.fetch, model = models[0], v = model.variants[0];
  const previous = { ...v, id: "old-audited-revision", digest: "a".repeat(64), archived: true };
  model.variants.push(previous);
  let launched = false, pulled = false;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/api/version")) return Response.json({ version: "0.33.3" });
    if (url.endsWith("/api/tags")) return Response.json({ models: [{name:v.tag,digest:previous.digest,size:v.bytes}] });
    if (url.endsWith("/api/ps")) return Response.json({ models: [] });
    if (url.endsWith("/api/pull")) { pulled = true; return new Response('{"status":"success"}\n'); }
    if (url.endsWith("/api/generate")) { launched = true; return Response.json({}); }
    throw Error(url);
  };
  try {
    const m = new Manager(dir); await m.init(); m.device = async () => device;
    assert.equal((await m.installed()).length, 1);
    const d = await m.deploy(model.id); await waitUntil(() => !m.busy);
    assert.equal(pulled, true); assert.equal(d.error?.code, "model_corrupt"); assert.equal(launched, false);
  } finally { model.variants.pop(); globalThis.fetch = original; await rm(dir, { recursive:true,force:true }); }
});

test("a new model fails preflight on an outdated runtime", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({version:"0.16.0"});
  try {
    const m = new Manager("unused");
    await assert.rejects(m.preflight("qwen3.5-0.8b"), /Ollama 0.17.1/);
  } finally { globalThis.fetch = original; }
});
