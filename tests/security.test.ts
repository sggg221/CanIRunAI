import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridge, allowedHost, allowedOrigin } from "../apps/bridge/server.ts";
import { ActionSchema } from "../packages/protocol/index.ts";
test("action protocol rejects commands, unknown fields and unsafe context", () => {
  for (const value of [
    { action: "execute_shell", command: "ls" },
    { action: "deploy", model_id: "qwen3-0.6b", command: "ls" },
    { action: "deploy", model_id: "qwen3-0.6b", context_length: 1000000 },
    { action: "install_runtime", confirmed: false },
  ])
    assert.equal(ActionSchema.safeParse(value).success, false);
  assert.equal(ActionSchema.safeParse({ action: "deploy", model_id: "qwen3-0.6b" }).success, true);
});
test("strict origin and host prevent untrusted browser access / DNS rebinding", () => {
  assert.ok(allowedOrigin("http://localhost:3000"));
  for (const s of [
    undefined,
    "null",
    "http://evil.test",
    "https://canirun.ai.evil.test",
    "http://localhost:3000.evil.test",
  ])
    assert.equal(allowedOrigin(s), false);
  assert.equal(allowedHost("evil.test:31415", 31415), false);
});
test("pairing is one-time, challenge-bound; sessions rotate and revoke", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-security-"));
  const b = await createBridge({ dataDir: dir, port: 31417, pairCode: "12345678" });
  await new Promise<void>((resolve) => b.server.listen(31417, "127.0.0.1", resolve));
  const call = (route: string, body?: unknown, token?: string, origin = "http://localhost:3000") =>
    fetch("http://127.0.0.1:31417" + route, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await call("/health", undefined, undefined, "https://evil.test")).status, 403);
    assert.equal((await call("/status")).status, 401);
    const c = (await (await call("/challenge", {})).json()) as any;
    const pair = await call("/pair", { challenge: c.challenge, code: "12345678" });
    assert.equal(pair.status, 200);
    const s = (await pair.json()) as any;
    assert.equal((await call("/pair", { challenge: c.challenge, code: "12345678" })).status, 401);
    assert.equal(
      (await call("/action", { action: "execute_shell", command: "echo bad" }, s.token)).status,
      400,
    );
    assert.equal(
      (await call("/action", { action: "deploy", model_id: "../../invalid" }, s.token)).status,
      400,
    );
    assert.equal((await call("/runtime", undefined, s.token, "https://canirun.ai")).status, 401);
    const rotated = (await (await call("/session/rotate", {}, s.token)).json()) as any;
    assert.equal((await call("/runtime", undefined, s.token)).status, 401);
    assert.equal((await call("/runtime", undefined, rotated.token)).status, 200);
    await call("/session/revoke", {}, rotated.token);
    assert.equal((await call("/runtime", undefined, rotated.token)).status, 401);
  } finally {
    b.server.closeAllConnections();
    await new Promise<void>((r) => b.server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
