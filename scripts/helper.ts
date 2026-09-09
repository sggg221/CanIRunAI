import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createBridge } from "../apps/bridge/server.ts";

export const PUBLIC_SITE = "https://sggg221.github.io/CanIRunAI/";
export function supportedNode(version: string) {
  const [major, minor] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}
export function pairingURL(code: string) {
  if (!/^\d{8}$/.test(code)) throw new Error("Invalid pairing code");
  const url = new URL(PUBLIC_SITE);
  url.hash = `pair=${code}`;
  return url.href;
}

async function main() {
  if (!supportedNode(process.versions.node))
    throw new Error("Node.js >=22.13 is required. Install Node.js 24 from https://nodejs.org and try again.");
  const dataDir = process.env.CANIRUN_DATA_DIR ??
    path.join(os.homedir(), "Library", "Application Support", "CanIRunAI");
  const showCode = (code: string) =>
    console.log(`CanIRunAI 本机配对码：${code}（10 分钟内有效，请勿分享）`);
  const bridge = await createBridge({ dataDir, onPairCode: showCode });
  await new Promise<void>((resolve, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(bridge.port, "127.0.0.1", resolve);
  }).catch((error: NodeJS.ErrnoException) => {
    bridge.server.close();
    if (error.code === "EADDRINUSE")
      throw new Error("31415 端口已被占用。请使用现有助手终端中的配对码；若是旧版助手，请先退出旧助手再启动新版。");
    throw error;
  });
  console.log("CanIRunAI 助手仅监听本机 http://127.0.0.1:31415");
  console.log(`网页地址：${PUBLIC_SITE}`);
  console.log("请保持终端打开。按 Control-C 退出助手；已启动的 Ollama 可能继续运行。");
  showCode(bridge.getPairCode());
  const stop = () => {
    bridge.server.closeAllConnections();
    bridge.server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (process.platform === "darwin" && process.env.CANIRUN_NO_OPEN !== "1") {
    // Only the initial launch opens a tab; pairing itself rotates the next code.
    execFile("/usr/bin/open", [pairingURL(bridge.getPairCode())], (error) => {
      if (error) console.error(`Could not open the browser. Open ${PUBLIC_SITE} and enter the pairing code above.`);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Helper failed to start");
    process.exitCode = 1;
  });
}
