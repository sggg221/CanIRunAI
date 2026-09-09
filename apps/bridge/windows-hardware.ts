import type { DeviceProfile, GPUProfile } from "../../packages/protocol/index.ts";

export type HardwareCommand = (file: string, args: string[]) => Promise<string>;

// Select only public hardware characteristics; never serialize whole CIM objects.
export const WINDOWS_CIM_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$result = @{ model = $null; cpu = $null; version = $null; productType = $null; gpus = @(); gpuDetectionComplete = $false }
try { $result.model = (Get-CimInstance -ClassName Win32_ComputerSystem -Property Model).Model } catch {}
try { $result.cpu = @((Get-CimInstance -ClassName Win32_Processor -Property Name) | ForEach-Object { $_.Name })[0] } catch {}
try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -Property Version,ProductType
  $result.version = $os.Version
  $result.productType = $os.ProductType
} catch {}
try {
  $result.gpus = @((Get-CimInstance -ClassName Win32_VideoController -Property Name,AdapterCompatibility) | ForEach-Object {
    @{ name = $_.Name; vendor = $_.AdapterCompatibility }
  })
  $result.gpuDetectionComplete = $true
} catch {}
$result | ConvertTo-Json -Depth 4 -Compress
`.trim();

export function isSupportedHardware(platform: string, architecture: string, release: string, nativeArchitecture = architecture) {
  if (platform === "darwin") return architecture === "arm64";
  if (platform !== "win32" || architecture !== "x64" || /arm|aarch/i.test(nativeArchitecture)) return false;
  const version = /^10\.0\.(\d+)(?:\.\d+)?$/.exec(release);
  return !!version && Number(version[1]) >= 19045;
}

export function windowsToolPaths(systemRoot = process.env.SystemRoot) {
  // Reject relative paths, UNC shares and custom search paths, including PATH/cwd.
  const root = systemRoot && /^[a-z]:\\Windows$/i.test(systemRoot) ? systemRoot : "C:\\Windows";
  const drive = root.slice(0, 2);
  return {
    powershell: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    nvidia: [
      `${root}\\System32\\nvidia-smi.exe`,
      `${drive}\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
    ],
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function gpuVendor(name: string): GPUProfile["vendor"] {
  if (/nvidia|geforce|quadro/i.test(name)) return "nvidia";
  if (/\bamd\b|\bati\b|radeon|advanced micro devices/i.test(name)) return "amd";
  if (/intel/i.test(name)) return "intel";
  return "unknown";
}

type CIMHardware = {
  model?: string;
  cpu?: string;
  version?: string;
  productType?: number;
  gpus: GPUProfile[];
  gpuDetectionComplete: boolean;
};

export function parseWindowsCIM(output: string): CIMHardware {
  const empty: CIMHardware = { gpus: [], gpuDetectionComplete: false };
  try {
    const data: unknown = JSON.parse(output.replace(/^\uFEFF/, ""));
    if (!data || typeof data !== "object" || Array.isArray(data)) return empty;
    const record = data as Record<string, unknown>;
    const rows = Array.isArray(record.gpus) ? record.gpus : [];
    const gpus: GPUProfile[] = [];
    let complete = record.gpuDetectionComplete === true && Array.isArray(record.gpus);
    for (const row of rows) {
      const name = text(row?.name);
      if (!name) { complete = false; continue; }
      gpus.push({
        name,
        vendor: gpuVendor(`${name} ${text(row.vendor) ?? ""}`),
        // Win32_VideoController.AdapterRAM is 32-bit and cannot establish VRAM capacity.
        memoryGB: null,
        freeMemoryGB: null,
        source: "cim",
      });
    }
    return {
      model: text(record.model),
      cpu: text(record.cpu),
      version: text(record.version),
      productType: typeof record.productType === "number" ? record.productType : undefined,
      gpus,
      gpuDetectionComplete: complete,
    };
  } catch { return empty; }
}

function csvRow(line: string): string[] | null {
  const fields: string[] = [];
  let value = "", quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else value += ch;
    } else if (ch === ",") {
      fields.push(value.trim()); value = ""; closed = false;
    } else if (ch === '"') {
      if (value.trim() || closed) return null;
      value = ""; quoted = true;
    } else {
      if (closed && ch.trim()) return null;
      value += ch;
    }
  }
  if (quoted) return null;
  fields.push(value.trim());
  return fields;
}

export function parseNvidiaSMI(output: string): GPUProfile[] | null {
  if (!output.trim()) return null;
  const gpus: GPUProfile[] = [];
  for (const line of output.replace(/^\uFEFF/, "").trim().split(/\r?\n/)) {
    const fields = csvRow(line);
    if (!fields || fields.length !== 3 || !fields[0]) return null;
    const memory = fields.slice(1).map(value => {
      if (/^(?:N\/A|\[N\/A\]|\[Not Supported\])$/i.test(value)) return null;
      return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) / 1024 : NaN;
    });
    const [total, free] = memory;
    if (memory.some(value => value !== null && !Number.isFinite(value))) return null;
    if (total !== null && free !== null && free > total) return null;
    gpus.push({ name: fields[0], vendor: "nvidia", memoryGB: total, freeMemoryGB: free, source: "nvidia-smi" });
  }
  return gpus;
}

export async function detectWindowsHardware(
  command: HardwareCommand,
  release: string,
  architecture: string,
  previous?: DeviceProfile | null,
  systemRoot?: string,
) {
  const paths = windowsToolPaths(systemRoot);
  const safeCommand: HardwareCommand = async (file, args) => {
    try { return await command(file, args); } catch { return ""; }
  };
  const cached = previous?.os === "win32" ? previous : undefined;
  const needsCIM = !cached || !cached.gpus || !cached.gpuDetectionComplete;
  const cimPromise = needsCIM
    ? safeCommand(paths.powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_CIM_SCRIPT]).then(parseWindowsCIM)
    : Promise.resolve<CIMHardware>({ gpus: cached.gpus!, gpuDetectionComplete: true });
  const nvidiaPromise = (async () => {
    for (const file of paths.nvidia) {
      const gpus = parseNvidiaSMI(await safeCommand(file, [
        "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits",
      ]));
      if (gpus) return gpus;
    }
    return null;
  })();
  const [cim, nvidia] = await Promise.all([cimPromise, nvidiaPromise]);
  const gpus = cim.gpus.map(gpu => ({ ...gpu, freeMemoryGB: null } as GPUProfile));
  if (nvidia) {
    // Match one adapter at a time so identical cards retain their own memory readings.
    const remaining = [...nvidia];
    for (let i = 0; i < gpus.length; i++) {
      if (gpus[i].vendor !== "nvidia") continue;
      const match = remaining.findIndex(gpu => gpu.name.toLowerCase() === gpus[i].name.toLowerCase());
      if (match >= 0) gpus[i] = remaining.splice(match, 1)[0];
    }
    gpus.push(...remaining);
  }
  return {
    supported: isSupportedHardware("win32", architecture, release) &&
      (cim.productType === undefined ? cached?.supported !== false : cim.productType === 1),
    osVersion: cached?.osVersion ?? cim.version ?? release,
    model: cached?.model === "Unknown" ? cim.model ?? cached.model : cached?.model ?? cim.model,
    chip: cached?.chip ?? cim.cpu,
    gpus,
    gpuDetectionComplete: cim.gpuDetectionComplete,
  };
}
