import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { detectHardware } from "../apps/bridge/hardware.ts";
import {
  detectWindowsHardware, isSupportedHardware, parseNvidiaSMI, parseWindowsCIM,
  windowsToolPaths, WINDOWS_CIM_SCRIPT,
} from "../apps/bridge/windows-hardware.ts";
import { DeviceProfileSchema, type DeviceProfile } from "../packages/protocol/index.ts";

const cim = (gpus: unknown[] = []) => JSON.stringify({
  model: "联想 工作站", cpu: "Intel Core i7", version: "10.0.22631", productType: 1,
  gpus, gpuDetectionComplete: true,
});
const profile = (overrides: Partial<DeviceProfile> = {}): DeviceProfile => ({
  os: "win32", osVersion: "10.0.22631", architecture: "x64", supported: true,
  model: "Test PC", chip: "Intel", cpuCores: 8, gpuCores: null,
  memoryGB: 32, freeMemoryGB: 24, diskFreeGB: 100, metal: null,
  neuralEngine: null, bandwidthGBs: null, powerMode: null, ...overrides,
});

test("Windows gate uses the x64 Node architecture and Windows 10 22H2 minimum", () => {
  for (const release of ["10.0.19045", "10.0.19045.5247", "10.0.22000", "10.0.22631", "10.0.26100"])
    assert.equal(isSupportedHardware("win32", "x64", release), true, release);
  for (const release of ["6.3.9600", "10.0.18363", "10.0.19044", "19045", "10.0.22631garbage", ""])
    assert.equal(isSupportedHardware("win32", "x64", release), false, release);
  for (const architecture of ["arm64", "ia32", "arm"])
    assert.equal(isSupportedHardware("win32", architecture, "10.0.26100"), false);
  assert.equal(isSupportedHardware("win32", "x64", "10.0.26100", "ARM64"), false);
  assert.equal(isSupportedHardware("win32", "x64", "10.0.26100", "AMD64"), true);
  assert.equal(isSupportedHardware("darwin", "arm64", "24.0.0"), true);
  assert.equal(isSupportedHardware("darwin", "x64", "24.0.0"), false);
  assert.equal(isSupportedHardware("linux", "x64", "10.0.26100"), false);
});

