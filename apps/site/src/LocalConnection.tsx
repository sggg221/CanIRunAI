import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Cpu,
  Download,
  Info,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import type { Recommendation } from "../../../packages/protocol/index.ts";
import { runtimeCompatible } from "../../../packages/compatibility-engine/index.ts";
import { runtime } from "../../../packages/runtime-registry/index.ts";
import { fileSize, selectedVariant } from "./catalog";
import type { LocalBridge } from "./use-bridge";

export const HELPER_DOWNLOAD = `${import.meta.env.BASE_URL}downloads/CanIRunAI-Helper.zip`;
export function ConnectionPanel({ bridge }: { bridge: LocalBridge }) {
  const [code, setCode] = useState("");
  const connecting = bridge.phase === "connecting";
  async function pair(event: FormEvent) {
    event.preventDefault();
    await bridge.connect(code);
    setCode("");
  }
  return (
    <section
      className="connection-panel"
      id="local-assistant"
      aria-labelledby="connection-title"
    >
      <div className="connection-heading">
        <span className="chip-icon">
          <Link2 size={25} />
        </span>
        <div>
          <p className="eyebrow">WEBSITE + LOCAL HELPER</p>
          <h2 id="connection-title">让网页，连接你的 Mac</h2>
        </div>
      </div>
      {bridge.phase === "connected" ? (
        <>
          <div className="connection-success">
            <Check size={17} />
            <span>已配对 · 自动读取本机配置</span>
          </div>
          <p>
            助手只监听本机。网页通过授权连接检测硬件、部署模型并进行本地聊天。
          </p>
          <div className="connection-actions">
            <button
              className="button secondary"
              onClick={() =>
                void bridge
                  .action({ action: "detect_hardware" })
                  .catch(() => {})
              }
              disabled={bridge.pending}
            >
              <RefreshCw size={15} />
              刷新检测
            </button>
            <button
              className="text-link disconnect-button"
              onClick={() => void bridge.disconnect()}
            >
              <Unplug size={14} />
              断开授权
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            首次下载并启动本地助手，完成配对后，自动检测设备并一键部署模型。不用再手填参数。
          </p>
          <a
            className="button primary helper-download"
            href={HELPER_DOWNLOAD}
            download
          >
            <Download size={16} />
            下载 Mac 本地助手 <ArrowRight size={15} />
          </a>
          <p className="helper-requirements">
            Apple Silicon Mac · 建议 Node.js 24 · 非独立签名 App
          </p>
          <ol className="connection-steps">
            <li>
              解压后双击 <code>Start CanIRunAI Helper.command</code>。
            </li>
            <li>保持助手终端打开，按浏览器提示允许访问本地网络。</li>
            <li>助手会打开配对网页；未自动连接时输入终端中的 8 位配对码。</li>
          </ol>
          <form className="pair-form" onSubmit={pair}>
            <label htmlFor="pair-code">本机配对码</label>
            <div>
              <input
                id="pair-code"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                pattern="[0-9]{8}"
                placeholder="8 位数字"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                disabled={connecting}
                required
              />
              <button
                className="button primary"
                type="submit"
                disabled={connecting || code.length !== 8}
              >
                {connecting ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Link2 size={15} />
                )}
                配对并检测
              </button>
            </div>
          </form>
          <button
            className="probe-button"
            onClick={() => void bridge.connect()}
            disabled={connecting}
          >
            {connecting ? "正在连接助手…" : "助手已启动？检查连接"}
          </button>
          {bridge.phase === "pair-required" && (
            <p className="connection-hint" role="status">
              请输入当前助手显示的配对码。授权过期后需重新配对。
            </p>
          )}
        </>
      )}
      {bridge.error && (
        <p className="local-error" role="alert">
          <Info size={16} />
          <span>{bridge.error}</span>
        </p>
      )}
      <details className="connection-help">
        <summary>连接不上？查看排查方法</summary>
        <p>
          请使用此处的新版助手，旧 v0.2.0 ZIP 不支持此 GitHub
          网页的连接。建议使用最新版 Chrome 或
          Edge，并允许“本地网络访问”。如果浏览器或管理策略仍拦截本机请求，可使用下方指南中的原本地应用运行包，在它的
          localhost:3000 页面操作。不要关闭浏览器安全保护。
        </p>
        <p>
          启动器若被 macOS
          拦截，请先核对下载来源，再按系统提示允许打开；网页不会自动绕过系统确认。
        </p>
      </details>
    </section>
  );
}

