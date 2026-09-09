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