test("Windows tool paths are absolute standard locations, not cwd or PATH", () => {
  const paths = windowsToolPaths("D:\\Windows");
  assert.equal(paths.powershell, "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(paths.nvidia.length, 2);
  for (const file of [paths.powershell, ...paths.nvidia]) assert.equal(path.win32.isAbsolute(file), true);
  for (const root of ["Windows", "\\\\host\\Windows", "C:\\Windows\\..\\Temp", "C:\\Temp", "C:\\Windows;bad"])
    assert.equal(windowsToolPaths(root).powershell, windowsToolPaths("C:\\Windows").powershell);
  assert.doesNotMatch(WINDOWS_CIM_SCRIPT, /AdapterRAM|SerialNumber|MACAddress|UserName|ExecutionPolicy|Invoke-Expression/i);
});

test("CIM parses Unicode multi-adapter identity without trusting AdapterRAM or leaking identifiers", () => {
  const result = parseWindowsCIM("\uFEFF" + cim([
    { name: "NVIDIA RTX 4090", vendor: "NVIDIA", AdapterRAM: 4293918720, SerialNumber: "secret" },
    { name: "AMD Radeon 显卡", vendor: "Advanced Micro Devices" },
    { name: "Intel UHD Graphics", vendor: "Intel Corporation" },
    { name: "未知显示设备", vendor: "Other" },
  ]));
  assert.equal(result.model, "联想 工作站");
  assert.equal(result.cpu, "Intel Core i7");
  assert.deepEqual(result.gpus.map(gpu => gpu.vendor), ["nvidia", "amd", "intel", "unknown"]);
  assert.equal(result.gpuDetectionComplete, true);
  for (const gpu of result.gpus) {
    assert.equal(gpu.memoryGB, null);
    assert.equal(gpu.freeMemoryGB, null);
    assert.equal(gpu.source, "cim");
  }
  assert.doesNotMatch(JSON.stringify(result), /secret|SerialNumber|AdapterRAM/);
});

test("CIM differentiates an empty successful enumeration from absent, failed and malformed queries", () => {
  assert.deepEqual(parseWindowsCIM(cim()).gpus, []);
  assert.equal(parseWindowsCIM(cim()).gpuDetectionComplete, true);
  for (const output of ["", "not json", "null", "[]", "{}", '{"gpus":null,"gpuDetectionComplete":true}', cim([null]), cim([{}])])
    assert.equal(parseWindowsCIM(output).gpuDetectionComplete, false, output);
  assert.equal(parseWindowsCIM('{"gpus":[],"gpuDetectionComplete":false}').gpuDetectionComplete, false);
});

test("nvidia-smi CSV supports more than 4 GB, multiple GPUs, Unicode and quoted names", () => {
  const result = parseNvidiaSMI('NVIDIA GeForce RTX 4090, 24564, 22000\r\n"NVIDIA RTX, 专业版", 49152, 32768\r\n');
  assert.equal(result?.length, 2);
  assert.equal(result?.[0].memoryGB, 24564 / 1024);
  assert.equal(result?.[0].freeMemoryGB, 22000 / 1024);
  assert.equal(result?.[1].name, "NVIDIA RTX, 专业版");
  assert.equal(result?.[1].memoryGB, 48);
  assert.equal(result?.[1].freeMemoryGB, 32);
  assert.equal(parseNvidiaSMI('"NVIDIA ""Test""", 8192, 0')?.[0].name, 'NVIDIA "Test"');
  assert.deepEqual(parseNvidiaSMI("NVIDIA GPU, [N/A], [Not Supported]")?.[0], {
    name: "NVIDIA GPU", vendor: "nvidia", memoryGB: null, freeMemoryGB: null, source: "nvidia-smi",
  });
});

test("nvidia-smi rejects errors, partial/malformed records, unsafe numbers and wrong CSV fields", () => {
  for (const output of ["", "No devices were found", "GPU, 24564", "GPU, 8192, 4096, 555.1", "GPU, -1, 0", "GPU, NaN, 0", "GPU, 8 GiB, 1", "GPU, 2, 3", "GPU, Infinity, 0", '"GPU, 10, 5', "GPU, 8192, 4096\ninvalid", "GPU, 1e309, 0"])
    assert.equal(parseNvidiaSMI(output), null, output);
});

test("Windows discovery uses a fixed read-only PowerShell invocation and exact NVIDIA CSV query", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const device = await detectWindowsHardware(async (file, args) => {
    calls.push({ file, args });
    return file.endsWith("powershell.exe") ? cim([
      { name: "Intel UHD", vendor: "Intel" }, { name: "NVIDIA RTX 4090", vendor: "NVIDIA" },
    ]) : "NVIDIA RTX 4090, 24564, 22000";
  }, "10.0.22631", "x64");
  assert.equal(device.supported, true);
  assert.equal(device.gpus.length, 2);
  assert.equal(device.gpus[1].memoryGB, 24564 / 1024);
  assert.equal(device.gpus[0].memoryGB, null);
  const ps = calls.find(call => call.file.endsWith("powershell.exe"))!;
  assert.deepEqual(ps.args, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_CIM_SCRIPT]);
  assert.deepEqual(calls.find(call => call.file.endsWith("nvidia-smi.exe"))!.args,
    ["--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"]);
});

test("Windows caches static CIM identity while refreshing every identical NVIDIA adapter", async () => {
  const previous = profile({
    gpuDetectionComplete: true,
    gpus: parseNvidiaSMI("NVIDIA RTX 4090, 24564, 22000\nNVIDIA RTX 4090, 24564, 21000")!,
  });
  let calls = 0;
  const result = await detectWindowsHardware(async file => {
    assert.ok(file.endsWith("nvidia-smi.exe")); calls++;
    return "NVIDIA RTX 4090, 24564, 16000\nNVIDIA RTX 4090, 24564, 15000";
  }, "10.0.22631", "x64", previous);
  assert.equal(calls, 1);
  assert.equal(result.model, previous.model);
  assert.equal(result.chip, previous.chip);
  assert.deepEqual(result.gpus.map(gpu => gpu.freeMemoryGB), [16000 / 1024, 15000 / 1024]);
  const stale = await detectWindowsHardware(async () => { throw new Error("ETIMEDOUT"); }, "10.0.22631", "x64", previous);
  assert.deepEqual(stale.gpus.map(gpu => gpu.freeMemoryGB), [null, null]);
});

test("missing or timed-out tools leave CPU mode supported; successful no-GPU differs from unknown", async () => {
  const failed = await detectWindowsHardware(async () => { throw new Error("ENOENT"); }, "10.0.19045", "x64");
  assert.equal(failed.supported, true);
  assert.equal(failed.gpuDetectionComplete, false);
  assert.deepEqual(failed.gpus, []);
  const empty = await detectWindowsHardware(async file => file.endsWith("powershell.exe") ? cim() : "", "10.0.19045", "x64");
  assert.equal(empty.supported, true);
  assert.equal(empty.gpuDetectionComplete, true);
  assert.deepEqual(empty.gpus, []);
  const partial = await detectWindowsHardware(async file => file.endsWith("powershell.exe") ? cim([{ name: "NVIDIA RTX", vendor: "NVIDIA" }]) : "malformed", "10.0.19045", "x64");
  assert.equal(partial.gpus[0].memoryGB, null);
  assert.equal(partial.gpus[0].freeMemoryGB, null);
  const server = await detectWindowsHardware(async file => file.endsWith("powershell.exe") ? cim().replace('"productType":1', '"productType":3') : "", "10.0.26100", "x64");
  assert.equal(server.supported, false);
});

