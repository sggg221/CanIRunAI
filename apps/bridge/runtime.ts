import { access, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { runtime } from "../../packages/runtime-registry/index.ts";
const exec = promisify(execFile);
export const OLLAMA = "http://127.0.0.1:11434";
export async function ollama(endpoint: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const r = await fetch(OLLAMA + endpoint, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 500));
  return r.json();
}
export async function runtimeStatus() {
  try {
    const r = await ollama("/api/version", undefined, AbortSignal.timeout(1800));
    return { available: true, version: r.version };
  } catch {
    return { available: false, version: null };
  }
}
export async function startRuntime(dataDir: string) {
  if ((await runtimeStatus()).available) return;
  for (const bin of [
    path.join(dataDir, "runtime/bin/ollama"),
    path.join(dataDir, "runtime/ollama"),
    "/opt/homebrew/bin/ollama",
    "/usr/local/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
  ]) {
    try {
      await access(bin);
    } catch {
      continue;
    }
    const child = spawn(bin, ["serve"], {
      shell: false,
      stdio: "ignore",
      detached: false,
      env: {
        ...process.env,
        OLLAMA_HOST: "127.0.0.1:11434",
        OLLAMA_NO_CLOUD: "1",
        OLLAMA_MAX_LOADED_MODELS: "1",
        OLLAMA_NUM_PARALLEL: "1",
      },
    });
    child.on("error", () => {});
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if ((await runtimeStatus()).available) return;
    }
    break;
  }
  throw new Error("runtime_missing");
}
export async function installRuntime(dataDir: string) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("unsupported");
  await mkdir(dataDir, { recursive: true });
  const r = await fetch(runtime.source, { signal: AbortSignal.timeout(600000) });
  if (!r.ok) throw new Error("Runtime download failed");
  const buffer = Buffer.from(await r.arrayBuffer());
  if (createHash("sha256").update(buffer).digest("hex") !== runtime.checksum)
    throw new Error("Runtime checksum verification failed");
  const archive = path.join(dataDir, "runtime.tgz");
  await writeFile(archive, buffer, { mode: 0o600 });
  const staging = path.join(dataDir, "runtime-staging");
  await mkdir(staging, { recursive: true });
  const { stdout } = await exec("/usr/bin/tar", ["-tzf", archive]);
  if (stdout.split("\n").some((p) => p.startsWith("/") || p.split("/").includes("..")))
    throw new Error("Unsafe archive paths");
  await exec("/usr/bin/tar", ["-xzf", archive, "-C", staging], { timeout: 120000 });
  await rm(path.join(dataDir, "runtime"), { recursive: true, force: true });
  await rename(staging, path.join(dataDir, "runtime"));
  await rm(archive);
  await startRuntime(dataDir);
}
