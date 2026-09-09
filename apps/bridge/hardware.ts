import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statfs, mkdir } from "node:fs/promises";
import { DeviceProfileSchema, type DeviceProfile } from "../../packages/protocol/index.ts";
const exec = promisify(execFile);
const G = 1073741824;
async function command(file: string, args: string[]) {
  try {
    return (await exec(file, args, { timeout: 20000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  } catch {
    return "";
  }
}
export async function detectHardware(dataDir: string, previous?: DeviceProfile | null): Promise<DeviceProfile> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const disk = await statfs(dataDir);
  const supported = os.platform() === "darwin" && os.arch() === "arm64";
  let hw: any = {},
    gpu: any = {},
    version = os.release();
  // Hardware identity is stable for the helper process; memory and disk are not.
  if (os.platform() === "darwin" && !previous) {
    const [prof, ver] = await Promise.all([
      command("/usr/sbin/system_profiler", ["SPHardwareDataType", "SPDisplaysDataType", "-json"]),
      command("/usr/bin/sw_vers", ["-productVersion"]),
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
    const vm = await command("/usr/bin/vm_stat", []);
    const pageSize = Number(vm.match(/page size of (\d+) bytes/)?.[1]) || 16384;
    const pages = (name: string) => Number(vm.match(new RegExp(name + ":\\s+(\\d+)"))?.[1]) || 0;
    available =
      ((pages("Pages free") + pages("Pages inactive") + pages("Pages speculative")) * pageSize) /
        G || available;
  }
  const chip = hw.chip_type || os.cpus()[0]?.model || "Unknown";
  return DeviceProfileSchema.parse({
    os: os.platform(),
    osVersion: previous?.osVersion ?? version,
    architecture: os.arch(),
    supported,
    model: previous?.model ?? hw.machine_model ?? "Unknown",
    chip: previous?.chip ?? chip,
    cpuCores: os.cpus().length,
    gpuCores: previous?.gpuCores ?? (Number(gpu.sppci_cores) || null),
    memoryGB: os.totalmem() / G,
    freeMemoryGB: available,
    diskFreeGB: (disk.bavail * disk.bsize) / G,
    metal: previous?.metal ?? gpu.spdisplays_metal ?? null,
    neuralEngine: null,
    bandwidthGBs: null,
    powerMode: null,
  });
}
