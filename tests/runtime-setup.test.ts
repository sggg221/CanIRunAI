import test from "node:test";
import assert from "node:assert/strict";
import { Manager } from "../apps/bridge/manager.ts";
import type { DeviceProfile } from "../packages/protocol/index.ts";

const device: DeviceProfile = {
  os: "darwin",
  osVersion: "test",
  architecture: "arm64",
  supported: true,
  model: "Test fixture",
  chip: "Test",
  cpuCores: 8,
  gpuCores: 8,
  memoryGB: 16,
  freeMemoryGB: 12,
  diskFreeGB: 100,
  metal: null,
  neuralEngine: null,
  bandwidthGBs: null,
  powerMode: null,
};
test("runtime setup reuses an existing stopped installation without downloading or replacing it", async () => {
  const original = globalThis.fetch;
  let started = false;
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({ version: "0.17.1" });
  };
  try {
    const manager = new Manager("unused", async () => {
      started = true;
    });
    manager.device = async () => device;
    assert.deepEqual(await manager.install(), {
      available: true,
      version: "0.17.1",
    });
    assert.equal(started, true);
    assert.deepEqual(requests, ["http://127.0.0.1:11434/api/version"]);
    assert.equal(manager.busy, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("runtime setup rejects unsupported hardware before starting or installing software", async () => {
  let started = false;
  const manager = new Manager("unused", async () => {
    started = true;
  });
  manager.device = async () => ({ ...device, os: "linux", supported: false });
  await assert.rejects(manager.install(), /仅支持 Apple Silicon Mac/);
  assert.equal(started, false);
  assert.equal(manager.busy, false);
});