test("hardware detection automatically collects Windows CPU/RAM/disk and refreshes free RAM", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirunai-win-hw-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.mock.method(os, "platform", () => "win32");
  t.mock.method(os, "arch", () => "x64");
  t.mock.method(os, "release", () => "10.0.22631");
  t.mock.method(os, "totalmem", () => 32 * 1024 ** 3);
  let freeGB = 24, nvidiaFree = 22000, cimCalls = 0;
  t.mock.method(os, "freemem", () => freeGB * 1024 ** 3);
  const run = async (file: string) => {
    if (file.endsWith("powershell.exe")) { cimCalls++; return cim([{ name: "NVIDIA RTX 4090", vendor: "NVIDIA" }]); }
    return `NVIDIA RTX 4090, 24564, ${nvidiaFree}`;
  };
  const initial = await detectHardware(dir, null, run);
  assert.equal(initial.supported, true);
  assert.equal(initial.model, "联想 工作站");
  assert.equal(initial.chip, "Intel Core i7");
  assert.equal(initial.memoryGB, 32);
  assert.equal(initial.freeMemoryGB, 24);
  assert.ok(initial.diskFreeGB > 0);
  assert.equal(initial.metal, null);
  assert.equal(initial.bandwidthGBs, null);
  freeGB = 10; nvidiaFree = 8000;
  const refreshed = await detectHardware(dir, { ...initial, diskFreeGB: 0 }, run);
  assert.equal(cimCalls, 1);
  assert.equal(refreshed.freeMemoryGB, 10);
  assert.ok(refreshed.diskFreeGB > 0);
  assert.equal(refreshed.gpus?.[0].freeMemoryGB, 8000 / 1024);
  DeviceProfileSchema.parse(refreshed);
});

test("Windows without PowerShell or NVIDIA tools still detects OS, CPU, RAM and disk automatically", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirunai-win-fallback-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.mock.method(os, "platform", () => "win32");
  t.mock.method(os, "arch", () => "x64");
  t.mock.method(os, "release", () => "10.0.19045");
  const result = await detectHardware(dir, null, async () => { throw new Error("ETIMEDOUT"); });
  assert.equal(result.supported, true);
  assert.equal(result.osVersion, "10.0.19045");
  assert.equal(result.chip, os.cpus()[0]?.model ?? "Unknown");
  assert.equal(result.cpuCores, os.cpus().length);
  assert.ok(result.memoryGB > 0);
  assert.ok(result.freeMemoryGB > 0);
  assert.ok(result.diskFreeGB > 0);
  assert.deepEqual(result.gpus, []);
  assert.equal(result.gpuDetectionComplete, false);
});

test("NVIDIA discovery falls back to the standard NVSMI install directory", async () => {
  const calls: string[] = [];
  const result = await detectWindowsHardware(async file => {
    calls.push(file);
    if (file.endsWith("powershell.exe")) return cim([{ name: "NVIDIA GPU", vendor: "NVIDIA" }]);
    if (file.includes("NVSMI")) return "NVIDIA GPU, 16384, 8192";
    throw new Error("ENOENT");
  }, "10.0.22631", "x64");
  assert.equal(calls.length, 3);
  assert.equal(result.gpus[0].memoryGB, 16);
  assert.equal(result.gpus[0].freeMemoryGB, 8);
});

test("Apple Silicon detection and cached Metal metadata remain intact", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "canirunai-mac-hw-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.mock.method(os, "platform", () => "darwin");
  t.mock.method(os, "arch", () => "arm64");
  let profilerCalls = 0;
  const run = async (file: string) => {
    if (file === "/usr/sbin/system_profiler") {
      profilerCalls++;
      return JSON.stringify({ SPHardwareDataType: [{ machine_model: "MacBook Pro", chip_type: "Apple M4" }], SPDisplaysDataType: [{ sppci_cores: 10, spdisplays_metal: "Metal 3" }] });
    }
    if (file === "/usr/bin/sw_vers") return "15.0";
    assert.equal(file, "/usr/bin/vm_stat");
    return "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 65536.\nPages inactive: 65536.\nPages speculative: 0.";
  };
  const initial = await detectHardware(dir, null, run);
  const refreshed = await detectHardware(dir, initial, run);
  assert.equal(profilerCalls, 1);
  assert.equal(refreshed.supported, true);
  assert.equal(refreshed.chip, "Apple M4");
  assert.equal(refreshed.metal, "Metal 3");
  assert.equal(refreshed.gpuCores, 10);
  assert.equal(refreshed.osVersion, "15.0");
  assert.equal(refreshed.freeMemoryGB, 2);
  assert.equal(refreshed.gpus, undefined);
});
