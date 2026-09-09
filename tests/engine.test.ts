import { test } from "node:test";
import assert from "node:assert/strict";
import { models } from "../packages/model-registry/index.ts";
import { evaluate, kvMemory, recommend } from "../packages/compatibility-engine/index.ts";
import type { DeviceProfile } from "../packages/protocol/index.ts";
const device: DeviceProfile = {
  os: "darwin",
  osVersion: "15",
  architecture: "arm64",
  supported: true,
  model: "Test Mac",
  chip: "Apple Silicon",
  cpuCores: 8,
  gpuCores: null,
  memoryGB: 16,
  freeMemoryGB: 10,
  diskFreeGB: 100,
  metal: null,
  neuralEngine: null,
  bandwidthGBs: null,
  powerMode: null,
};
test("memory calculation includes weights, KV cache, overhead and system reserve", () => {
  const r = evaluate(device, models[2]);
  assert.ok(r.compatible);
  assert.ok(r.memory.total < r.memory.safeAvailable);
  assert.ok(r.memory.reserve >= 4);
  assert.ok(r.context.recommended <= r.context.practicalMax);
  assert.ok(r.context.practicalMax <= models[2].context);
  assert.equal(r.performance.confidence, "unknown");
  assert.ok(kvMemory(models[2].variants[0], 8192) > kvMemory(models[2].variants[0], 4096));
});
test("unsupported hardware, disk shortage and memory shortage fail recommendations", () => {
  assert.equal(evaluate({ ...device, supported: false }, models[0]).compatible, false);
  assert.equal(evaluate({ ...device, diskFreeGB: 0.1 }, models[0]).compatible, false);
  assert.equal(evaluate({ ...device, memoryGB: 4 }, models[3]).compatible, false);
});
test("variant selection favors quality only when it safely fits", () => {
  const m = structuredClone(models[2]);
  m.variants.push({ ...m.variants[0], id: "q6", quantization: "Q6_K", weightGB: 4.5 });
  assert.equal(evaluate({ ...device, memoryGB: 48 }, m).recommendedVariant, "q6");
  m.variants[1].weightGB = 30;
  assert.notEqual(evaluate(device, m).recommendedVariant, "q6");
});
test("ranking is deterministic and never places an incompatible model first when a fit exists", () => {
  assert.deepEqual(recommend(device, models), recommend(device, models));
  assert.ok(recommend(device, models)[0].result.compatible);
});
