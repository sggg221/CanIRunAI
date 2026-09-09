# CanIRunAI local helper

The public website is https://sggg221.github.io/CanIRunAI/. A website cannot inspect or deploy to your Mac by itself. This helper runs only the local Bridge on `127.0.0.1:31415`, not the legacy frontend. Local model deployment currently requires an **Apple Silicon Mac**.

## First launch

1. Install **Node.js 24** from https://nodejs.org if needed. Minimum version: **22.13**. Use the native Apple Silicon build, not Rosetta. The helper never installs Node for you.
2. Download `CanIRunAI-Helper.zip` from the website and extract it to a folder you can write to. Keep all extracted files together.
3. Double-click **Start CanIRunAI Helper.command**. A Terminal window opens. First launch runs `npm ci --include=dev` to install the locked dependencies from npm; internet access is required. No Ollama or model download happens at helper startup.
4. The helper opens the public website with a one-use pairing code in `#pair=12345678`. The fragment is not sent in HTTP requests to GitHub Pages. The website should remove the fragment immediately after reading it. Treat the code as private; do not share the URL or Terminal screenshots. No session token is put in a URL or printed by the helper.
5. Approve the browser's local-network permission if requested, and pair. If the tab does not open, open the website manually and enter the latest code shown in Terminal. Codes expire after 10 minutes and rotate after successful pairing. Fresh codes are printed without repeatedly opening new tabs.
6. Keep Terminal open while using the site. Press **Control-C** to stop the helper. No login item or background launch persistence is installed. Ollama, if started for a deployment, may continue running after the helper stops; quit it separately when desired.

macOS may block an unsigned downloaded `.command` file on first launch. Inspect the source first. If you trust it, use Finder's **Open** context menu or the explicit **Open Anyway** approval in **System Settings → Privacy & Security**, as offered by your macOS version. Do not disable Gatekeeper or remove quarantine attributes. If your organization's policy blocks unsigned scripts, follow that policy. If your unzip tool did not preserve executable permissions, open Terminal in the extracted folder and use `npm ci --include=dev` then `npm run helper` instead.

## Pairing and deployment

- Sessions are origin-bound, expire after 15 minutes, and can be rotated or revoked by the website. Restarting the helper invalidates all sessions.
- Only exact trusted origins are allowed: `https://sggg221.github.io`, `https://canirun.ai`, `http://localhost:3000`, and HTTP `localhost` / `127.0.0.1` on ports 5173 and 4173. GitHub Pages paths are **not** origins: other pages under the same `sggg221.github.io` origin share that browser security boundary. Only pair sites you trust.
- Browsers may restrict HTTPS-to-loopback connections or require local-network permission. Do not disable browser security. If blocked, check site permissions or use a browser that permits an explicitly approved loopback connection. A blocked browser cannot automatically detect hardware.
- After pairing, device memory/storage refresh during status polling at most once per 10 seconds; explicit detection and deployment preflight refresh immediately. Expensive macOS hardware identity profiling runs once per helper process.
- Installing the pinned, checksum-verified Ollama runtime requires your explicit confirmation in the website. Deployment can start an already installed runtime but never silently installs one. Missing or outdated runtimes return an actionable error. Updates to an existing outdated runtime must be handled explicitly before retrying.
- Models are downloaded locally. Deployment checks the pinned model manifest digest and fails closed if the upstream revision no longer matches. The helper does not loosen this check to make a download succeed.
- State and a private signing secret stay in `~/Library/Application Support/CanIRunAI`, not the extracted folder. `CANIRUN_DATA_DIR` overrides that location. Tokens live only in helper memory. `CANIRUN_NO_OPEN=1 npm run helper` disables automatic browser opening.
- If port 31415 is busy, use the pairing code in the already-running helper Terminal, or stop that helper before launching another. Do not run the old full-app launcher at the same time.

## Building the download (maintainers)

Run `npm ci`, then `npm run helper:package`, or `npm run site:build` to package before Vite builds the website. **Node and Python 3 on PATH** are required for packaging; Python is not needed by end users. CI's Ubuntu runner supplies Python 3. Packaging uses only local files and Python's standard library, without downloading anything.

Output: `apps/site/public/downloads/CanIRunAI-Helper.zip`. Vite copies this to `downloads/CanIRunAI-Helper.zip` in the built website. Resolve the download relative to the site's configured base path (`/CanIRunAI/` on GitHub Pages).

The ZIP uses an explicit file allowlist, a fixed timestamp, sorted entries, stable stored (uncompressed) bytes and Unix permissions. The launcher is stored as executable (`0755`). Repeated builds from the same inputs produce identical bytes. It includes the Bridge, required shared code/catalog, helper launcher/script and this document. Its generated package exposes only working helper scripts and retains the root locked dependencies (including the dev dependencies needed for the `tsx` loader). No legacy frontend, `node_modules`, environment files, state, secrets or session tokens are included. An output override is available for tests: `node scripts/package-helper.mjs --output /path/to/helper.zip`.

Linux tests cover mock runtime HTTP, packaging and Bridge behavior only. They do not verify macOS Gatekeeper, Launch Services, hardware profiler output, browser local-network permissions, real Metal inference or model downloads.
