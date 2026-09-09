# CanIRunAI local helper

The public website is https://sggg221.github.io/CanIRunAI/. This helper runs the local Bridge on `127.0.0.1:31415`, not a cloud inference service or the legacy frontend. After you start and pair it, the website automatically reads your computer's configuration. You do not need to find or enter your GPU model first.

## Supported computers

- **Windows 10 22H2 (build 19045+) / Windows 11, x64**, with x64 Node.js.
- **Apple Silicon Mac**, with native arm64 Node.js, not Rosetta.
- Windows ARM, 32-bit and older Windows, Intel Mac and Linux are not deployment targets in this release. Detection must not disguise them as supported computers.

GPU detection is not a guarantee of GPU inference support. Ollama and the installed drivers choose acceleration or CPU execution. CPU execution can be slow. Windows recommendations conservatively use available **system RAM**, not RAM plus dedicated/shared VRAM. They may therefore exclude models that could fit with a particular GPU offload configuration. No unmeasured generation speed is promised.

## First launch

1. Install **Node.js 24** from https://nodejs.org if needed. Minimum version: **22.13**. Choose Windows x64 or macOS Apple Silicon for your computer. The helper never installs Node for you.
2. Download **the latest `CanIRunAI-Helper.zip`** from the website and extract it to a folder you can write to. The same ZIP contains both launchers. Keep all files together; do not launch from inside Explorer's ZIP preview.
3. On Windows, double-click **Start CanIRunAI Helper.cmd**. On Mac, double-click **Start CanIRunAI Helper.command**. First launch runs `npm ci --include=dev` to install locked dependencies from npm; internet access is required. No Ollama or model download happens merely by starting the helper. Do not run as administrator.
4. Keep the console open. The helper opens the website with a one-use pairing code in `#pair=12345678`. The fragment is not sent to GitHub Pages and the website removes it after reading. Do not share the URL, code or console screenshots. Session tokens are never put in URLs or printed.
5. Approve the browser's **local-network access** permission if requested. If the tab does not open or automatic pairing fails, open the website and enter the current eight-digit console code. Codes expire after ten minutes and rotate after successful pairing. Fresh codes print without opening another tab.
6. The page displays your actual system, CPU, RAM, storage, GPU information and model recommendations automatically. You need not fill in the manual example configuration.
7. Select a model and confirm deployment. If Ollama is absent, consent to runtime setup is separate. Model downloads, verification, startup, progress and local text/image chat use the same workbench on both platforms.

Press **Control-C** to stop the helper. No login item, scheduled task, service or background launch persistence is installed. Ollama may continue running after the helper exits; stop it separately if desired.

## Windows detection and installation

- Read-only CIM queries run through the system Windows PowerShell with no profile. They collect the system model and display adapters, not serial numbers, accounts, MAC addresses or other device identifiers.
- CPU and total/free RAM come from operating-system APIs. Free disk space is measured on the helper data volume. Resource readings refresh at most once per ten seconds during polling and before deployment; the page's **refresh detection** button also requests a fresh resource reading.
- NVIDIA adapters are queried using the driver's `nvidia-smi` for total and free dedicated VRAM. Multiple adapters remain separate. If the tool is missing, blocked or returns unusable data, VRAM is **unknown**, not zero. CIM `AdapterRAM` is not used as trusted VRAM because it can truncate capacities above 4 GiB and confuse shared memory.
- Other adapters, including AMD and Intel, can be identified by name through CIM. Their VRAM remains unknown without a reliable source. If CIM fails, the page says detection may be incomplete rather than claiming there is no GPU. Available RAM and disk detection remain usable.
- After explicit consent, setup first tries a running or installed Ollama. Otherwise it downloads a pinned official Windows portable archive, streams it to disk, validates its exact size and SHA-256, and validates/extracts it before execution. Runtime binaries live in the helper's per-user data directory. No global installer, elevated service or GPU-driver installation is performed.
- The runtime archive is large and requires extra extraction space, separate from model storage. The deployment dialog shows the platform-specific download size. A failed or timed-out runtime download may need to restart from the beginning; runtime archive downloads are not the model-download pause/resume feature.
- An existing external Ollama is not forcibly replaced. If it is too old, update/restart it yourself and retry. Ollama's own model directory or an externally configured `OLLAMA_MODELS` may be on another volume; keep enough space there too. The helper cannot inspect the private launch environment of an already-running external daemon.

