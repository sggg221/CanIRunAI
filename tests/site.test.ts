import test from "node:test";
import assert from "node:assert/strict";
import registry from "../packages/model-registry/models.json";
import {
  DeviceProfileSchema,
  ModelSchema,
  type Model,
} from "../packages/protocol/index.ts";
import {
  configurationURL,
  defaults,
  deviceFromConfiguration,
  filterModels,
  readConfiguration,
  readConfigurationURL,
  recommendations,
  selectedVariant,
} from "../apps/site/src/catalog.ts";

const models = registry as Model[];
const options = {
  query: "",
  category: "all",
  compatibleOnly: false,
  sort: "recommended",
} as const;

test("site: the bundled catalog is valid and has a current variant for every model", () => {
  for (const model of models) {
    ModelSchema.parse(model);
    assert.ok(model.variants.some((v) => !v.archived));
  }
});

test("site: defaults are explicit example values, never detected hardware or bandwidth", () => {
  assert.deepEqual(readConfiguration(new URLSearchParams()), defaults);
  const device = deviceFromConfiguration(defaults);
  DeviceProfileSchema.parse(device);
  assert.equal(device.chip, "Unknown");
  assert.equal(device.bandwidthGBs, null);
  for (const { result } of recommendations(defaults, models)) {
    assert.equal(result.performance.confidence, "unknown");
    assert.equal(result.performance.min, null);
    assert.equal(result.performance.max, null);
  }
});

test("site: malformed configuration links cannot introduce negative or non-finite memory", () => {
  const config = readConfiguration(
    new URLSearchParams("memory=NaN&free=Infinity&disk=-5&platform=unknown"),
  );
  assert.deepEqual(config, { ...defaults, diskFreeGB: 0 });
  assert.deepEqual(
    readConfiguration(new URLSearchParams("memory=8&free=999&disk=1e20")),
    {
      platform: "apple",
      memoryGB: 8,
      freeMemoryGB: 8,
      diskFreeGB: 1_000_000,
    },
  );
  const empty = readConfiguration(new URLSearchParams("memory=&free=&disk="));
  assert.deepEqual(empty, defaults);
  const small = readConfiguration(
    new URLSearchParams("memory=-8&free=-10&disk=Infinity"),
  );
  assert.deepEqual(small, { ...defaults, memoryGB: 4, freeMemoryGB: 0 });
});

test("site: shared configuration round trips and preserves a GitHub Pages subpath", () => {
  const config = {
    platform: "unsupported",
    memoryGB: 48,
    freeMemoryGB: 31.5,
    diskFreeGB: 77,
  } as const;
  const url = new URL(
    configurationURL("https://example.org/CanIRunAI/?irrelevant=1#faq", config),
  );
  assert.equal(url.pathname, "/CanIRunAI/");
  assert.ok(url.hash.startsWith("#config?"));
  assert.equal(url.search, "");
  assert.deepEqual(readConfigurationURL(url.href), config);
  assert.deepEqual(
    readConfigurationURL("https://example.org/CanIRunAI/#models"),
    defaults,
  );
  assert.deepEqual(
    readConfigurationURL("https://example.org/CanIRunAI/?memory=64"),
    defaults,
  );
  const request = new Request(url);
  assert.equal(new URL(request.url).search, "");
});

test("site: unsupported platforms, zero memory, and zero disk never show a compatible result", () => {
  for (const config of [
    { ...defaults, platform: "unsupported" as const },
    { ...defaults, freeMemoryGB: 0 },
    { ...defaults, diskFreeGB: 0 },
  ]) {
    const entries = recommendations(config, models);
    assert.ok(entries.every((e) => !e.result.compatible));
    assert.equal(
      filterModels(entries, { ...options, compatibleOnly: true }).length,
      0,
    );
  }
});

test("site: changing memory recomputes recommendations and never selects archived revisions", () => {
  const small = recommendations(
    { ...defaults, memoryGB: 8, freeMemoryGB: 6 },
    models,
  );
  const large = recommendations(
    { ...defaults, memoryGB: 64, freeMemoryGB: 48 },
    models,
  );
  assert.ok(
    small.filter((e) => e.result.compatible).length <
      large.filter((e) => e.result.compatible).length,
  );
  for (const entry of [...small, ...large]) {
    assert.equal(selectedVariant(entry).archived ?? false, false);
    assert.ok(Number.isFinite(entry.result.memory.total));
  }
});

test("site: search supports names, developers, Chinese descriptions and empty results", () => {
  const entries = recommendations(defaults, models);
  const byName = filterModels(entries, {
    ...options,
    query: "  QWEN 3 MINI  ",
  });
  assert.deepEqual(
    byName.map((e) => e.model.id),
    ["qwen3-0.6b"],
  );
  const byDeveloper = filterModels(entries, {
    ...options,
    query: models[0].developer,
  });
  assert.ok(byDeveloper.some((e) => e.model.id === models[0].id));
  assert.ok(filterModels(entries, { ...options, query: "图文" }).length > 0);
  assert.equal(
    filterModels(entries, { ...options, query: "no-such-model-xyz" }).length,
    0,
  );
  assert.equal(entries.length, models.length);
});

test("site: categories, fit filter and download-size sort compose without mutating the catalog", () => {
  const entries = recommendations(defaults, models);
  const originalOrder = entries.map((e) => e.model.id);
  for (const category of ["vision", "coding", "reasoning"] as const) {
    const filtered = filterModels(entries, { ...options, category });
    assert.ok(filtered.length > 0);
    assert.ok(filtered.every((e) => e.model.capabilities.includes(category)));
  }
  const lightweight = filterModels(entries, {
    ...options,
    category: "lightweight",
    compatibleOnly: true,
    sort: "size",
  });
  assert.ok(lightweight.length > 0);
  assert.ok(
    lightweight.every(
      (e) => e.result.compatible && selectedVariant(e).bytes <= 2e9,
    ),
  );
  for (let i = 1; i < lightweight.length; i++) {
    assert.ok(
      selectedVariant(lightweight[i - 1]).bytes <=
        selectedVariant(lightweight[i]).bytes,
    );
  }
  const byName = filterModels(entries, { ...options, sort: "name" });
  for (let i = 1; i < byName.length; i++)
    assert.ok(
      byName[i - 1].model.name.localeCompare(byName[i].model.name) <= 0,
    );
  assert.deepEqual(
    entries.map((e) => e.model.id),
    originalOrder,
  );
});
