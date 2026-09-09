import { access, mkdir, mkdtemp, rename, rm, statfs } from "node:fs/promises";
import { spawn, execFile, type SpawnOptions } from "node:child_process";
import { promisify } from "node:util";
import { release, machine } from "node:os";
import path from "node:path";
import { getRuntime, runtimeExtractionLimit, runtimeInstallBytes } from "../../packages/runtime-registry/index.ts";
import { downloadVerifiedArchive, validateArchivePath, validateZipArchive, windowsExtractionCommand } from "./runtime-archive.ts";
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
export function runtimeTargetSupported(platform: string, arch: string, osRelease: string, nativeArchitecture = arch) {
  if (!getRuntime(platform, arch)) return false;
  if (platform !== "win32") return true;
  if (/arm|aarch/i.test(nativeArchitecture)) return false;
  const match = /^10\.0\.(\d+)(?:\.\d+)?$/.exec(osRelease);
  return !!match && Number(match[1]) >= 19045;
}
export function runtimeCandidates(dataDir: string, platform = process.platform, env = process.env) {
  if (platform === "win32") {
    const fixed = (root: string | undefined, ...parts: string[]) =>
      root && /^[a-z]:\\/i.test(root) && !root.split(/[\\/]/).includes("..") ? [path.win32.join(root, ...parts)] : [];
    return [
      ...fixed(env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"),
      ...fixed(dataDir, "runtime", "ollama.exe"),
      ...fixed(env.ProgramFiles || "C:\\Program Files", "Ollama", "ollama.exe"),
    ];
  }
  if (platform !== "darwin") return [];
  return [
    path.join(dataDir, "runtime/bin/ollama"),
    path.join(dataDir, "runtime/ollama"),
    "/opt/homebrew/bin/ollama",
    "/usr/local/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
  ];
}
export function runtimeSpawnOptions(env = process.env): SpawnOptions {
  return {
    shell: false,
    stdio: "ignore",
    detached: false,
    windowsHide: true,
    env: { ...env, OLLAMA_HOST: "127.0.0.1:11434", OLLAMA_NO_CLOUD: "1",
      OLLAMA_MAX_LOADED_MODELS: "1", OLLAMA_NUM_PARALLEL: "1" },
  };
}
type StartDependencies = {
  platform: NodeJS.Platform; arch: string; osRelease: string; nativeArchitecture: string; env: NodeJS.ProcessEnv;
  status: typeof runtimeStatus; access: typeof access; spawn: typeof spawn;
  sleep: (ms: number) => Promise<void>;
};
export async function startRuntime(dataDir: string, overrides: Partial<StartDependencies> = {}) {
  const deps: StartDependencies = { platform: process.platform, arch: process.arch, osRelease: release(), nativeArchitecture: machine(),
    env: process.env, status: runtimeStatus, access, spawn,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), ...overrides };
  if ((await deps.status()).available) return;
  if (!runtimeTargetSupported(deps.platform, deps.arch, deps.osRelease, deps.nativeArchitecture)) throw new Error("unsupported");
  for (const bin of runtimeCandidates(dataDir, deps.platform, deps.env)) {
    try { await deps.access(bin); } catch { continue; }
    const child = deps.spawn(bin, ["serve"], runtimeSpawnOptions(deps.env));
    let failed = false;
    child.on("error", () => { failed = true; });
    child.on("exit", () => { failed = true; });
    for (let i = 0; i < 30; i++) {
      await deps.sleep(300);
      if ((await deps.status()).available) return;
      if (failed) break;
    }
    child.kill();
  }
  throw new Error("runtime_missing");
}
export async function extractRuntimeArchive(archive: string, staging: string, platform: string) {
  if (platform === "win32") {
    await validateZipArchive(archive, runtimeExtractionLimit(platform));
    const command = windowsExtractionCommand(archive, staging);
    await exec(command.file, command.args, command.options);
    await access(path.join(staging, "ollama.exe"));
  } else {
    const { stdout } = await exec("/usr/bin/tar", ["-tzf", archive], { maxBuffer: 16 * 1024 ** 2 });
    for (const name of stdout.split("\n").filter(Boolean)) {
      // The official macOS tarball uses a harmless leading './'.
      const normalized = name.replace(/^\.\//, "");
      if (normalized) validateArchivePath(normalized);
    }
    await exec("/usr/bin/tar", ["-xzf", archive, "-C", staging], { timeout: 120000 });
    try { await access(path.join(staging, "bin/ollama")); }
    catch { await access(path.join(staging, "ollama")); }
  }
}
type InstallDependencies = {
  platform: NodeJS.Platform; arch: string; osRelease: string; nativeArchitecture: string;
  status: typeof runtimeStatus; start: (dataDir: string) => Promise<void>;
  download: (source: string, archive: string, pinned: { bytes: number; checksum: string }) => Promise<void>;
  extract: typeof extractRuntimeArchive;
  freeBytes: (directory: string) => Promise<number>;
};
export async function installRuntime(dataDir: string, overrides: Partial<InstallDependencies> = {}) {
  const deps: InstallDependencies = {
    platform: process.platform, arch: process.arch, osRelease: release(), nativeArchitecture: machine(), status: runtimeStatus,
    start: startRuntime,
    download: async (source, archive, pinned) => downloadVerifiedArchive(
      await fetch(source, { signal: AbortSignal.timeout(600000) }), archive, pinned),
    extract: extractRuntimeArchive,
    freeBytes: async (directory) => { const fs = await statfs(directory); return fs.bavail * fs.bsize; },
    ...overrides,
  };
  if (!runtimeTargetSupported(deps.platform, deps.arch, deps.osRelease, deps.nativeArchitecture)) throw new Error("unsupported");
  if ((await deps.status()).available) return;
  try { await deps.start(dataDir); } catch {}
  if ((await deps.status()).available) return;
  const pinned = getRuntime(deps.platform, deps.arch)!;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  if (await deps.freeBytes(dataDir) < runtimeInstallBytes(deps.platform, deps.arch))
    throw new Error("Insufficient storage for runtime archive and extracted files");
  const work = await mkdtemp(path.join(dataDir, "runtime-staging-"));
  const archive = path.join(work, deps.platform === "win32" ? "runtime.zip" : "runtime.tgz");
  const staging = path.join(work, "extracted");
  const target = path.join(dataDir, "runtime");
  const backup = path.join(work, "previous");
  let backedUp = false;
  let promoted = false;
  let preserveBackup = false;
  try {
    await deps.download(pinned.source, archive, pinned);
    await mkdir(staging, { mode: 0o700 });
    await deps.extract(archive, staging, deps.platform);
    if ((await deps.status()).available) return;
    try { await rename(target, backup); backedUp = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await rename(staging, target);
    promoted = true;
    await deps.start(dataDir);
    if (!(await deps.status()).available) throw new Error("Runtime did not become ready after installation");
  } catch (error) {
    try {
      if (promoted) await rm(target, { recursive: true, force: true });
      if (backedUp) await rename(backup, target);
    } catch {
      // Never delete the only surviving prior installation if Windows holds a file open.
      preserveBackup = true;
    }
    throw error;
  } finally {
    if (!preserveBackup) await rm(work, { recursive: true, force: true });
    else {
      await rm(archive, { force: true });
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}
