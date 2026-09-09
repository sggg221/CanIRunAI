import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  Code2,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  GitFork,
  HardDrive,
  Info,
  Laptop,
  Leaf,
  LockKeyhole,
  MemoryStick,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import registry from "../../../packages/model-registry/models.json";
import type {
  Model,
  Recommendation,
} from "../../../packages/protocol/index.ts";
import {
  configurationURL,
  contextSize,
  defaults,
  description,
  fileSize,
  filterModels,
  readConfigurationURL,
  recommendations,
  selectedVariant,
  statusLabels,
  translateReason,
  type Category,
  type Sort,
} from "./catalog";
import { useBridge } from "./use-bridge";
import {
  ConnectionPanel,
  LiveDevicePanel,
  DeployDialog,
  HELPER_DOWNLOAD,
} from "./LocalConnection";
import LocalWorkbench from "./LocalWorkbench";

const models = registry as Model[];
const repository = "https://github.com/sggg221/CanIRunAI";
const download = `${repository}/raw/refs/heads/main/CanIRunAI-v0.2.0.zip`;
const categories: { value: Category; label: string; icon: typeof Sparkles }[] =
  [
    { value: "all", label: "全部模型", icon: Sparkles },
    { value: "vision", label: "图文理解", icon: Eye },
    { value: "coding", label: "编程助手", icon: Code2 },
    { value: "reasoning", label: "深度推理", icon: Cpu },
    { value: "lightweight", label: "轻量小模型", icon: Zap },
  ];
const capabilityLabels: Record<string, string> = {
  vision: "视觉",
  coding: "编程",
  reasoning: "推理",
  chat: "对话",
};
const memories = [8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512];

function Brand() {
  return (
    <a href="#" className="brand" aria-label="CanIRunAI 首页">
      <span className="brand-icon">
        <Terminal size={21} strokeWidth={2.5} />
      </span>
      <span>
        CanIRun<span className="brand-ai">AI</span>
        <span className="brand-dot">.</span>
      </span>
    </a>
  );
}

function ModelIcon({ model }: { model: Model }) {
  const color =
    model.developer.toLowerCase().includes("google") ||
    model.family.startsWith("gemma")
      ? "blue"
      : model.capabilities.includes("coding")
        ? "peach"
        : "purple";
  return (
    <span className={`model-icon ${color}`} aria-hidden="true">
      {color === "blue" ? (
        <span className="google-g">G</span>
      ) : color === "peach" ? (
        <Code2 size={24} />
      ) : (
        <Sparkles size={24} />
      )}
    </span>
  );
}

function ModelCard({
  entry,
  onDetails,
  featured,
  onDeploy,
  deployDisabled,
  connected,
}: {
  entry: Recommendation;
  onDetails: () => void;
  featured: boolean;
  onDeploy: () => void;
  deployDisabled: boolean;
  connected: boolean;
}) {
  const { model, result } = entry;
  const variant = selectedVariant(entry);
  return (
    <article className={`model-card ${featured ? "featured-card" : ""}`}>
      <div className="card-heading">
        <ModelIcon model={model} />
        <span className={`fit fit-${result.status}`}>
          {result.compatible ? <Check size={13} /> : <Info size={13} />}
          {statusLabels[result.status]}
        </span>
      </div>
      <div className="model-byline">
        {model.developer}
        {featured && (
          <span>
            <Sparkles size={11} /> 优先看看
          </span>
        )}
      </div>
      <h3>{model.name}</h3>
      <p className="model-description">{description(model)}</p>
      <div className="tags">
        <span>{variant.quantization}</span>
        {model.capabilities
          .filter((c) => c !== "chat")
          .slice(0, 3)
          .map((c) => (
            <span key={c}>{capabilityLabels[c] ?? c}</span>
          ))}
      </div>
      <div className="model-metrics">
        <div>
          <span>
            <HardDrive size={13} /> 下载大小
          </span>
          <strong>{fileSize(variant.bytes)}</strong>
        </div>
        <div>
          <span>
            <MemoryStick size={13} /> 预计占用
          </span>
          <strong>
            {result.memory.total.toFixed(1)} <small>GiB</small>
          </strong>
        </div>
        <div>
          <span>建议上下文</span>
          <strong>
            {result.compatible
              ? contextSize(result.context.recommended)
              : "不适用"}
          </strong>
        </div>
      </div>
      <button
        className="card-action"
        onClick={onDetails}
        aria-label={`查看 ${model.name} 详情`}
      >
        查看模型详情 <ArrowUpRight size={17} />
      </button>
      <button
        className="button primary model-deploy"
        disabled={deployDisabled}
        onClick={onDeploy}
        aria-label={`${connected ? "部署" : "连接助手以部署"} ${model.name}`}
      >
        <Download size={14} />
        {connected ? "一键部署" : "连接助手后部署"}
      </button>
    </article>
  );
}

