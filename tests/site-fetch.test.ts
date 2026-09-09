import test from "node:test";
import assert from "node:assert/strict";
import { BridgeClient } from "../apps/site/src/bridge.ts";

test("default browser fetch keeps its Window receiver instead of binding the BridgeClient", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = function (this: typeof globalThis) {
    assert.equal(this, globalThis);
    return Promise.resolve(
      Response.json({ name: "CanIRunAI Bridge", protocol: 1 }),
    );
  };
  try {
    await new BridgeClient().probe();
  } finally {
    globalThis.fetch = original;
  }
});
