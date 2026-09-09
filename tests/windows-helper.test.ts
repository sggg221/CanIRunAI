import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browserCommand, helperDataDir } from "../scripts/helper.ts";
import { BridgeStatusSchema } from "../apps/site/src/bridge.ts";
import { configurationURL, defaults, deviceFromConfiguration, readConfigurationURL, recommendations } from "../apps/site/src/catalog.ts";
import { models } from "../packages/model-registry/index.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test("Windows helper uses per-user data paths and a fixed browser command without a shell", () => {
  assert.equal(helperDataDir("win32", "C:\\Users\\测试 User", {}), "C:\\Users\\测试 User\\AppData\\Local\\CanIRunAI");
  assert.equal(helperDataDir("win32", "C:\\Users\\ignored", { LOCALAPPDATA: "D:\\用户 Files\\Local" }), "D:\\用户 Files\\Local\\CanIRunAI");
  assert.equal(helperDataDir("win32", "ignored", { CANIRUN_DATA_DIR: "D:\\private" }), "D:\\private");
  const browser = browserCommand("12345678", "win32", { SystemRoot: "C:\\Windows" });
  assert.deepEqual(browser, {
    file: "C:\\Windows\\System32\\rundll32.exe",
    args: ["url.dll,FileProtocolHandler", "https://sggg221.github.io/CanIRunAI/#pair=12345678"],
  });
  assert.throws(() => browserCommand("12345678&calc", "win32"));
  assert.equal(browserCommand("12345678", "linux"), null);
  assert.equal(browserCommand("12345678", "darwin")?.file, "/usr/bin/open");
});

test("Windows configuration sharing retains Windows instead of silently becoming a Mac", () => {
  const config = { ...defaults, platform: "windows" as const };
  const url = configurationURL("https://example.com/CanIRunAI/?old=1#pair=12345678", config);
  assert.deepEqual(readConfigurationURL(url), config);
  assert.ok(!url.includes("pair="));
  assert.equal(new URL(url).search, "");
  const device = deviceFromConfiguration(config);
  assert.equal(device.os, "win32");
  assert.equal(device.architecture, "x64");
  assert.equal(device.model, "手动配置");
  assert.equal(device.bandwidthGBs, null);
  assert.ok(recommendations(config, models).some(entry => entry.result.compatible));
});

test("helper packaging ignores Python's console encoding and preserves Chinese source bytes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirun-encoding-"));
  try {
    const first = path.join(dir, "normal.zip"), second = path.join(dir, "legacy-codepage.zip");
    await exec(process.execPath, ["scripts/package-helper.mjs", "--output", first], { cwd: root });
    await exec(process.execPath, ["scripts/package-helper.mjs", "--output", second], {
      cwd: root, env: { ...process.env, PYTHONIOENCODING: "ascii:surrogateescape" },
    });
    assert.deepEqual(await readFile(first), await readFile(second));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Windows launcher is CRLF and does not bypass security or auto-install models", async () => {
  const launcher = await readFile(path.join(root, "Start CanIRunAI Helper.cmd"), "utf8");
  assert.ok(launcher.includes("\r\n"));
  assert.ok(!launcher.replaceAll("\r\n", "").includes("\n"));
  assert.ok(launcher.includes('cd /d "%~dp0"'));
  assert.ok(launcher.includes("DisableDelayedExpansion"));
  assert.ok(launcher.includes("call npm ci --include=dev --no-audit --no-fund"));
  assert.ok(launcher.includes("call npm run helper"));
  assert.doesNotMatch(launcher, /ExecutionPolicy|Unblock-File|runas|Set-MpPreference|ollama (pull|serve)/i);
});

test("Windows ZIP launcher pairs over real HTTP and detects the actual CI computer", { timeout: 180000 }, async (t) => {
  if (process.platform !== "win32") return t.skip("Requires native Windows; Linux fixtures do not verify CMD or CIM execution");
  const dir = await mkdtemp(path.join(os.tmpdir(), "CanIRunAI 测试 & space-"));
  let child: ReturnType<typeof spawn> | undefined;
  let output = "";
  try {
    const zip = path.join(dir, "helper.zip");
    await exec(process.execPath, ["scripts/package-helper.mjs", "--output", zip], { cwd: root });
    await exec("python", ["-c", "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, dir]);
    const unpacked = path.join(dir, "CanIRunAI-Helper");
    child = spawn(path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
      ["/d", "/s", "/c", 'call "Start CanIRunAI Helper.cmd"'], {
        cwd: unpacked,
        env: { ...process.env, CANIRUN_NO_OPEN: "1", CANIRUN_DATA_DIR: path.join(dir, "state") },
        windowsVerbatimArguments: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    child.stdout!.on("data", chunk => { output += String(chunk); });
    child.stderr!.on("data", chunk => { output += String(chunk); });
    const deadline = Date.now() + 120000;
    while (!/本机配对码：\d{8}/.test(output) && Date.now() < deadline) {
      if (child.exitCode !== null) assert.fail(output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const code = output.match(/本机配对码：(\d{8})/)?.[1];
    assert.ok(code, output);
    const headers = { Origin: "https://sggg221.github.io", "Content-Type": "application/json" };
    const request = (endpoint: string, body?: unknown, token?: string) => fetch(`http://127.0.0.1:31415${endpoint}`, {
      method: body ? "POST" : "GET", headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
    });
    const challenge = await (await request("/challenge", {})).json() as { challenge: string };
    const paired = await request("/pair", { challenge: challenge.challenge, code });
    assert.equal(paired.status, 200);
    const session = await paired.json() as { token: string };
    const result = await request("/status", undefined, session.token);
    assert.equal(result.status, 200);
    const status = BridgeStatusSchema.parse(await result.json());
    assert.equal(status.device.os, "win32");
    assert.equal(status.device.architecture, "x64");
    assert.equal(status.device.cpuCores, os.cpus().length);
    assert.equal(status.device.memoryGB, os.totalmem() / 1073741824);
    assert.ok(status.device.diskFreeGB > 0);
    assert.ok(status.device.freeMemoryGB <= status.device.memoryGB);
    assert.ok(Array.isArray(status.device.gpus));
    assert.notEqual(status.device.model, "Unknown", "CIM should identify the real Windows runner");
    const detected = await request("/action", { action: "detect_hardware" }, session.token);
    assert.equal(detected.status, 200);
    assert.ok(!output.includes("#pair="));
    const revoked = await request("/session/revoke", {}, session.token);
    assert.equal(revoked.status, 200);
    assert.equal((await request("/status", undefined, session.token)).status, 401);
  } finally {
    if (child?.pid && child.exitCode === null) {
      await exec("taskkill", ["/pid", String(child.pid), "/t", "/f"]).catch(() => {});
      if (child.exitCode === null) await new Promise<void>(resolve => child!.once("exit", () => resolve()));
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
});