function ModelDetails({
  entry,
  onClose,
}: {
  entry: Recommendation;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { model, result } = entry;
  const variant = selectedVariant(entry);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="model-dialog"
      aria-labelledby="model-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
    >
      <div className="dialog-content">
        <button
          className="icon-button close-dialog"
          onClick={() => ref.current?.close()}
          aria-label="关闭模型详情"
        >
          <X size={21} />
        </button>
        <ModelIcon model={model} />
        <p className="eyebrow">
          {model.developer} / {variant.quantization}
        </p>
        <h2 id="model-title">{model.name}</h2>
        <p className="dialog-description">{description(model)}</p>
        <div className={`detail-status fit-${result.status}`}>
          <ShieldCheck size={22} />
          <div>
            <strong>{statusLabels[result.status]}</strong>
            <p>
              {result.compatible
                ? "根据当前所选配置估算；连接助手后使用实机配置，但仍不等于该模型的推理实测。"
                : result.reasons.map(translateReason).join(" ")}
            </p>
          </div>
        </div>
        <h3>内存，算得明明白白</h3>
        <div
          className="memory-meter"
          role="img"
          aria-label={`预计占用 ${result.memory.total.toFixed(1)} GiB，安全可用 ${result.memory.safeAvailable.toFixed(1)} GiB`}
        >
          <span
            style={{
              width: `${Math.min(100, (result.memory.model / Math.max(result.memory.total, result.memory.safeAvailable, 0.1)) * 100)}%`,
            }}
          />
          <span
            style={{
              width: `${Math.min(100, (result.memory.kvCache / Math.max(result.memory.total, result.memory.safeAvailable, 0.1)) * 100)}%`,
            }}
          />
          <span
            style={{
              width: `${Math.min(100, (result.memory.runtime / Math.max(result.memory.total, result.memory.safeAvailable, 0.1)) * 100)}%`,
            }}
          />
        </div>
        <dl className="detail-grid">
          <div>
            <dt>
              <i className="legend weights" />
              模型权重
            </dt>
            <dd>{result.memory.model.toFixed(2)} GiB</dd>
          </div>
          <div>
            <dt>
              <i className="legend kv" />
              KV 缓存
            </dt>
            <dd>{result.memory.kvCache.toFixed(2)} GiB</dd>
          </div>
          <div>
            <dt>
              <i className="legend overhead" />
              运行开销
            </dt>
            <dd>{result.memory.runtime.toFixed(2)} GiB</dd>
          </div>
          <div>
            <dt>安全可用内存</dt>
            <dd>{result.memory.safeAvailable.toFixed(2)} GiB</dd>
          </div>
          <div>
            <dt>模型最大上下文</dt>
            <dd>{contextSize(model.context)} tokens</dd>
          </div>
          <div>
            <dt>建议上下文</dt>
            <dd>
              {result.compatible
                ? `${contextSize(result.context.recommended)} tokens`
                : "当前配置不适用"}
            </dd>
          </div>
          <div>
            <dt>下载大小</dt>
            <dd>{fileSize(variant.bytes)}</dd>
          </div>
          <div>
            <dt>最低 Ollama 版本</dt>
            <dd>{model.minimumRuntimeVersion ?? "目录未指定"}</dd>
          </div>
          <div>
            <dt>模型许可证</dt>
            <dd>{model.license}</dd>
          </div>
          <div>
            <dt>目录核验日期</dt>
            <dd>{model.verifiedAt.slice(0, 10)}</dd>
          </div>
        </dl>
        <p className="fine-print">
          内存按 GiB 计算；下载按十进制 GB / MB 显示。{model.memoryEstimateNote}{" "}
          内存占用按 {contextSize(result.context.recommended)} tokens
          上下文估算， 不是当前设备已成功运行的证明。
        </p>
        <div className="validation-note">
          <Info size={16} />
          <span>
            {model.validation === "inference_tested"
              ? "原项目记录了此模型的推理测试，但不代表已在你的电脑上测试。"
              : "原项目记录了元数据核验，尚无此模型的真实推理测试记录。"}{" "}
            此网页没有重新核验上游目录，不提供实测速度承诺。
          </span>
        </div>
        <div className="dialog-actions">
          <a
            className="button primary"
            href={model.officialSource}
            target="_blank"
            rel="noreferrer"
          >
            查看官方模型页 <ExternalLink size={16} />
          </a>
          <a
            className="button secondary"
            href="#guide"
            onClick={() => ref.current?.close()}
          >
            如何在本机运行 <ArrowRight size={16} />
          </a>
        </div>
        <p className="fine-print">
          模型由你授权的本机助手下载、安装和运行，网站服务器不执行推理。
        </p>
      </div>
    </dialog>
  );
}

