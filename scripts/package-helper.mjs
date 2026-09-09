import { readFile, lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output"))
  throw new Error("Usage: node scripts/package-helper.mjs [--output file.zip]");
const output = args[1] ? path.resolve(args[1]) : path.join(root, "apps/site/public/downloads/CanIRunAI-Helper.zip");
// Explicit files prevent runtime state, secrets, node_modules and frontend source entering a release.
const files = [
  "Start CanIRunAI Helper.command",
  "docs/HELPER.md",
  "scripts/helper.ts",
  "apps/bridge/server.ts",
  "apps/bridge/manager.ts",
  "apps/bridge/hardware.ts",
  "apps/bridge/runtime.ts",
  "apps/bridge/chat.ts",
  "packages/protocol/index.ts",
  "packages/model-registry/index.ts",
  "packages/model-registry/models.json",
  "packages/runtime-registry/index.ts",
  "packages/compatibility-engine/index.ts",
];
const entries = [];
for (const name of files) {
  const source = path.join(root, name);
  if (!(await lstat(source)).isFile()) throw new Error(`Not a regular file: ${name}`);
  entries.push({ name, content: await readFile(source, "utf8"), mode: name.endsWith(".command") ? 0o755 : 0o644 });
}
const sourcePackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
for (const key of ["name", "version", "dependencies", "devDependencies"]) {
  if (JSON.stringify(sourcePackage[key]) !== JSON.stringify(lock.packages[""][key]))
    throw new Error(`Root package/lock mismatch: ${key}. Update the lockfile before packaging.`);
}
const manifest = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  type: "module",
  engines: { node: ">=22.13.0" },
  scripts: {
    helper: "node --import tsx scripts/helper.ts",
    start: "npm run helper",
    bridge: "node --import tsx apps/bridge/server.ts",
  },
  dependencies: sourcePackage.dependencies,
  devDependencies: sourcePackage.devDependencies,
};
lock.packages[""].engines = manifest.engines;
for (const [name, data] of [["package.json", manifest], ["package-lock.json", lock]])
  entries.push({ name, content: JSON.stringify(data, null, 2) + "\n", mode: 0o644 });
await mkdir(path.dirname(output), { recursive: true });
const result = spawnSync("python3", ["-c", `
import json, os, stat, sys, zipfile
entries = json.load(sys.stdin)
output = sys.argv[1]
with zipfile.ZipFile(output + ".tmp", "w", compression=zipfile.ZIP_STORED) as archive:
    for entry in sorted(entries, key=lambda item: item["name"]):
        info = zipfile.ZipInfo("CanIRunAI-Helper/" + entry["name"], (1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | entry["mode"]) << 16
        archive.writestr(info, entry["content"].encode("utf-8"))
os.replace(output + ".tmp", output)
`, output], { input: JSON.stringify(entries), encoding: "utf8" });
if (result.error) throw new Error(`Helper packaging requires Python 3 on PATH: ${result.error.message}`);
if (result.status !== 0) throw new Error(`Helper packaging failed: ${result.stderr}`);
console.log(`Packaged helper: ${output}`);
