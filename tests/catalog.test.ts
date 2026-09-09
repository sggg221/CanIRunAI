import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { models } from "../packages/model-registry/index.ts";
import { kvMemory, runtimeCompatible } from "../packages/compatibility-engine/index.ts";

test("catalog count, pinned local variants and architecture metadata agree", () => {
  const info = JSON.parse(readFileSync(new URL("../packages/model-registry/catalog-info.json", import.meta.url), "utf8"));
  assert.equal(info.modelCount, models.length);
  assert.equal(info.familyCount, new Set(models.map(m => m.family)).size);
  assert.equal(new Set(models.map(m => m.id)).size, models.length);
  for (const model of models) {
    assert.equal(model.verifiedAt, info.verifiedAt);
    assert.ok(model.variants.some(v => !v.archived));
    for (const v of model.variants) {
      assert.doesNotMatch(v.tag, /cloud|latest/);
      assert.match(v.digest, /^[a-f0-9]{64}$/);
      assert.match(v.modelDigest, /^sha256:[a-f0-9]{64}$/);
      assert.ok(v.bytes > 1e8 && v.weightGB > 0);
      if (v.kvHeadsByLayer) assert.equal(v.kvHeadsByLayer.length, v.layers);
    }
  }
});

test("hybrid KV calculation counts attention layers and reserves state memory", () => {
  const model = models.find(m => m.id === "qwen3.5-0.8b")!;
  const variant = model.variants[0];
  assert.ok(variant.kvHeadsByLayer?.includes(0));
  const full = { ...variant, kvHeadsByLayer: undefined };
  assert.ok(kvMemory(variant, 8192) < kvMemory(full, 8192));
  assert.ok(variant.stateMemoryGB! > 0);
});

test("minimum runtime comparison is numeric and fails on unknown versions", () => {
  assert.equal(runtimeCompatible("0.9.9", "0.32.12"), false);
  assert.equal(runtimeCompatible("0.32.14", "0.32.12"), true);
  assert.equal(runtimeCompatible("0.32.12", "0.32.12"), true);
  assert.equal(runtimeCompatible("0.33.0", "0.32.12"), true);
  assert.equal(runtimeCompatible(null, "0.32.12"), false);
  assert.equal(runtimeCompatible("test", "0.32.12"), false);
  assert.equal(runtimeCompatible("0.32.14", null), true);
});
