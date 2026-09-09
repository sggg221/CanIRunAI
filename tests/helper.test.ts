import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pairingURL, PUBLIC_SITE, supportedNode } from "../scripts/helper.ts";
import { Manager } from "../apps/bridge/manager.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
test("helper pairs only with the public site using a fragment, never a query", () => {
  const url = new URL(pairingURL("12345678"));
  assert.equal(PUBLIC_SITE, "https://sggg221.github.io/CanIRunAI/");
  assert.equal(url.origin, "https://sggg221.github.io");
  assert.equal(url.pathname, "/CanIRunAI/");
  assert.equal(url.search, "");
  assert.equal(url.hash, "#pair=12345678");
  for (const value of ["1234", "12345678&token=secret", "abcdefgh"])
    assert.throws(() => pairingURL(value));
  for (const version of ["18.20.0", "20.19.0", "22.12.9"]) assert.equal(supportedNode(version), false);
  for (const version of ["22.13.0", "22.14.0", "24.0.0"]) assert.equal(supportedNode(version), true);
});

test("device polling coalesces detection and refreshes resources after ten seconds", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-hardware-"));
  try {
    const manager = new Manager(dir);
    let now = Date.now();
    t.mock.method(Date, "now", () => now);
    const [first, concurrent] = await Promise.all([manager.device(false), manager.device(false)]);
    assert.equal(first, concurrent);
    now += 3000;
    assert.equal(await manager.device(false), first);
    now += 7001;
    const refreshed = await manager.device(false);
    assert.notEqual(refreshed, first);
    assert.equal(refreshed.chip, first.chip);
    assert.notEqual(await manager.device(), refreshed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("helper ZIP is deterministic, allowlisted, executable and starts without frontend source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-package-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    for (const name of ["first.zip", "second.zip"])
      await exec(process.execPath, ["scripts/package-helper.mjs", "--output", path.join(dir, name)], { cwd: root });
    assert.deepEqual(await readFile(path.join(dir, "first.zip")), await readFile(path.join(dir, "second.zip")));
    const { stdout } = await exec("python3", ["-c", `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    entries = [{"name": i.filename, "mode": (i.external_attr >> 16) & 0o777, "date": i.date_time} for i in z.infolist()]
    z.extractall(sys.argv[2])
    print(json.dumps(entries))
`, path.join(dir, "first.zip"), dir]);
    const entries = JSON.parse(stdout) as {name: string; mode: number; date: number[]}[];
    const names = entries.map(e => e.name.replace("CanIRunAI-Helper/", ""));
    assert.deepEqual(names.sort(), [
      "Start CanIRunAI Helper.command", "docs/HELPER.md", "scripts/helper.ts",
      "apps/bridge/server.ts", "apps/bridge/hardware.ts", "apps/bridge/manager.ts", "apps/bridge/runtime.ts", "apps/bridge/chat.ts",
      "packages/protocol/index.ts", "packages/model-registry/index.ts", "packages/model-registry/models.json",
      "packages/runtime-registry/index.ts", "packages/compatibility-engine/index.ts", "package.json", "package-lock.json",
    ].sort());
    for (const entry of entries) {
      assert.equal(entry.mode, entry.name.endsWith(".command") ? 0o755 : 0o644);
      assert.deepEqual(entry.date, [1980, 1, 1, 0, 0, 0]);
      assert.ok(!/(node_modules|apps\/(web|site)|\.env|state\.json|secret|token|\.log)/.test(entry.name));
    }
    const unpacked = path.join(dir, "CanIRunAI-Helper");
    const manifest = JSON.parse(await readFile(path.join(unpacked, "package.json"), "utf8"));
    const lock = JSON.parse(await readFile(path.join(unpacked, "package-lock.json"), "utf8"));
    for (const key of ["name", "version", "dependencies", "devDependencies", "engines"])
      assert.deepEqual(manifest[key], lock.packages[""][key]);
    assert.deepEqual(Object.keys(manifest.scripts).sort(), ["bridge", "helper", "start"]);
    // Reuse installed dependencies only; all first-party imports must resolve within the ZIP.
    await symlink(path.join(root, "node_modules"), path.join(unpacked, "node_modules"), "dir");
    child = spawn(process.execPath, ["--import", "tsx", "scripts/helper.ts"], {
      cwd: unpacked,
      env: { ...process.env, CANIRUN_NO_OPEN: "1", CANIRUN_DATA_DIR: path.join(dir, "state") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout!.on("data", chunk => { output += String(chunk); });
    child.stderr!.on("data", chunk => { output += String(chunk); });
    for (let i = 0; i < 100 && !output.includes("本机配对码："); i++) {
      if (child.exitCode !== null) assert.fail(output);
      await new Promise(r => setTimeout(r, 50));
    }
    assert.match(output, /本机配对码：\d{8}/);
    assert.match(output, /仅监听本机 http:\/\/127\.0\.0\.1:31415/);
    assert.ok(!output.includes("#pair="));
    const health = await fetch("http://127.0.0.1:31415/health", { headers: { Origin: "https://sggg221.github.io" } });
    assert.equal(health.status, 200);
    assert.equal((await health.json() as any).name, "CanIRunAI Bridge");
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>(resolve => child!.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