export function LiveDevicePanel({ bridge }: { bridge: LocalBridge }) {
  const status = bridge.status;
  if (!status) return null;
  const { device } = status;
  return (
    <section className="live-device" aria-labelledby="live-device-title">
      <div className="live-device-heading">
        <Cpu size={21} />
        <h2 id="live-device-title">这台设备的真实配置</h2>
        <span>助手检测</span>
      </div>
      <dl>
        <div>
          <dt>设备 / 芯片</dt>
          <dd>
            {device.model} · {device.chip}
          </dd>
        </div>
        <div>
          <dt>系统</dt>
          <dd>
            {device.os} {device.osVersion} · {device.architecture}
          </dd>
        </div>
        <div>
          <dt>总内存 / 可用</dt>
          <dd>
            {device.memoryGB.toFixed(1)} / {device.freeMemoryGB.toFixed(1)} GiB
          </dd>
        </div>
        <div>
          <dt>剩余磁盘</dt>
          <dd>{device.diskFreeGB.toFixed(1)} GiB</dd>
        </div>
        <div>
          <dt>CPU / GPU 核心</dt>
          <dd>
            {device.cpuCores} / {device.gpuCores ?? "未知"}
          </dd>
        </div>
        <div>
          <dt>Ollama</dt>
          <dd>
            {status.runtime.available
              ? status.runtime.version
              : "未运行或未安装"}
          </dd>
        </div>
      </dl>
      <p className={device.supported ? "connection-hint" : "local-error"}>
        <ShieldCheck size={15} />
        {device.supported
          ? "已按实际配置重新评估。适配仍是估算，不代表所有模型都已实测。"
          : "已检测到设备，但本版只支持在 Apple Silicon Mac 部署。没有将当前平台伪装为 Mac。"}
      </p>
    </section>
  );
}