const faqs = [
  [
    "为什么自动检测需要本地助手？",
    "浏览器不能可靠读取完整的芯片信息、当前可用内存和磁盘空间。首次启动并配对本地助手后，网页会自动使用助手检测到的真实配置。没有连接助手时，仍可展开手动评估；默认 16 GB / 12 GiB 可用内存 / 100 GiB 磁盘只是示例。",
  ],
  [
    "可以真正一键部署和聊天吗？",
    "可以通过本机助手执行。选择模型并确认下载后，助手会进行预检、下载、校验与启动，网页显示真实进度。运行环境缺失或需要更新时会另外取得安装同意；切换模型会请求停止其他模型的确认。模型就绪后可在工作台进行文字和图片流式聊天，不是预设回复。",
  ],
  [
    "我的配置和聊天会上传到哪里？",
    "授权后的硬件状态、聊天文字和图片在当前网页与 127.0.0.1 本机助手之间传输，不发送给 GitHub Pages 或云模型服务器。配对码放在链接片段中并立即从地址栏移除；会话令牌只存放在当前标签页的 sessionStorage。聊天记录仅保留在当前页面，刷新或断开连接会清空。模型和运行环境的下载需要访问官方来源。",
  ],
  [
    "“适合运行”是否保证速度和质量？",
    "不保证。适配基于权重、KV 缓存、运行开销和系统预留内存估算；连接后助手还会检查实际运行时版本及模型校验值。其他应用、上下文长度和上游变更会影响结果。综合排序不是公开质量跑分，也不提供未经测量的生成速度。",
  ],
  [
    "Windows、Linux 和 Intel Mac 可以用吗？",
    "可以浏览模型目录，助手协议也会明确返回实际平台，但当前模型部署和运行环境安装只支持 Apple Silicon Mac。其他平台不会被伪装为 Mac 或获得虚假的部署成功状态。",
  ],
  [
    "浏览器连不上本地助手怎么办？",
    "保持助手终端运行，使用本页下载的新版助手，并允许浏览器访问本地网络。建议使用最新版 Chrome 或 Edge；浏览器策略因版本和设备管理设置而异。不要关闭安全保护。也可以使用原本地应用在 localhost:3000 打开其本地网页。",
  ],
  [
    "模型目录是最新的吗？",
    "目录沿用仓库内置数据，不承诺实时更新或全量覆盖。详情标注了历史核验日期、验证范围与官方来源；运行时仍按固定摘要进行校验，不会静默接受上游变化。",
  ],
];

