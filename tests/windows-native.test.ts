import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractRuntimeArchive } from "../apps/bridge/runtime.ts";

const exec = promisify(execFile);

test("native Windows PowerShell safely extracts fixture bytes from a Unicode path without executing them", async t => {
  if (process.platform !== "win32") return t.skip("Requires native Windows PowerShell and .NET ZIP extraction");
  const dir = await mkdtemp(path.join(os.tmpdir(), "CanIRunAI 解压 空格-"));
  try {
    const archive = path.join(dir, "archive';$(throw 'injection').zip");
    const staging = path.join(dir, "目标 & staging");
    await mkdir(staging);
    await exec("python", ["-c", `
import sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr('ollama.exe', b'TEST FIXTURE ONLY: not an executable')
    z.writestr('lib/', b'')
    z.writestr('lib/test.dll', b'harmless fixture bytes')
`, archive]);
    await extractRuntimeArchive(archive, staging, "win32");
    assert.equal(await readFile(path.join(staging, "ollama.exe"), "utf8"), "TEST FIXTURE ONLY: not an executable");
    assert.equal(await readFile(path.join(staging, "lib", "test.dll"), "utf8"), "harmless fixture bytes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("native Windows rejects traversal fixtures before PowerShell extraction", async t => {
  if (process.platform !== "win32") return t.skip("Requires a native Windows filesystem");
  const dir = await mkdtemp(path.join(os.tmpdir(), "CanIRunAI zip-check-"));
  try {
    const archive = path.join(dir, "unsafe.zip");
    const staging = path.join(dir, "stage");
    await mkdir(staging);
    await exec("python", ["-c", `
import sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('ollama.exe', b'fixture')
    z.writestr('../escaped.txt', b'must not escape')
`, archive]);
    await assert.rejects(extractRuntimeArchive(archive, staging, "win32"), /Unsafe archive paths/);
    assert.deepEqual(await readdir(staging), []);
    await assert.rejects(readFile(path.join(dir, "escaped.txt")), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