export function DeployDialog({
  entry,
  bridge,
  onClose,
}: {
  entry: Recommendation;
  bridge: LocalBridge;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [installConsent, setInstallConsent] = useState(false),
    [switchConsent, setSwitchConsent] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const status = bridge.status;
  const needsRuntime = !!status && !status.runtime.available;
  const outdated =
    !!status?.runtime.available &&
    !runtimeCompatible(
      status.runtime.version,
      entry.model.minimumRuntimeVersion,
    );
  const canInstall = runtimeCompatible(
    runtime.version,
    entry.model.minimumRuntimeVersion,
  );
  const others =
    status?.running.filter((m) => m.modelId !== entry.model.id) ?? [];
  const unknownRunning = others.some((m) => !m.modelId);
  const blocked =
    !status ||
    !status.device.supported ||
    !entry.result.compatible ||
    status.busy ||
    bridge.pending ||
    !!stage ||
    unknownRunning ||
    outdated ||
    (needsRuntime && (!installConsent || !canInstall)) ||
    (others.length > 0 && !switchConsent);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function deploy() {
    if (blocked) return;
    setError("");
    try {
      if (needsRuntime) {
        setStage("正在启动已有环境，或安装并验证 Ollama，请保持助手运行…");
        const result = (await bridge.action({
          action: "install_runtime",
          confirmed: true,
        })) as { version?: string };
        if (
          !runtimeCompatible(result.version, entry.model.minimumRuntimeVersion)
        )
          throw new Error(
            `已启动的 Ollama 不满足最低版本 ${entry.model.minimumRuntimeVersion}，请在本机更新后重新连接。网页不会强制终止外部 Ollama 服务。`,
          );
      }
      setStage("正在检查设备并创建部署任务…");
      await bridge.action({
        action: "deploy",
        model_id: entry.model.id,
        context_length: entry.result.context.recommended,
        switch_confirmed: switchConsent,
      });
      ref.current?.close();
      document
        .getElementById("local-workbench")
        ?.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法开始部署");
    } finally {
      setStage("");
    }
  }
  return (
    <dialog
      ref={ref}
      className="model-dialog"
      aria-labelledby="deploy-title"
      onClose={onClose}
    >
      <div className="dialog-content">
        <button
          className="icon-button close-dialog"
          onClick={() => ref.current?.close()}
          aria-label="关闭部署确认"
        >
          <X size={20} />
        </button>
        <p className="eyebrow">DEPLOY ON YOUR MAC</p>
        <h2 id="deploy-title">部署 {entry.model.name}</h2>
        <p className="dialog-description">
          下载与推理都在你的电脑上执行。部署前会再次检查内存、磁盘、运行环境与固定模型校验值。
        </p>
        <dl className="detail-grid deploy-summary">
          <div>
            <dt>模型下载</dt>
            <dd>{fileSize(selectedVariant(entry).bytes)}</dd>
          </div>
          <div>
            <dt>预计占用</dt>
            <dd>{entry.result.memory.total.toFixed(1)} GiB</dd>
          </div>
          <div>
            <dt>上下文</dt>
            <dd>{entry.result.context.recommended} tokens</dd>
          </div>
          <div>
            <dt>当前运行环境</dt>
            <dd>{status?.runtime.version ?? "未运行"}</dd>
          </div>
        </dl>
        {needsRuntime && (
          <label className="consent">
            <input
              type="checkbox"
              checked={installConsent}
              onChange={(e) => setInstallConsent(e.target.checked)}
              disabled={!!stage}
            />
            <span>
              同意在需要时下载并安装已固定校验值的 Ollama {runtime.version}（
              {fileSize(runtime.bytes)}
              ），然后继续部署。已有运行环境不会未经确认被更新。
            </span>
          </label>
        )}
        {outdated && (
          <p className="local-error">
            当前运行中的 Ollama {status?.runtime.version} 低于模型要求的{" "}
            {entry.model.minimumRuntimeVersion}。请在本机更新并重启 Ollama
            后重新连接；网页不会强制替换正在运行的外部服务。
          </p>
        )}
        {needsRuntime && !canInstall && (
          <p className="local-error">
            内置安装包不满足此模型的最低运行时要求，请先手动更新 Ollama。
          </p>
        )}
        {others.length > 0 && (
          <label className="consent">
            <input
              type="checkbox"
              checked={switchConsent}
              onChange={(e) => setSwitchConsent(e.target.checked)}
              disabled={!!stage || unknownRunning}
            />
            <span>
              同意停止当前模型（{others.map((m) => m.tag).join("、")}
              ），释放内存后切换到此模型。
            </span>
          </label>
        )}
        {unknownRunning && (
          <p className="local-error">
            有不属于本项目管理的模型正在运行，请先在 Ollama 中停止它。
          </p>
        )}
        {!status?.device.supported && (
          <p className="local-error">
            请连接 Apple Silicon Mac 上的助手后部署。
          </p>
        )}
        {status && !entry.result.compatible && (
          <p className="local-error">
            当前设备不满足此模型的内存或磁盘要求，请先释放资源。
          </p>
        )}
        {(stage || bridge.pending) && (
          <p className="operation-progress" role="status">
            <LoaderCircle size={17} className="spin" />
            {stage || "正在执行本机操作…"}
          </p>
        )}
        {error && (
          <p className="local-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary deploy-confirm"
          disabled={blocked}
          onClick={() => void deploy()}
        >
          确认并一键部署 <ArrowRight size={16} />
        </button>
        <p className="fine-print">
          下载耗时取决于网络。关闭对话框不会取消已提交的本机任务；可在工作台查看进度。
        </p>
      </div>
    </dialog>
  );
}
