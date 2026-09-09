import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Manager, reclaimableModelMemory } from "../apps/bridge/manager.ts";
import { models } from "../packages/model-registry/index.ts";
import type { DeviceProfile } from "../packages/protocol/index.ts";

const windows: DeviceProfile = {
  os: "win32", osVersion: "10.0.19045", architecture: "x64", supported: true,
  model: "Windows test PC", chip: "x64 test CPU", cpuCores: 8, gpuCores: null,
  gpus: [], gpuDetectionComplete: true, memoryGB: 32, freeMemoryGB: 24, diskFreeGB: 100,
  metal: null, neuralEngine: null, bandwidthGBs: null, powerMode: null,
};
test("only Apple Silicon unified memory reclaims loaded model VRAM as system RAM", () => {
  const loaded = [{ modelId: models[0]!.id, memoryGB: 8 }, { modelId: null, memoryGB: 5 }];
  assert.equal(reclaimableModelMemory(windows, loaded), 0);
  assert.equal(reclaimableModelMemory({ ...windows, os: "darwin", architecture: "arm64" }, loaded), 8);
  assert.equal(reclaimableModelMemory({ ...windows, os: "darwin", architecture: "x64" }, loaded), 0);
});
test("Windows deployment chooses auto backend while Mac preserves Metal", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).endsWith("/api/version")
    ? Response.json({ version: "0.33.3" }) : Response.json({ models: [] });
  try {
    const manager = new Manager("unused");
    manager.device = async () => windows;
    assert.equal((await manager.preflight(models[0]!.id)).plan.backend, "auto");
    manager.device = async () => ({ ...windows, os: "darwin", architecture: "arm64" });
    assert.equal((await manager.preflight(models[0]!.id)).plan.backend, "metal");
  } finally { globalThis.fetch = original; }
});
test("Windows installation checks disk for portable archive and extracted headroom", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    const manager = new Manager("unused", async () => { throw new Error("missing"); });
    manager.device = async () => ({ ...windows, diskFreeGB: 2 });
    await assert.rejects(manager.install(), (error: any) => error.code === "disk_full" && error.fix === "free_disk");
    assert.equal(manager.busy, false);
  } finally { globalThis.fetch = original; }
});
test("Windows deployment rechecks a stopped outdated runtime before pulling or launching", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "runtime-manager-"));
  const original = globalThis.fetch;
  let started = false;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/api/version")) {
      if (!started) throw new Error("offline");
      return Response.json({ version: "0.16.0" });
    }
    if (url.endsWith("/api/ps")) return Response.json({ models: [] });
    throw new Error("Unexpected request " + url);
  };
  try {
    const manager = new Manager(directory, async () => { started = true; });
    await manager.init();
    manager.device = async () => windows;
    const deployment = await manager.deploy("qwen3.5-0.8b");
    for (let i = 0; i < 100 && manager.busy; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(manager.busy, false);
    assert.equal(deployment.stage, "failed");
    assert.equal(deployment.error?.code, "unsupported");
    assert.match(deployment.error!.message, /Ollama 0.17.1/);
    assert.ok(requests.every((url) => /\/api\/(version|ps)$/.test(url)));
  } finally {
    globalThis.fetch = original;
    await rm(directory, { recursive: true, force: true });
  }
});
