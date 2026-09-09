import test from "node:test";
import assert from "node:assert/strict";
import { BridgeClient } from "../apps/site/src/bridge.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const oldToken = "a".repeat(64),
  newToken = "b".repeat(64);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("session rotation holds new deployment and chat requests until the replacement token arrives", async () => {
  const started = deferred(),
    release = deferred();
  const paths: string[] = [];
  let validToken = oldToken;
  const client = new BridgeClient(
    () => {},
    async (url, init) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      const token = new Headers(init?.headers).get("Authorization");
      if (token !== `Bearer ${validToken}`)
        return Response.json(
          { error: { message: "stale token" } },
          { status: 401 },
        );
      if (path === "/session/rotate") {
        validToken = newToken;
        started.resolve();
        await release.promise;
        return Response.json({
          token: newToken,
          expiresAt: Date.now() + 900_000,
        });
      }
      if (path === "/action") return Response.json({ result: "accepted" });
      if (path === "/v1/chat/completions")
        return new Response(
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
        );
      throw new Error(path);
    },
  );
  client.restore({ token: oldToken, expiresAt: Date.now() + 500_000 });
  const rotation = client.rotate();
  await started.promise;
  const action = client.action({ action: "deploy", model_id: "qwen3-0.6b" });
  let text = "";
  const chat = client.chat(
    {
      model: "qwen3-0.6b",
      messages: [{ role: "user", content: "test" }],
      stream: true,
      max_tokens: 1,
      temperature: 0,
    },
    new AbortController().signal,
    (answer) => {
      text = answer;
    },
  );
  await tick();
  assert.deepEqual(paths, ["/session/rotate"]);
  release.resolve();
  const [, result] = await Promise.all([rotation, action, chat]);
  assert.equal(result, "accepted");
  assert.equal(text, "ok");
  assert.equal(client.authenticated, true);
});

test("rotation waits for already-dispatched authentication and coalesces concurrent renewals", async () => {
  const actionStarted = deferred(),
    actionRelease = deferred();
  const paths: string[] = [];
  const client = new BridgeClient(
    () => {},
    async (url, init) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path === "/action") {
        actionStarted.resolve();
        await actionRelease.promise;
        return Response.json({ result: true });
      }
      assert.equal(path, "/session/rotate");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${oldToken}`,
      );
      return Response.json({
        token: newToken,
        expiresAt: Date.now() + 900_000,
      });
    },
  );
  client.restore({ token: oldToken, expiresAt: Date.now() + 500_000 });
  const action = client.action({
    action: "stop_model",
    model_id: "qwen3-0.6b",
  });
  await actionStarted.promise;
  const first = client.rotate(),
    second = client.rotate();
  assert.equal(first, second);
  await tick();
  assert.deepEqual(paths, ["/action"]);
  actionRelease.resolve();
  await Promise.all([action, first, second]);
  assert.deepEqual(paths, ["/action", "/session/rotate"]);
});

test("disconnect during renewal prevents waiting commands from running or restoring a token", async () => {
  const started = deferred(),
    release = deferred();
  let actions = 0;
  const client = new BridgeClient(
    () => {},
    async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/session/rotate") {
        started.resolve();
        await release.promise;
        return Response.json({
          token: newToken,
          expiresAt: Date.now() + 900_000,
        });
      }
      if (path === "/session/revoke") return Response.json({ ok: true });
      actions++;
      return Response.json({ result: true });
    },
  );
  client.restore({ token: oldToken, expiresAt: Date.now() + 500_000 });
  const rotation = client.rotate();
  await started.promise;
  const action = client.action({ action: "deploy", model_id: "qwen3-0.6b" });
  const stopped = Promise.allSettled([rotation, action]);
  await client.disconnect();
  release.resolve();
  assert.ok((await stopped).every((result) => result.status === "rejected"));
  assert.equal(actions, 0);
  assert.equal(client.authenticated, false);
});
