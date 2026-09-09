import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statfs, mkdir } from "node:fs/promises";
import { DeviceProfileSchema, type DeviceProfile } from "../../packages/protocol/index.ts";
import { detectWindowsHardware, isSupportedHardware, type HardwareCommand } from "./windows-hardware.ts";
const exec = promisify(execFile);
const G = 1073741824;
async function command(file: string, args: string[]) {
  try {
    return (await exec(file, args, {
      timeout: os.platform() === "win32" ? 10000 : 20000,
      maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false, encoding: "utf8",
    })).stdout.trim();
  } catch {
    return "";
  }
}
export async function detectHardware(
  dataDir: string,
  previous?: DeviceProfile | null,
  runCommand: HardwareCommand = command,
): Promise<DeviceProfile> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const disk = await statfs(dataDir);
  const platform = os.platform(), architecture = os.arch();
  if (previous?.os !== platform || previous?.architecture !== architecture) previous = undefined;
  const windows = platform === "win32"
    ? await detectWindowsHardware(runCommand, os.release(), architecture, previous)
    : undefined;
  const supported = (windows?.supported ?? isSupportedHardware(platform, architecture, os.release())) &&
    (platform !== "win32" || isSupportedHardware(platform, architecture, os.release(), os.machine()));
  let hw: any = {},
    gpu: any = {},
    version = os.release();
  // Hardware identity is stable for the helper process; memory and disk are not.
  if (os.platform() === "darwin" && !previous) {
    const [prof, ver] = await Promise.all([
      runCommand("/usr/sbin/system_profiler", ["SPHardwareDataType", "SPDisplaysDataType", "-json"]),
      runCommand("/usr/bin/sw_vers", ["-productVersion"]),
    ]);
    try {
      const data = JSON.parse(prof);
      hw = data.SPHardwareDataType?.[0] ?? {};
      gpu = data.SPDisplaysDataType?.[0] ?? {};
    } catch {}
    version = ver || version;
  }
  let available = os.freemem() / G;
  if (os.platform() === "darwin") {
    const vm = await runCommand("/usr/bin/vm_stat", []);
    const pageSize = Number(vm.match(/page size of (\d+) bytes/)?.[1]) || 16384;
    const pages = (name: string) => Number(vm.match(new RegExp(name + ":\\s+(\\d+)"))?.[1]) || 0;
    available =
      ((pages("Pages free") + pages("Pages inactive") + pages("Pages speculative")) * pageSize) /
        G || available;
  }
  const chip = hw.chip_type || os.cpus()[0]?.model || "Unknown";
  return DeviceProfileSchema.parse({
    os: platform,
    osVersion: windows?.osVersion ?? previous?.osVersion ?? version,
    architecture,
    supported,
    model: windows?.model ?? previous?.model ?? hw.machine_model ?? "Unknown",
    chip: windows?.chip ?? previous?.chip ?? chip,
    cpuCores: previous?.cpuCores ?? os.cpus().length,
    gpuCores: windows ? null : previous?.gpuCores ?? (Number(gpu.sppci_cores) || null),
    ...(windows ? { gpus: windows.gpus, gpuDetectionComplete: windows.gpuDetectionComplete } : {}),
    memoryGB: os.totalmem() / G,
    freeMemoryGB: available,
    diskFreeGB: (disk.bavail * disk.bsize) / G,
    metal: windows ? null : previous?.metal ?? gpu.spdisplays_metal ?? null,
    neuralEngine: null,
    bandwidthGBs: null,
    powerMode: null,
  });
}
