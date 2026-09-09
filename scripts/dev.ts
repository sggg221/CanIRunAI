import { spawn, execFile } from "node:child_process";
import { createBridge } from "../apps/bridge/server.ts";
import os from "node:os";
import path from "node:path";
const dataDir =
  process.env.CANIRUN_DATA_DIR ??
  path.join(os.homedir(), "Library", "Application Support", "CanIRunAI");
const logCode = (code: string) =>
  console.log(`CanIRunAI 本机配对码：${code}（10 分钟内有效）`);
const production = process.argv.includes("--production");
let existingWeb = false;
try {
  const health = await fetch("http://localhost:3000/api/health", { signal: AbortSignal.timeout(1500) }).then(r => r.json()) as any;
  existingWeb = health.app === "CanIRunAI" && health.version === "0.2.0";
} catch {}
const bridge = await createBridge({ dataDir, onPairCode: logCode });
await new Promise<void>((resolve, reject) => {
  bridge.server.once("error", reject);
  bridge.server.listen(31415, "127.0.0.1", resolve);
});
logCode(bridge.getPairCode());
const web = existingWeb ? null : spawn(
  "npm",
  [
    "--prefix",
    "apps/web",
    "run",
    production ? "start" : "dev",
    "--",
    production ? "--ip" : "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
    ...(production ? ["--local", "--show-interactive-dev-session=false"] : []),
  ],
  { stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false", MINIFLARE_REGISTRY_PATH: path.resolve("apps/web/.wrangler/registry") } },
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  web?.kill("SIGTERM");
  bridge.server.closeAllConnections();
  bridge.server.close();
}
web?.on("error", (e) => {
  console.error(e.message);
  stop();
});
web?.on("exit", (code) => {
  stop();
  process.exitCode = code ?? 0;
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (let i = 0; i < 90 && !stopping; i++) {
  try {
    const r = await fetch("http://localhost:3000", { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const url = `http://localhost:3000/#pair=${bridge.getPairCode()}`;
      console.log("CanIRunAI is ready at http://localhost:3000");
      if (process.platform === "darwin" && process.env.CANIRUN_NO_OPEN !== "1")
        execFile("/usr/bin/open", [url]);
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
