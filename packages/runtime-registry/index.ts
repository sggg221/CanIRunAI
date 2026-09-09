import { RuntimeSchema } from "../protocol/index.ts";
export const runtime = RuntimeSchema.parse({
  id: "ollama",
  version: "0.33.3",
  supportedOS: ["darwin"],
  architecture: ["arm64"],
  source: "https://github.com/ollama/ollama/releases/download/v0.33.3/ollama-darwin.tgz",
  checksum: "342db03df80bb9db84ff64246031bd5f70c09b59ff52fa5cc9aaae3476cc4a9d",
  bytes: 159236337,
  format: ["GGUF"],
});
export const windowsRuntime = RuntimeSchema.parse({
  id: "ollama",
  version: "0.33.3",
  supportedOS: ["win32"],
  architecture: ["x64"],
  source: "https://github.com/ollama/ollama/releases/download/v0.33.3/ollama-windows-amd64.zip",
  checksum: "52cb36a62e7e501f61514f60212dec7117b6c098811357585e02fffe32d2fcd7",
  bytes: 1469175900,
  format: ["GGUF"],
});
export function getRuntime(platform: string, arch: string) {
  if (platform === "darwin" && arch === "arm64") return runtime;
  if (platform === "win32" && arch === "x64") return windowsRuntime;
  return null;
}

// The Windows v0.33.3 central directory totals 1,953,507,607 extracted bytes.
// Allow headroom while bounding ZIP extraction before invoking native tooling.
export function runtimeInstallBytes(platform: string, arch: string) {
  const selected = getRuntime(platform, arch);
  return selected ? selected.bytes + runtimeExtractionLimit(platform) + 512 * 1024 ** 2 : 0;
}
export function runtimeExtractionLimit(platform: string) {
  return (platform === "win32" ? 3 : 2) * 1024 ** 3;
}
