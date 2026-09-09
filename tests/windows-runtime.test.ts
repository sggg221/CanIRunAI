import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import { getRuntime, runtime, windowsRuntime, runtimeInstallBytes, runtimeExtractionLimit } from "../packages/runtime-registry/index.ts";
import { runtimeCandidates, runtimeTargetSupported, runtimeSpawnOptions, startRuntime, installRuntime } from "../apps/bridge/runtime.ts";
import { downloadVerifiedArchive, validateArchivePath, validateZipEntries, validateZipArchive, windowsExtractionCommand } from "../apps/bridge/runtime-archive.ts";

const offline = async () => ({ available: false, version: null });
const winTarget = { platform: "win32" as const, arch: "x64", osRelease: "10.0.19045" };
async function temporary(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "runtime 空 格-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
function response(data: Uint8Array, chunkSize = 3) {
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset === data.length) return controller.close();
    controller.enqueue(data.subarray(offset, offset + chunkSize));
    offset = Math.min(data.length, offset + chunkSize);
  } }));
}
function pinned(data: Uint8Array) {
  return { bytes: data.length, checksum: createHash("sha256").update(data).digest("hex") };
}
function zip(entries = [{ name: "ollama.exe", bytes: 5, externalAttributes: 0x20 }]) {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  const directory = Buffer.concat(entries.map((entry) => {
    const name = Buffer.from(entry.name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt32LE(entry.bytes, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entry.externalAttributes >>> 0, 38);
    return Buffer.concat([header, name]);
  }));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, directory, end]);
}

