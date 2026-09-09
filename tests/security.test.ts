import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
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
  for (const origin of [
    "http://localhost:3000", "https://canirun.ai", "https://sggg221.github.io",
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:4173", "http://127.0.0.1:4173",
  ]) assert.ok(allowedOrigin(origin), origin);
  for (const s of [
    undefined,
    "null",
    "http://evil.test",
    "https://canirun.ai.evil.test",
    "http://localhost:3000.evil.test",
    "https://sggg221.github.io.evil.test",
    "https://sggg221.github.io@evil.test",
    "https://sggg22l.github.io",
    "http://sggg221.github.io",
    "https://sggg221.github.io/CanIRunAI/",
    "https://sggg221.github.io:444",
    "http://localhost:5173.evil.test",
    "http://127.0.0.1:4173@evil.test",
    "http://localhost:5174",
    "http://192.168.1.2:5173",
  ])
    assert.equal(allowedOrigin(s), false);
  assert.equal(allowedHost("evil.test:31415", 31415), false);
});
test("pairing is one-time, challenge-bound and rate-limited; sessions rotate, revoke and expire", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-security-"));
  const b = await createBridge({ dataDir: dir, port: 31417, pairCode: "12345678" });
  await new Promise<void>((resolve) => b.server.listen(31417, "127.0.0.1", resolve));
  const call = (route: string, body?: unknown, token?: string, origin = "https://sggg221.github.io") =>
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
    const rejected = await call("/health", undefined, undefined, "https://sggg221.github.io.evil.test");
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
    const preflight = await fetch("http://127.0.0.1:31417/status", {
      method: "OPTIONS",
      headers: { Origin: "https://sggg221.github.io", "Access-Control-Request-Private-Network": "true" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://sggg221.github.io");
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.get("http://127.0.0.1:31417/health", {
        headers: { Origin: "https://sggg221.github.io", Host: "evil.test:31417" },
      }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject);
    });
    assert.equal(badHost, 403);
    assert.equal((await call("/status")).status, 401);
    const foreign = await (await call("/challenge", {}, undefined, "http://localhost:5173")).json() as any;
    assert.equal((await call("/pair", { challenge: foreign.challenge, code: "12345678" })).status, 401);
    const c = (await (await call("/challenge", {})).json()) as any;
    const pair = await call("/pair", { challenge: c.challenge, code: "12345678" });
    assert.equal(pair.status, 200);
    const s = (await pair.json()) as any;
    assert.ok(s.expiresAt > Date.now() + 899000 && s.expiresAt <= Date.now() + 900000);
    let installs = 0;
    b.manager.install = async () => { installs++; return { available: true, version: "test" }; };
    for (const action of [{ action: "install_runtime" }, { action: "install_runtime", confirmed: false }])
      assert.equal((await call("/action", action, s.token)).status, 400);
    assert.equal(installs, 0);
    assert.equal((await call("/action", { action: "install_runtime", confirmed: true }, s.token)).status, 200);
    assert.equal(installs, 1);
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
    for (let i = 0; i < 10; i++)
      assert.equal((await call("/challenge", {}, undefined, "http://localhost:4173")).status, 200);
    assert.equal((await call("/challenge", {}, undefined, "http://localhost:4173")).status, 429);
    const nextChallenge = await (await call("/challenge", {})).json() as any;
    const nextSession = await (await call("/pair", { challenge: nextChallenge.challenge, code: b.getPairCode() })).json() as any;
    assert.equal((await call("/runtime", undefined, nextSession.token)).status, 200);
    t.mock.method(Date, "now", () => nextSession.expiresAt + 1);
    assert.equal((await call("/runtime", undefined, nextSession.token)).status, 401);
    t.mock.restoreAll();
  } finally {
    b.server.closeAllConnections();
    await new Promise<void>((r) => b.server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