export default function App() {
  const bridge = useBridge();
  const [deployId, setDeployId] = useState<string | null>(null);
  function requestDeploy(entry: Recommendation) {
    if (bridge.phase !== "connected") {
      document
        .getElementById("local-assistant")
        ?.scrollIntoView({ behavior: "smooth" });
      document.getElementById("pair-code")?.focus({ preventScroll: true });
      return;
    }
    setDeployId(entry.model.id);
  }
  const [config, setConfig] = useState(() =>
    readConfigurationURL(window.location.href),
  );
  useEffect(() => {
    function restoreSharedConfiguration() {
      if (window.location.hash.startsWith("#config?")) {
        setConfig(readConfigurationURL(window.location.href));
      }
    }
    window.addEventListener("hashchange", restoreSharedConfiguration);
    return () =>
      window.removeEventListener("hashchange", restoreSharedConfiguration);
  }, []);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [compatibleOnly, setCompatibleOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("recommended");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (shareTimer.current) clearTimeout(shareTimer.current);
    },
    [],
  );
  useEffect(() => {
    setShareState("idle");
  }, [config]);
  const entries = useMemo(
    () => bridge.status?.recommendations ?? recommendations(config, models),
    [config, bridge.status],
  );
  const visible = useMemo(
    () => filterModels(entries, { query, category, compatibleOnly, sort }),
    [entries, query, category, compatibleOnly, sort],
  );
  const compatible = entries.filter((e) => e.result.compatible).length;
  const selected = entries.find((e) => e.model.id === selectedId);
  const featuredId = entries.find((e) => e.result.compatible)?.model.id;
  const deployEntry = entries.find((e) => e.model.id === deployId);
  const detected = bridge.status?.device;
  const shareURL = configurationURL(
    window.location.href,
    detected
      ? {
          platform: detected.supported ? "apple" : "unsupported",
          memoryGB: detected.memoryGB,
          freeMemoryGB: detected.freeMemoryGB,
          diskFreeGB: detected.diskFreeGB,
        }
      : config,
  );
  const memoryOptions = [...new Set([...memories, config.memoryGB])].sort(
    (a, b) => a - b,
  );
  async function share() {
    try {
      await navigator.clipboard.writeText(shareURL);
      setShareState("copied");
      if (shareTimer.current) clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setShareState("idle"), 2500);
    } catch {
      setShareState("manual");
    }
  }
  function resetFilters() {
    setQuery("");
    setCategory("all");
    setCompatibleOnly(false);
    setSort("recommended");
  }
  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav aria-label="主导航">
            <a href="#models" className="nav-active">
              探索模型
            </a>
            <a href="#guide">使用指南</a>
            <a href="#faq">常见问题</a>
          </nav>
          <a
            className="github-link"
            href={repository}
            target="_blank"
            rel="noreferrer"
          >
            <GitFork size={17} />
            <span>GitHub</span>
            <ArrowUpRight size={14} />
          </a>
        </div>
      </header>
      <main id="main">
        <section className="hero container" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="intro-pill">
              <span className="live-dot" /> 为 Apple Silicon 而生{" "}
              <span className="pill-separator">/</span> 网页版
            </span>
            <h1 id="hero-title">
              你的 Mac，
              <br />
              能跑<span className="highlight">多聪明的 AI</span>？
            </h1>
            <p className="hero-description">
              首次配对助手，自动识别你的 Mac。
              <br className="desktop-break" />
              从选模型、一键部署，到真正的本地对话。
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#local-assistant">
                连接助手，自动检测 <ArrowDown size={17} />
              </a>
              <a className="text-link" href="#guide">
                第一次玩本地 AI？
                <ArrowRight size={16} />
              </a>
            </div>
            <div className="hero-benefits">
              <span>
                <LockKeyhole size={14} /> 配置不上传
              </span>
              <span>
                <CheckCheck size={15} /> 无需登录
              </span>
              <span>
                <Leaf size={15} /> 无需安装即可探索
              </span>
            </div>
            <div className="hero-stat">
              <div>
                <strong>
                  {models.length}
                  <span> 个</span>
                </strong>
                <span>精选模型</span>
              </div>
              <i />
              <div>
                <strong>
                  {new Set(models.map((m) => m.family)).size}
                  <span> 个</span>
                </strong>
                <span>模型系列</span>
              </div>
              <i />
              <p>
                不一定要更大的模型，
                <br />
                适合你的，就是好选择。
              </p>
            </div>
          </div>
          <div className="setup-column">
            <ConnectionPanel bridge={bridge} />
            {bridge.status ? (
              <LiveDevicePanel bridge={bridge} />
            ) : (
              <details className="manual-mode">
                <summary>暂不连接助手，手动评估配置</summary>
                <section
                  className="device-panel"
                  aria-labelledby="device-title"
                >
                  <div className="device-top">
                    <span>
                      <span className="live-dot" /> 手动评估模式
                    </span>
                    <span className="mono">LOCAL FIRST</span>
                  </div>
                  <div className="device-heading">
                    <div className="chip-icon">
                      <Cpu size={31} strokeWidth={1.4} />
                    </div>
                    <div>
                      <h2 id="device-title">从你的设备开始</h2>
                      <p>示例配置，请按实际情况修改</p>
                    </div>
                    <span className="step-number">01</span>
                  </div>
                  <div className="device-fields">
                    <label className="field-label" htmlFor="platform">
                      设备平台
                    </label>
                    <div className="select-wrap">
                      <Laptop size={17} />
                      <select
                        id="platform"
                        value={config.platform}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            platform: e.target.value as typeof config.platform,
                          })
                        }
                      >
                        <option value="apple">Apple Silicon Mac</option>
                        <option value="unsupported">
                          Intel Mac / Windows / Linux
                        </option>
                      </select>
                      <ChevronDown size={15} />
                    </div>
                    <label
                      className="field-label memory-label"
                      htmlFor="memory"
                    >
                      统一内存 <span>苹果菜单 → 关于本机</span>
                    </label>
                    <div
                      className="memory-options"
                      role="group"
                      aria-label="常用内存配置"
                    >
                      {[8, 16, 24, 32].map((n) => (
                        <button
                          key={n}
                          aria-pressed={config.memoryGB === n}
                          onClick={() =>
                            setConfig({
                              ...config,
                              memoryGB: n,
                              freeMemoryGB: n * 0.75,
                            })
                          }
                        >
                          {n} <span>GB</span>
                        </button>
                      ))}
                      <select
                        id="memory"
                        aria-label="统一内存（全部配置）"
                        value={config.memoryGB}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            memoryGB: Number(e.target.value),
                            freeMemoryGB: Number(e.target.value) * 0.75,
                          })
                        }
                      >
                        {memoryOptions.map((n) => (
                          <option value={n} key={n}>
                            {n} GB
                          </option>
                        ))}
                      </select>
                    </div>
                    <details className="advanced-settings">
                      <summary>
                        <SlidersHorizontal size={13} /> 调整可用内存与磁盘{" "}
                        <ChevronDown size={13} />
                      </summary>
                      <div className="advanced-content">
                        <label htmlFor="free-memory">
                          当前可用内存{" "}
                          <strong>{config.freeMemoryGB.toFixed(1)} GiB</strong>
                        </label>
                        <input
                          id="free-memory"
                          type="range"
                          min="0"
                          max={config.memoryGB}
                          step="0.5"
                          value={config.freeMemoryGB}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              freeMemoryGB: Number(e.target.value),
                            })
                          }
                        />
                        <label htmlFor="disk">剩余磁盘空间（GiB）</label>
                        <input
                          id="disk"
                          type="number"
                          min="0"
                          max="1000000"
                          value={config.diskFreeGB}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              diskFreeGB: Math.max(
                                0,
                                Math.min(
                                  1_000_000,
                                  Number(e.target.value) || 0,
                                ),
                              ),
                            })
                          }
                        />
                        <p>
                          切换总内存时，默认按 75% 可用估算；磁盘默认 100
                          GiB。不是自动检测结果。
                        </p>
                      </div>
                    </details>
                  </div>
                  <div
                    className={`device-result ${config.platform !== "apple" ? "device-unsupported" : ""}`}
                    aria-live="polite"
                  >
                    <span className="result-icon">
                      {config.platform === "apple" ? (
                        <Check size={18} />
                      ) : (
                        <Info size={18} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {config.platform === "apple"
                          ? `${compatible} 个模型，值得在你的 Mac 上试试`
                          : "此平台暂不支持适配评估"}
                      </strong>
                      <p>
                        {config.platform === "apple"
                          ? "基于内存与磁盘估算，非本机实测"
                          : "仍可浏览模型，不能据此判断兼容性"}
                      </p>
                    </div>
                  </div>
                  <div className="device-bottom">
                    <span>
                      <ShieldCheck size={13} /> 仅在浏览器内计算
                    </span>
                    <button onClick={() => setConfig({ ...defaults })}>
                      恢复示例
                    </button>
                  </div>
                </section>
              </details>
            )}
          </div>
        </section>
        {bridge.status && (
          <LocalWorkbench bridge={bridge} onDeploy={requestDeploy} />
        )}
        <section
          className="catalog-section"
          id="models"
          aria-labelledby="models-title"
        >
          <div className="container">
            <div className="section-heading">
              <div>
                <p className="eyebrow">FIND YOUR LOCAL INTELLIGENCE</p>
                <h2 id="models-title">
                  给你的 Mac，找个好搭档<span className="title-dot">.</span>
                </h2>
                <p>从日常灵感到专注编程，总有一个模型适合你。</p>
              </div>
              <button className="share-button" onClick={share}>
                {shareState === "copied" ? (
                  <Check size={15} />
                ) : (
                  <Copy size={15} />
                )}
                {shareState === "copied" ? "配置链接已复制" : "分享当前配置"}
              </button>
            </div>
            <div className="sr-only" role="status">
              {shareState === "copied" ? "当前配置链接已复制到剪贴板" : ""}
            </div>
            {shareState === "manual" && (
              <div className="share-fallback">
                <label htmlFor="share-url">
                  浏览器未允许复制，请手动复制此配置链接：
                </label>
                <input
                  id="share-url"
                  readOnly
                  value={shareURL}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}
            <div className="filter-toolbar">
              <div className="category-tabs" role="group" aria-label="模型类别">
                {categories.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    aria-pressed={category === value}
                    className={category === value ? "active" : ""}
                    onClick={() => setCategory(value)}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="search-box">
                <Search size={17} />
                <input
                  aria-label="搜索模型"
                  placeholder="搜索模型、开发者…"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="catalog-controls">
              <p role="status">
                找到 <strong>{visible.length}</strong> 个模型{" "}
                <span className="config-caption">
                  ·{" "}
                  {detected
                    ? `${detected.memoryGB.toFixed(0)} GB · 助手实机检测`
                    : config.platform === "apple"
                      ? `${config.memoryGB} GB · 手动示例配置`
                      : "手动配置，当前平台未评估"}
                </span>
              </p>
              <div>
                <label className="compatible-toggle">
                  <input
                    type="checkbox"
                    checked={compatibleOnly}
                    onChange={(e) => setCompatibleOnly(e.target.checked)}
                  />
                  <span className="switch" />
                  只看适合我的
                </label>
                <span className="control-divider" />
                <select
                  aria-label="模型排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                >
                  <option value="recommended">综合推荐</option>
                  <option value="size">下载体积最小</option>
                  <option value="name">名称 A–Z</option>
                </select>
              </div>
            </div>
            {visible.length > 0 ? (
              <div className="model-grid">
                {visible.map((entry) => (
                  <ModelCard
                    key={entry.model.id}
                    entry={entry}
                    featured={
                      entry.model.id === featuredId && sort === "recommended"
                    }
                    onDetails={() => setSelectedId(entry.model.id)}
                    onDeploy={() => requestDeploy(entry)}
                    connected={bridge.phase === "connected"}
                    deployDisabled={
                      bridge.pending ||
                      (!!bridge.status &&
                        (!entry.result.compatible ||
                          !bridge.status.device.supported ||
                          bridge.status.busy))
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Search size={32} />
                <h3>暂时没有找到合适的模型</h3>
                <p>试试其他关键词，或调整筛选和设备配置。</p>
                <button className="button secondary" onClick={resetFilters}>
                  清除筛选条件
                </button>
              </div>
            )}
            <p className="catalog-note">
              <Info size={14} />
              精选目录来自原项目，非实时同步。适配与综合排序仅供参考，不代表实测速度或质量排名。
            </p>
          </div>
        </section>
        <section
          className="guide-section container"
          id="guide"
          aria-labelledby="guide-title"
        >
          <div className="guide-heading">
            <div>
              <p className="eyebrow">YOUR AI. YOUR MACHINE.</p>
              <h2 id="guide-title">从找到它，到用上它。</h2>
              <p>网页帮你选，本地帮你跑。让 AI 留在自己的电脑里。</p>
            </div>
            <a className="button secondary" href={HELPER_DOWNLOAD} download>
              <Download size={16} />
              下载新版助手 <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="guide-grid">
            <article>
              <span className="guide-step">01 / EXPLORE</span>
              <div className="guide-icon">
                <SlidersHorizontal size={24} />
              </div>
              <h3>首次启动助手</h3>
              <p>
                在 Apple Silicon Mac 安装 Node.js 24，下载并解压新版助手，双击{" "}
                <code>Start CanIRunAI Helper.command</code>。保持终端运行。
              </p>
            </article>
            <article>
              <span className="guide-step">02 / SET UP</span>
              <div className="guide-icon">
                <Download size={24} />
              </div>
              <h3>配对并自动检测</h3>
              <p>
                助手自动打开配对链接；按浏览器提示允许本地网络访问。未自动连接时输入
                8 位配对码，网页即显示真实设备配置。
              </p>
            </article>
            <article>
              <span className="guide-step">03 / MAKE IT YOURS</span>
              <div className="guide-icon">
                <Sparkles size={24} />
              </div>
              <h3>在自己的电脑上对话</h3>
              <p>
                选择模型并确认部署。运行环境安装和模型切换均需同意，下载进度实时显示。模型就绪后，在本页工作台开始图文对话。
              </p>
            </article>
          </div>
          <div className="local-notice">
            <LockKeyhole size={20} />
            <p>
              <strong>首次安装授权，之后由本机助手执行。</strong>{" "}
              网页不会静默安装本机软件。若浏览器不允许连接助手，也可使用{" "}
              <a href={download}>原本地应用运行包</a>{" "}
              在本地网页操作；旧包不适用于本页配对。
            </p>
            <a
              href={`${repository}/blob/main/README.md`}
              target="_blank"
              rel="noreferrer"
              aria-label="在 GitHub 查看项目说明"
            >
              <BookOpen size={18} />
              <ArrowUpRight size={14} />
            </a>
          </div>
        </section>
        <section
          className="faq-section container"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div>
            <p className="eyebrow">A LITTLE MORE CLARITY</p>
            <h2 id="faq-title">你可能还想知道</h2>
            <p>
              把边界说清楚，
              <br />
              才能放心开始。
            </p>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={17} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <Brand />
          <p>小一点的模型，也可以有大一点的可能。</p>
          <a href={repository} target="_blank" rel="noreferrer">
            在 GitHub 查看源码 <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="container footer-note">
          <span>为本地 AI 探索者而做。</span>
          <span>Apple Silicon · Ollama · 在你的电脑上</span>
        </div>
      </footer>
      {deployEntry && (
        <DeployDialog
          entry={deployEntry}
          bridge={bridge}
          onClose={() => setDeployId(null)}
        />
      )}
      {selected && (
        <ModelDetails entry={selected} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}
