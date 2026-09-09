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
}: {
  entry: Recommendation;
  onDetails: () => void;
  featured: boolean;
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
                ? "基于手动输入的配置估算，不代表已在你的设备上验证。"
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
          公开网站不会下载、安装或运行模型。请在 Apple Silicon Mac
          上使用本地运行包。
        </p>
      </div>
    </dialog>
  );
}

const faqs = [
  [
    "这是在线 AI 聊天网站吗？",
    "不是。这个网站帮助你选择适合 Mac 的本地模型，无需登录或安装。真实文字、图片聊天，以及模型的下载与管理，需要在你的 Mac 上启动本地运行包和 Ollama。网页本身不提供云端推理。",
  ],
  [
    "网页会自动读取我的电脑配置吗？",
    "不会。浏览器不能可靠读取 Apple 芯片型号、统一内存、当前空闲内存和磁盘空间。这里默认使用 16 GB 内存、12 GiB 可用内存和 100 GiB 剩余磁盘作为示例，请按实际情况调整。所有适配计算在浏览器内完成，不会把配置发送到服务器。",
  ],
  [
    "“适合运行”就代表一定能流畅使用吗？",
    "不代表。建议来自模型权重、KV 缓存、运行开销及系统预留内存的估算。其他应用的内存占用、上下文长度、Ollama 版本和模型更新都可能影响实际结果。网页不检测运行时版本、不预测生成速度，综合推荐排序也不是公开跑分。",
  ],
  [
    "Windows、Linux 和 Intel Mac 可以用吗？",
    "可以用浏览器访问和浏览目录，但当前兼容性算法和本地运行包仅支持 Apple Silicon Mac。其他平台会明确显示暂不支持评估，而不是给出未经验证的兼容结论。",
  ],
  [
    "模型目录是最新的吗？",
    "网站沿用仓库内置的精选模型目录，不承诺包含全部或最新模型。每个模型详情都标注了目录记录的核验日期、验证范围及官方来源；下载前请以官方模型页和本地运行包的校验结果为准。",
  ],
];

export default function App() {
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
  const entries = useMemo(() => recommendations(config, models), [config]);
  const visible = useMemo(
    () => filterModels(entries, { query, category, compatibleOnly, sort }),
    [entries, query, category, compatibleOnly, sort],
  );
  const compatible = entries.filter((e) => e.result.compatible).length;
  const selected = entries.find((e) => e.model.id === selectedId);
  const featuredId = entries.find((e) => e.result.compatible)?.model.id;
  const shareURL = configurationURL(window.location.href, config);
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
              不用研究复杂参数，也不用盲目下载。
              <br className="desktop-break" />
              选好你的配置，找到刚刚好的本地 AI。
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#models">
                发现适合我的模型 <ArrowDown size={17} />
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
          <section className="device-panel" aria-labelledby="device-title">
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
              <label className="field-label memory-label" htmlFor="memory">
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
                          Math.min(1_000_000, Number(e.target.value) || 0),
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
        </section>
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
                  {config.platform === "apple"
                    ? `${config.memoryGB} GB Mac 配置`
                    : "当前平台未评估"}
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
            <a className="button secondary" href={download}>
              <Download size={16} />
              下载本地运行包 <ArrowUpRight size={15} />
            </a>
          </div>
          <div className="guide-grid">
            <article>
              <span className="guide-step">01 / EXPLORE</span>
              <div className="guide-icon">
                <SlidersHorizontal size={24} />
              </div>
              <h3>选好你的配置</h3>
              <p>
                在上方填写 Mac
                的内存与磁盘空间，了解哪些模型适合你，无需安装任何东西。
              </p>
            </article>
            <article>
              <span className="guide-step">02 / SET UP</span>
              <div className="guide-icon">
                <Download size={24} />
              </div>
              <h3>启动本地运行包</h3>
              <p>
                在 Apple Silicon Mac 安装 Node.js 24，解压运行包，双击{" "}
                <code>Start CanIRunAI.command</code>。首次启动需要联网安装依赖。
              </p>
            </article>
            <article>
              <span className="guide-step">03 / MAKE IT YOURS</span>
              <div className="guide-icon">
                <Sparkles size={24} />
              </div>
              <h3>在自己的电脑上对话</h3>
              <p>
                按启动器提示连接本地页面，安装运行时与模型。模型下载完成后，文字与图片推理在本机完成。
              </p>
            </article>
          </div>
          <div className="local-notice">
            <LockKeyhole size={20} />
            <p>
              <strong>网站与本地运行包，各司其职。</strong>{" "}
              网页不扫描本机、不后台下载，也不提供在线聊天。运行包需要
              Node.js，尚不是独立的 macOS 安装应用。
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
      {selected && (
        <ModelDetails entry={selected} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}
