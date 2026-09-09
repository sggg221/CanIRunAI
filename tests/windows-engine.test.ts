import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../packages/compatibility-engine/index.ts";
import { models } from "../packages/model-registry/index.ts";
import { DeviceProfileSchema, DeploymentPlanSchema, type DeviceProfile } from "../packages/protocol/index.ts";

const windows: DeviceProfile = {
  os: "win32", osVersion: "10.0.22631", architecture: "x64", supported: true,
  model: "Test PC", chip: "Intel Core i7", cpuCores: 8, gpuCores: null,
  memoryGB: 16, freeMemoryGB: 10, diskFreeGB: 100, metal: null,
  neuralEngine: null, bandwidthGBs: null, powerMode: null,
};

test("protocol accepts legacy profiles and metal plans plus optional Windows GPUs and auto backend", () => {
  assert.equal(DeviceProfileSchema.parse(windows).gpus, undefined);
  const withGPU = { ...windows, gpuDetectionComplete: true, gpus: [{ name: "AMD Radeon", vendor: "amd", memoryGB: null, freeMemoryGB: null, source: "cim" }] };
  assert.deepEqual(DeviceProfileSchema.parse(withGPU), withGPU);
  assert.equal(DeviceProfileSchema.safeParse({ ...withGPU, gpus: [{ ...withGPU.gpus[0], memoryGB: -1 }] }).success, false);
  assert.equal(DeviceProfileSchema.safeParse({ ...withGPU, gpus: [{ ...withGPU.gpus[0], vendor: "other" }] }).success, false);
  const plan = { modelId: "test", variantId: "test", runtimeId: "ollama", context: 2048, downloadBytes: 100, memoryGB: 1 };
  for (const backend of ["metal", "auto"]) assert.equal(DeploymentPlanSchema.parse({ ...plan, backend }).backend, backend);
  assert.equal(DeploymentPlanSchema.safeParse({ ...plan, backend: "cuda" }).success, false);
});

test("Windows fit capacity is RAM-only, regardless of total, free, shared or multi-GPU memory", () => {
  const base = { ...windows, memoryGB: 4, freeMemoryGB: 2 };
  const cpu = evaluate(base, models[2]);
  const gpu = evaluate({ ...base, gpuDetectionComplete: true, gpus: [
    { name: "NVIDIA RTX 6000", vendor: "nvidia", memoryGB: 48, freeMemoryGB: 48, source: "nvidia-smi" },
    { name: "NVIDIA RTX 6000", vendor: "nvidia", memoryGB: 48, freeMemoryGB: 48, source: "nvidia-smi" },
    { name: "Intel Shared Graphics", vendor: "intel", memoryGB: null, freeMemoryGB: null, source: "cim" },
  ] }, models[2]);
  assert.equal(gpu.compatible, false);
  assert.ok(gpu.reasons.some(reason => reason.includes("memory")));
  assert.deepEqual(gpu.memory, cpu.memory);
  assert.deepEqual(gpu.context, cpu.context);
  assert.equal(gpu.memory.safeAvailable, 0);
});

test("Windows with unknown or no GPUs remains CPU-compatible when RAM is sufficient", () => {
  for (const gpuDetectionComplete of [false, true]) {
    const result = evaluate({ ...windows, gpus: [], gpuDetectionComplete }, models[2]);
    assert.equal(result.compatible, true);
    assert.equal(result.performance.confidence, "unknown");
  }
});

test("Windows never projects Metal bandwidth speeds, while Apple Silicon estimates remain unchanged", () => {
  const pc = evaluate({ ...windows, bandwidthGBs: 400, metal: "Metal 3" }, models[2]);
  assert.deepEqual(pc.performance, { min: null, max: null, confidence: "unknown" });
  const mac = evaluate({ ...windows, os: "darwin", architecture: "arm64", bandwidthGBs: 400 }, models[2]);
  assert.equal(mac.performance.confidence, "estimated");
  assert.ok(mac.performance.min! > 0);
  assert.ok(mac.performance.max! >= mac.performance.min!);
  assert.deepEqual(mac.memory, pc.memory);
});

test("unsupported reasons specify supported Windows builds, architectures and macOS scope", () => {
  const result = evaluate({ ...windows, os: "linux", supported: false }, models[2]);
  assert.equal(result.compatible, false);
  const reason = result.reasons.join(" ");
  for (const text of ["Apple Silicon", "19045", "Windows 11", "x64", "Linux", "ARM64"]) assert.ok(reason.includes(text));
});