## Security prompts and connection problems

**Windows:** This is a source-code helper, not a signed `.exe` installer. SmartScreen, Defender or organizational policy may require review or prevent execution. Inspect the source and follow the system/organization's normal approval process. Do not disable antivirus, bypass PowerShell execution policy, or run as administrator to make it work. If Node was just installed, close and reopen the console/launcher so PATH is refreshed.

**macOS:** An unsigned downloaded `.command` may be blocked. Inspect the source first. If you trust it, use Finder's Open context menu or the explicit Open Anyway option in System Settings → Privacy & Security when offered. Do not disable Gatekeeper or remove quarantine. If executable permissions were lost during extraction, open a terminal in the folder and run `npm ci --include=dev`, then `npm run helper`.

**Browser:** Use a current Chrome or Edge and approve local-network access. HTTPS-to-loopback support depends on browser version and policy; it is not bypassed. A blocked connection cannot detect hardware. Check site permissions or contact your administrator. The old local application at `localhost:3000` is a Mac-only alternative, **not a Windows fallback**, and is not included in this helper.

If port 31415 is occupied, use the already-running helper's code or stop it before launching the new version. An old extracted helper does not update itself when the website updates. Download and restart the latest package for Windows support.

## Privacy and pairing

- Only exact trusted origins are allowed: `https://sggg221.github.io`, `https://canirun.ai`, `http://localhost:3000`, and HTTP localhost / 127.0.0.1 on ports 5173 and 4173. GitHub Pages paths are not separate origins: all pages on `sggg221.github.io` share that trust boundary. Only pair pages you trust.
- Sessions are origin-bound, expire after fifteen minutes, and can be rotated or revoked by the website. Restarting the helper invalidates all sessions.
- Hardware and chat go between your browser and the loopback helper, not GitHub Pages or a cloud model. Chat is page-only; disconnecting, refreshing or changing the chat model clears it.
- State and signing secrets live in `%LOCALAPPDATA%\CanIRunAI` on Windows or `~/Library/Application Support/CanIRunAI` on Mac. `CANIRUN_DATA_DIR` overrides this. Tokens live only in helper memory and the authorized tab's sessionStorage.
- Set `CANIRUN_NO_OPEN=1` to suppress browser opening. In Windows CMD use `set CANIRUN_NO_OPEN=1`, then `npm run helper`. Do not share pairing codes or local state.
- Runtime/model downloads need network access. Fixed digest checks fail closed on upstream changes; they are not disabled to make deployment succeed.

## Building the download

Run `npm ci`, then `npm run helper:package`, or `npm run site:build`. Maintainers need Node and Python 3 on PATH (`python` on Windows, `python3` elsewhere); end users do not need Python. Output: `apps/site/public/downloads/CanIRunAI-Helper.zip`, copied to the site's `downloads/` folder by Vite. Keep site and helper releases matched.

The ZIP has an explicit file allowlist, fixed timestamps, sorted entries, stable stored bytes and executable permissions for the Mac launcher. It includes the Bridge, required shared code/catalog, launchers and this document. No frontend, node_modules, models, environment files, runtime state, secrets or tokens are packaged. Dependencies stay locked. Test output override: `node scripts/package-helper.mjs --output /path/to/helper.zip`.

## Validation limits

Unit tests use explicit Windows/Mac/CIM/GPU/Ollama fixtures. A Windows CI job exercises the packaged CMD launcher, real CIM/system detection, pairing and revocation on a Windows runner. It is not a consumer Windows GPU computer and does not establish SmartScreen behavior, actual driver acceleration, real model inference, or public-browser local-network permissions. Check the linked PR/Actions result for whether that job passed for a particular revision. Native Windows and Mac first-run, GPU and model tests still require real-device validation.