test("platform selector preserves macOS export and pins official Windows amd64 ZIP", () => {
  assert.equal(getRuntime("darwin", "arm64"), runtime);
  assert.equal(getRuntime("win32", "x64"), windowsRuntime);
  assert.equal(windowsRuntime.version, "0.33.3");
  assert.equal(windowsRuntime.source, "https://github.com/ollama/ollama/releases/download/v0.33.3/ollama-windows-amd64.zip");
  assert.equal(windowsRuntime.bytes, 1469175900);
  assert.equal(windowsRuntime.checksum, "52cb36a62e7e501f61514f60212dec7117b6c098811357585e02fffe32d2fcd7");
  for (const [platform, arch] of [["win32", "arm64"], ["win32", "ia32"], ["darwin", "x64"], ["linux", "x64"]])
    assert.equal(getRuntime(platform!, arch!), null);
  assert.equal(runtimeInstallBytes("win32", "x64"), 1469175900 + 3 * 1024 ** 3 + 512 * 1024 ** 2);
  assert.ok(runtimeExtractionLimit("win32") > 1953507607);
});
test("runtime gate requires x64 Windows 10 19045+ or Windows 11 and preserves Mac arm64", () => {
  for (const version of ["10.0.19045", "10.0.22631", "10.0.26100.1234"])
    assert.equal(runtimeTargetSupported("win32", "x64", version), true);
  for (const version of ["10.0.19044", "6.3.9600", "invalid", "11"])
    assert.equal(runtimeTargetSupported("win32", "x64", version), false);
  assert.equal(runtimeTargetSupported("win32", "x64", "10.0.26100", "ARM64"), false);
  assert.equal(runtimeTargetSupported("win32", "arm64", "10.0.26100"), false);
  assert.equal(runtimeTargetSupported("darwin", "arm64", "24.0.0"), true);
});
test("Windows discovery uses fixed absolute paths including spaces and Unicode, never PATH or cwd", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\小 明\\AppData\\Local", ProgramFiles: "D:\\Program Files", PATH: "C:\\malicious" };
  assert.deepEqual(runtimeCandidates("C:\\Users\\小 明\\Can I Run", "win32", env), [
    "C:\\Users\\小 明\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
    "C:\\Users\\小 明\\Can I Run\\runtime\\ollama.exe",
    "D:\\Program Files\\Ollama\\ollama.exe",
  ]);
  assert.deepEqual(runtimeCandidates("relative", "win32", { LOCALAPPDATA: ".", ProgramFiles: ".." }), []);
  assert.deepEqual(runtimeCandidates("/tmp/helper", "linux", {}), []);
});
test("Windows spawn uses serve directly and enforces loopback and no-cloud environment", async () => {
  let started = false;
  const calls: unknown[][] = [];
  const spawnFake = ((...args: unknown[]) => {
    calls.push(args);
    started = true;
    return Object.assign(new EventEmitter(), { kill() {} });
  }) as unknown as typeof spawn;
  await startRuntime("C:\\用户 空间\\helper", { ...winTarget, env: { LOCALAPPDATA: "C:\\用户 空间\\Local" },
    status: async () => ({ available: started, version: started ? "0.33.3" : null }),
    access: async () => {}, spawn: spawnFake, sleep: async () => {} });
  assert.equal(calls[0]![0], "C:\\用户 空间\\Local\\Programs\\Ollama\\ollama.exe");
  assert.deepEqual(calls[0]![1], ["serve"]);
  const options = runtimeSpawnOptions({ OLLAMA_HOST: "0.0.0.0:11434", OLLAMA_NO_CLOUD: "0" });
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.equal(options.env!.OLLAMA_HOST, "127.0.0.1:11434");
  assert.equal(options.env!.OLLAMA_NO_CLOUD, "1");
});
test("start leaves a running external daemon untouched and rejects unsupported targets", async () => {
  const unexpected = async () => { throw new Error("must not inspect executable"); };
  await startRuntime("C:\\helper", { ...winTarget, status: async () => ({ available: true, version: "0.33.3" }), access: unexpected });
  await assert.rejects(startRuntime("C:\\helper", { ...winTarget, arch: "arm64", status: offline, access: unexpected }), /unsupported/);
});
test("archive streams to a Unicode directory and verifies exact bytes and SHA256", async () => temporary(async (dir) => {
  const bytes = Buffer.from("verified streamed archive");
  const archive = path.join(dir, "runtime.zip");
  await downloadVerifiedArchive(response(bytes), archive, pinned(bytes));
  assert.deepEqual(await readFile(archive), bytes);
}));
test("bad hash, truncation, oversized stream and wrong length never leave an archive", async () => temporary(async (dir) => {
  const data = Buffer.from("archive");
  for (const [body, expected, error] of [
    [response(data), { ...pinned(data), checksum: "0".repeat(64) }, /checksum/],
    [response(data.subarray(1)), pinned(data), /size mismatch/],
    [response(Buffer.concat([data, data])), pinned(data), /exceeds pinned size/],
    [new Response(data, { headers: { "content-length": "900" } }), pinned(data), /size mismatch/],
  ] as const) {
    const archive = path.join(dir, "runtime.zip");
    await assert.rejects(downloadVerifiedArchive(body, archive, expected), error);
    assert.deepEqual(await readdir(dir), []);
  }
}));
test("ZIP paths reject traversal, Windows separator tricks, devices, ADS, links and bombs", () => {
  for (const name of ["../bad", "lib/../../bad", "/absolute", "C:/absolute", "C:\\absolute", "lib\\..\\bad", "\\\\host\\share", "lib/file:ads", "lib/NUL", "lib/file. ", "lib//file"])
    assert.throws(() => validateArchivePath(name), /Unsafe/);
  validateArchivePath("lib/文件 name.dll");
  assert.throws(() => validateZipEntries([{ name: "link", bytes: 0, externalAttributes: 0xa1ff0000 }], 100), /links/);
  assert.throws(() => validateZipEntries([{ name: "link", bytes: 0, externalAttributes: 0x400 }], 100), /links/);
  assert.throws(() => validateZipEntries([{ name: "big", bytes: 101, externalAttributes: 0 }], 100), /extraction limit/);
  assert.throws(() => validateZipEntries([{ name: "a", bytes: 1, externalAttributes: 0 }, { name: "A", bytes: 1, externalAttributes: 0 }], 100), /Duplicate/);
});
test("bounded ZIP directory reader validates paths, footprint and required executable", async () => temporary(async (dir) => {
  const archive = path.join(dir, "archive.zip");
  await writeFile(archive, zip());
  assert.equal(await validateZipArchive(archive, 100), 5);
  await assert.rejects(validateZipArchive(archive, 4), /extraction limit/);
  await writeFile(archive, zip([{ name: "../escape", bytes: 0, externalAttributes: 0 }, { name: "ollama.exe", bytes: 5, externalAttributes: 0 }]));
  await assert.rejects(validateZipArchive(archive, 100), /Unsafe/);
  await writeFile(archive, zip([{ name: "other.exe", bytes: 0, externalAttributes: 0 }]));
  await assert.rejects(validateZipArchive(archive, 100), /missing ollama.exe/);
  await writeFile(archive, Buffer.from("not a ZIP"));
  await assert.rejects(validateZipArchive(archive, 100), /Invalid/);
}));
test("native Windows extraction arguments are fixed and paths remain environment data", () => {
  const archive = "C:\\用户 空间\\a';$(whoami).zip";
  const staging = "C:\\用户 空间\\stage";
  const command = windowsExtractionCommand(archive, staging, { SystemRoot: "C:\\Windows" });
  assert.equal(command.file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(command.args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
  assert.equal(command.options.shell, false);
  assert.equal(command.options.env.CANIRUNAI_ARCHIVE, archive);
  assert.equal(command.options.env.CANIRUNAI_STAGING, staging);
  assert.ok(!command.args.join(" ").includes(archive));
  assert.doesNotMatch(command.args.join(" "), /ExecutionPolicy|Set-MpPreference|Unblock-File/);
  assert.equal(windowsExtractionCommand(archive, staging, { SystemRoot: "C:\\attacker" }).file,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
});
test("install starts an existing runtime before any download and never replaces running external runtime", async () => {
  let available = false;
  let starts = 0;
  const unexpected = async () => { throw new Error("must not download"); };
  const status = async () => ({ available, version: available ? "0.33.3" : null });
  const deps = { ...winTarget, status, start: async () => { starts++; available = true; }, download: unexpected };
  await installRuntime("unused", deps);
  assert.equal(starts, 1);
  await installRuntime("unused", deps);
  assert.equal(starts, 1);
  await assert.rejects(installRuntime("unused", { ...deps, osRelease: "10.0.19044" }), /unsupported/);
});
test("failed extraction retains prior runtime and removes all staging/download files", async () => temporary(async (dir) => {
  await mkdir(path.join(dir, "runtime"));
  await writeFile(path.join(dir, "runtime", "ollama.exe"), "previous");
  let starts = 0;
  await assert.rejects(installRuntime(dir, { ...winTarget, status: offline,
    start: async () => { starts++; throw new Error("not running"); }, freeBytes: async () => 100 * 1024 ** 3,
    download: async (_url, archive) => { await writeFile(archive, "download"); },
    extract: async (_archive, staging) => { await writeFile(path.join(staging, "partial"), "partial"); throw new Error("extract failed"); },
  }), /extract failed/);
  assert.equal(starts, 1);
  assert.equal(await readFile(path.join(dir, "runtime", "ollama.exe"), "utf8"), "previous");
  assert.deepEqual(await readdir(dir), ["runtime"]);
}));
test("installation rolls back prior runtime if starting the newly extracted runtime fails", async () => temporary(async (dir) => {
  await mkdir(path.join(dir, "runtime"));
  await writeFile(path.join(dir, "runtime", "ollama.exe"), "previous");
  await assert.rejects(installRuntime(dir, { ...winTarget, status: offline,
    start: async () => { throw new Error("start failed"); }, freeBytes: async () => 100 * 1024 ** 3,
    download: async (_url, archive) => { await writeFile(archive, "download"); },
    extract: async (_archive, staging) => { await writeFile(path.join(staging, "ollama.exe"), "new"); },
  }), /start failed/);
  assert.equal(await readFile(path.join(dir, "runtime", "ollama.exe"), "utf8"), "previous");
  assert.deepEqual(await readdir(dir), ["runtime"]);
}));
test("disk preflight reserves archive plus extracted headroom before downloading", async () => temporary(async (dir) => {
  let downloads = 0;
  await assert.rejects(installRuntime(dir, { ...winTarget, status: offline,
    start: async () => { throw new Error("missing"); }, freeBytes: async () => windowsRuntime.bytes,
    download: async () => { downloads++; },
  }), /Insufficient storage/);
  assert.equal(downloads, 0);
  assert.deepEqual(await readdir(dir), []);
}));
test("successful portable installation promotes only extracted files and cleans its workspace", async () => temporary(async (dir) => {
  let starts = 0;
  let available = false;
  await installRuntime(dir, { ...winTarget,
    status: async () => ({ available, version: available ? "0.33.3" : null }),
    start: async () => { if (++starts === 1) throw new Error("missing"); available = true; },
    freeBytes: async () => 100 * 1024 ** 3,
    download: async (_url, archive) => { await writeFile(archive, "download"); },
    extract: async (_archive, staging) => { await writeFile(path.join(staging, "ollama.exe"), "new"); },
  });
  assert.equal(starts, 2);
  assert.equal(await readFile(path.join(dir, "runtime", "ollama.exe"), "utf8"), "new");
  assert.deepEqual(await readdir(dir), ["runtime"]);
}));
test("a daemon appearing during extraction prevents promotion or restart", async () => temporary(async (dir) => {
  let available = false;
  let starts = 0;
  await installRuntime(dir, { ...winTarget,
    status: async () => ({ available, version: available ? "0.33.3" : null }),
    start: async () => { starts++; throw new Error("missing"); },
    freeBytes: async () => 100 * 1024 ** 3,
    download: async (_url, archive) => { await writeFile(archive, "download"); },
    extract: async () => { available = true; },
  });
  assert.equal(starts, 1);
  assert.deepEqual(await readdir(dir), []);
}));
test("verification failure prevents extraction and any new executable start", async () => temporary(async (dir) => {
  let starts = 0;
  let extractions = 0;
  await assert.rejects(installRuntime(dir, { ...winTarget, status: offline,
    start: async () => { starts++; throw new Error("missing"); },
    freeBytes: async () => 100 * 1024 ** 3,
    download: async (_url, archive) => {
      const data = Buffer.from("bad archive");
      await downloadVerifiedArchive(response(data), archive, { ...pinned(data), checksum: "0".repeat(64) });
    },
    extract: async () => { extractions++; },
  }), /checksum/);
  assert.equal(starts, 1);
  assert.equal(extractions, 0);
  assert.deepEqual(await readdir(dir), []);
}));
