'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Cpu,
  ArrowUpRight,
  ShieldCheck,
  Sparkles,
  Box,
  MessageSquare,
  Settings2,
  Laptop,
  ArrowRight,
  Check,
  ChevronRight,
  Download,
  HardDrive,
  MemoryStick,
  Zap,
  RefreshCw,
  ArrowUp,
  Square,
  Pause,
  Play,
  X,
  Code2,
  Trash2,
  LoaderCircle,
  Lock,
  Activity,
  Unplug,
  ImagePlus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import type {
  DeviceProfile,
  Deployment,
  Model,
  Recommendation,
} from '../../../packages/protocol/index';
import {
  prepareImage,
  toWireMessages,
  MAX_CHAT_IMAGES,
  type ChatImage,
  type ChatMessage,
} from '@/lib/chat-images';
import { loadChat, saveChat, clearChat } from '@/lib/chat-storage';
import catalogInfo from '../../../packages/model-registry/catalog-info.json';
import { runtimeCompatible } from '../../../packages/compatibility-engine/index';
import { runtime as runtimeRelease } from '../../../packages/runtime-registry/index';
import registry from '../../../packages/model-registry/models.json';
const BRIDGE = 'http://127.0.0.1:31415';
const models = registry as Model[];
type Status = {
  device: DeviceProfile;
  runtime: { available: boolean; version: string | null };
  installed: { modelId: string; bytes: number }[];
  running: {
    modelId: string;
    tag: string;
    context: number;
    memoryGB: number;
  }[];
  recommendations: Recommendation[];
  deployments: Deployment[];
  benchmarks: { modelId: string; tokensPerSecond: number }[];
  busy: boolean;
};
type Message = ChatMessage;
type Modal =
  | 'pair'
  | 'details'
  | 'deploy'
  | 'remove'
  | 'runtime'
  | 'switch'
  | 'api'
  | null;
const labels = {
  perfect: '非常适合',
  great: '运行流畅',
  well: '运行良好',
  limited: '运行有一定限制',
  unsupported: '不建议运行',
};
const stageLabels: Record<string, string> = {
  preparing: '准备中',
  checking: '正在检测本机',
  installing_runtime: '正在安装运行环境',
  downloading: '正在下载模型',
  verifying: '正在校验下载',
  configuring: '正在配置',
  starting: '正在启动 AI',
  health_check: '正在验证',
  running: '可以开始聊天了',
  paused: '下载已暂停',
  failed: '需要处理一下',
  cancelled: '部署已取消',
  stopped: '模型已停止',
};
const gb = (n: number) => `${n.toFixed(1)} GB`;
const bytes = (n: number) =>
  n < 1e9 ? `${Math.round(n / 1e6)} MB` : `${(n / 1e9).toFixed(1)} GB`;
function ModelIcon({ model }: { model: Model }) {
  return (
    <span
      className={`model-icon ${model.family.startsWith('gemma') ? 'blue' : model.category === 'Coding' ? 'ink' : ''}`}
    >
      {model.family.startsWith('gemma') ? (
        'g'
      ) : model.category === 'Coding' ? (
        <Code2 size={24} />
      ) : (
        <Sparkles size={25} strokeWidth={1.4} />
      )}
    </span>
  );
}

const categoryLabels: Record<string, string> = {
  Discover: '发现',
  'My AI': '我的 AI',
  Chat: '聊天',
  Settings: '设置',
  'Top picks': '精选推荐',
  'All models': '全部模型',
  Coding: '编程',
  Reasoning: '推理',
  Vision: '视觉',
  Fastest: '极速',
  Everyday: '日常助手',
  'Best overall': '综合首选',
};
const categoryLabel = (label: string) => categoryLabels[label] ?? label;
const descriptions: Record<string, string> = {
  'qwen3-0.6b': '轻巧又迅速，随时回答你的日常问题。',
  'qwen3-1.7b': '小巧的体积，多一点思考的能力。',
  'qwen3-4b': '陪你写作、探索，把复杂的想法理清楚。',
  'qwen3-8b': '深入理解复杂问题，让推理更进一步。',
  'qwen2.5-coder-7b': '从第一个想法，到真正能运行的代码。',
  'gemma3-4b': '用新的视角，理解文字与图像。',
};
const modelDescription = (model: Model) =>
  descriptions[model.id] ?? model.description;
const errorMessages: Record<string, string> = {
  'Invalid or expired pairing code':
    '配对码无效或已过期，请使用最新的本机配对码。',
  'Pair with this Bridge to continue': '请先与本机 Bridge 配对。',
  'Too many pairing attempts. Try again in a minute.':
    '配对尝试过于频繁，请稍等一分钟再试。',
  'Please wait before pairing again': '请稍等片刻再尝试配对。',
  'Too many requests': '请求过于频繁，请稍后再试。',
  'This release supports Apple Silicon macOS only.':
    '当前版本仅支持 Apple Silicon macOS。',
  'This version requires Apple Silicon macOS.':
    '当前版本需要 Apple Silicon macOS。',
  'Not enough free storage.': '可用存储空间不足。',
  'Not enough safe memory for practical conversation.':
    '可安全使用的内存不足以支持正常对话。',
  'This context would use too much memory. Choose a smaller context.':
    '当前上下文会占用过多内存，请选择更小的上下文。',
  'Install the verified Ollama runtime to continue.':
    '请先安装已核验的 Ollama 运行环境。',
  'The downloaded model does not match the pinned registry revision.':
    '下载的模型与已核验版本不一致，已停止启动。',
  'Could not reach the model download service.':
    '无法连接模型下载服务，请检查网络后重试。',
  'The model did not pass its health check.':
    '模型未通过运行检查，请尝试重新启动。',
  'Another operation is in progress.': '另一个操作正在进行，请稍后再试。',
  'Another model operation is in progress.':
    '另一个模型操作正在进行，请稍后再试。',
  'Wait for the current operation to finish.': '请等待当前操作完成。',
  'Another operation is still finishing.': '上一个操作正在结束，请稍等片刻。',
  'Wait for deployment to finish.': '请等待部署完成。',
  'Wait for the current operation.': '请等待当前操作完成。',
  'Finish or stop the current response first.':
    '请等待当前回答完成，或先停止生成。',
  'Start this model before benchmarking.': '请先启动此模型，再测试性能。',
  'Start this model before chatting': '请先启动此模型，再开始聊天。',
  'Deploy the verified model first': '请先部署已核验的模型。',
  'This operation cannot be paused right now.': '此操作当前无法暂停。',
  'Could not remove model': '模型移除失败。',
  'Failed to fetch': '连接失败，请检查 Bridge 和本机网络。',
  'Load failed': '连接失败，请检查 Bridge 是否正在运行。',
  'fetch failed': '连接失败，请稍后重试。',
};
function localizeError(message: string) {
  if (errorMessages[message]) return errorMessages[message];
  if (message.startsWith('Switch models to stop '))
    return '请确认切换模型，停止当前 AI 后再启动新的 AI。';
  if (message.startsWith('Stop ') && message.includes('in Ollama first'))
    return '请先在 Ollama 中停止其他模型。CanIRunAI 仅管理已登记的模型。';
  return message;
}

export default function Home() {
  const [view, setView] = useState('Discover'),
    [filter, setFilter] = useState('Top picks'),
    [catalogQuery, setCatalogQuery] = useState(''),
    [status, setStatus] = useState<Status | null>(null),
    [phase, setPhase] = useState('正在检测本机…'),
    [quick, setQuick] = useState({ os: '这台电脑', cores: 0, gpu: '未知' }),
    [modal, setModal] = useState<Modal>(null),
    [selected, setSelected] = useState<Model>(models[0]),
    [activeId, setActiveId] = useState<string | null>(null),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [input, setInput] = useState(''),
    [messages, setMessages] = useState<Message[]>([]),
    [attachments, setAttachments] = useState<ChatImage[]>([]),
    [preparingImages, setPreparingImages] = useState(false),
    [draggingImages, setDraggingImages] = useState(false),
    [loadedChat, setLoadedChat] = useState<string | null>(null),
    [chatModel, setChatModel] = useState(models[0].id),
    [streaming, setStreaming] = useState(false),
    [saveHistory, setSaveHistory] = useState(true),
    [context, setContext] = useState(8192);
  const fileInput = useRef<HTMLInputElement>(null),
    imageLock = useRef(false),
    dragDepth = useRef(0),
    session = useRef(''),
    streamAbort = useRef<AbortController | null>(null),
    chatEnd = useRef<HTMLDivElement>(null),
    initial = useRef(false);
  const connected = phase === 'Bridge 已连接' || phase === 'Bridge connected';
  const active = status?.deployments.find((d) => d.id === activeId);
  const recommendation = status?.recommendations.find(
    (r) => r.model.id === selected.id,
  );
  const running = status?.running.find((r) => r.modelId === chatModel);
  const supportsVision =
    models.find((m) => m.id === chatModel)?.capabilities.includes('vision') ??
    false;
  const selectedInstalled = status?.installed.some(
    (m) => m.modelId === selected.id,
  );
  async function api(path: string, body?: unknown, auth = true) {
    const r = await fetch(BRIDGE + path, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth ? { Authorization: `Bearer ${session.current}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path === '/action' ? 660000 : 12000),
    });
    const data: any = await r.json();
    if (!r.ok) {
      if (r.status === 401 && auth) {
        session.current = '';
        sessionStorage.removeItem('canirun-session');
        setPhase('等待配对');
      }
      throw new Error(
        data.error?.message ?? '无法连接 Bridge，请检查本地服务是否已启动。',
      );
    }
    return data;
  }
  async function refresh() {
    const data = await api('/status');
    setStatus(data);
    setPhase('Bridge 已连接');
    return data as Status;
  }
  async function connect(pairCode = code) {
    setBusy(true);
    setError('');
    try {
      const { challenge } = await api('/challenge', {}, false);
      const data = await api('/pair', { challenge, code: pairCode }, false);
      session.current = data.token;
      sessionStorage.setItem('canirun-session', data.token);
      await refresh();
      setModal(null);
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function probe() {
    setPhase('正在连接 Bridge…');
    try {
      const health = await api('/health', undefined, false);
      if (health.protocol !== 1) {
        setPhase('Bridge 需要更新');
        return;
      }
      if (session.current) {
        await refresh();
      } else setPhase('等待配对');
    } catch {
      setPhase('Bridge 未连接');
    }
  }
  useEffect(() => {
    if (initial.current) return;
    initial.current = true;
    const ua = navigator.userAgent;
    setQuick({
      os: /Mac/.test(ua) ? 'Mac' : /Win/.test(ua) ? 'Windows 电脑' : '这台电脑',
      cores: navigator.hardwareConcurrency || 0,
      gpu: '未知',
    });
    const gpu = (navigator as any).gpu;
    if (gpu)
      gpu
        .requestAdapter()
        .then((a: any) => {
          if (a)
            setQuick((q) => ({
              ...q,
              gpu: a.info?.description || a.info?.vendor || '支持 WebGPU',
            }));
        })
        .catch(() => {});
    session.current = sessionStorage.getItem('canirun-session') ?? '';
    setSaveHistory(localStorage.getItem('canirun-save-history') !== 'false');
    const hash = new URLSearchParams(location.hash.slice(1)),
      pair = hash.get('pair');
    if (pair) {
      history.replaceState(null, '', location.pathname);
      void connect(pair);
    } else void probe();
  }, []);
  useEffect(() => {
    const onPairLink = () => {
      const next = new URLSearchParams(location.hash.slice(1)).get('pair');
      if (next) {
        history.replaceState(null, '', location.pathname);
        void connect(next);
      }
    };
    window.addEventListener('hashchange', onPairLink);
    return () => window.removeEventListener('hashchange', onPairLink);
  }, []);
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(() => {
      void refresh().catch(() => setPhase('Bridge 未连接'));
    }, 3000);
    const rotation = setInterval(() => {
      void api('/session/rotate', {})
        .then((data) => {
          session.current = data.token;
          sessionStorage.setItem('canirun-session', data.token);
        })
        .catch(() => setPhase('等待配对'));
    }, 600000);
    return () => {
      clearInterval(t);
      clearInterval(rotation);
    };
  }, [connected]);
  useEffect(() => {
    let disposed = false;
    setLoadedChat(null);
    setMessages([]);
    setAttachments([]);
    void loadChat(chatModel)
      .then((history) => {
        if (!disposed) {
          setMessages(history);
          setLoadedChat(chatModel);
        }
      })
      .catch(() => {
        if (!disposed) {
          setLoadedChat(chatModel);
          setError('无法读取本地对话记录，本次对话仍可继续。');
        }
      });
    return () => {
      disposed = true;
    };
  }, [chatModel]);
  useEffect(() => {
    if (!saveHistory || !messages.length || loadedChat !== chatModel) return;
    const timer = setTimeout(() => {
      void saveChat(chatModel, messages).catch(() =>
        setError(
          '本地存储空间不足或不可用。本次对话仍可继续，但最新内容可能无法保存。',
        ),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [messages, saveHistory, chatModel, loadedChat]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 5000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  async function action(body: unknown) {
    setBusy(true);
    setError('');
    try {
      const out = await api('/action', body);
      await refresh();
      return out.result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  function openDetails(model: Model) {
    setSelected(model);
    setContext(
      status?.recommendations.find((r) => r.model.id === model.id)?.result
        .context.recommended ?? 8192,
    );
    setModal('details');
  }
  async function deploy(
    model: Model,
    confirmed = false,
    customContext?: number,
  ) {
    setSelected(model);
    if (!connected) {
      setModal('pair');
      return;
    }
    if (!status?.runtime.available || !runtimeCompatible(status.runtime.version, model.minimumRuntimeVersion)) {
      setModal('runtime');
      return;
    }
    if (status.running.some((m) => m.modelId !== model.id) && !confirmed) {
      setModal('switch');
      return;
    }
    const result = await action({
      action: 'deploy',
      model_id: model.id,
      switch_confirmed: confirmed,
      ...(customContext ? { context_length: customContext } : {}),
    });
    if (result) {
      setActiveId(result.id);
      setModal('deploy');
    }
  }
  function openChat(model: Model) {
    if (streaming || preparingImages) return;
    setChatModel(model.id);
    setView('Chat');
    setModal(null);
  }
  async function addImages(files: File[]) {
    if (!files.length) return;
    if (!supportsVision) {
      setError('当前模型只支持文字。请先切换到 Gemma 3 等视觉模型。');
      return;
    }
    if (!running || !connected) {
      setError('请先启动并连接视觉模型，再添加图片。');
      return;
    }
    if (streaming || imageLock.current) return;
    const room = MAX_CHAT_IMAGES - attachments.length;
    if (files.length > room) {
      setError('每次最多发送 4 张图片，请先移除多余图片。');
      return;
    }
    imageLock.current = true;
    setPreparingImages(true);
    setError('');
    try {
      const prepared: ChatImage[] = [];
      for (const file of files) prepared.push(await prepareImage(file));
      setAttachments((current) =>
        [...current, ...prepared].slice(0, MAX_CHAT_IMAGES),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      imageLock.current = false;
      setPreparingImages(false);
    }
  }
  async function send(e?: FormEvent, text = input) {
    e?.preventDefault();
    if (
      (!text.trim() && !attachments.length) ||
      streaming ||
      preparingImages ||
      loadedChat !== chatModel
    )
      return;
    if (!connected) {
      setModal('pair');
      return;
    }
    if (!running) {
      setError('请先在「我的 AI」中启动模型，再发送消息。');
      return;
    }
    const user: Message = {
        role: 'user',
        content: text.trim() || '请描述这些图片。',
        ...(attachments.length ? { images: attachments } : {}),
      },
      conversation = [...messages, user];
    setMessages([...conversation, { role: 'assistant', content: '' }]);
    setInput('');
    setAttachments([]);
    setStreaming(true);
    setError('');
    const controller = new AbortController();
    streamAbort.current = controller;
    let answer = '';
    try {
      const r = await fetch(BRIDGE + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.current}`,
        },
        body: JSON.stringify({
          model: chatModel,
          messages: toWireMessages(conversation),
          stream: true,
        }),
        signal: controller.signal,
      });
      if (!r.ok) {
        const data: any = await r.json();
        throw new Error(data.error?.message ?? '消息发送失败');
      }
      const reader = r.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 2);
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6);
          if (json === '[DONE]') continue;
          const chunk = JSON.parse(json);
          if (chunk.error) throw new Error(chunk.error.message);
          answer += chunk.choices?.[0]?.delta?.content ?? '';
          setMessages([
            ...conversation,
            { role: 'assistant', content: answer },
          ]);
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
      if (!answer) setMessages(conversation);
    } finally {
      setStreaming(false);
      streamAbort.current = null;
    }
  }
  async function disconnect() {
    try {
      await api('/session/revoke', {});
    } catch {}
    session.current = '';
    sessionStorage.removeItem('canirun-session');
    setStatus(null);
    setPhase('等待配对');
    setNotice('已断开 Bridge 连接。');
  }
  const picks =
    status?.recommendations ?? models.map((model) => ({ model, result: null }));
  const matching = picks.filter(r => {
    const query = catalogQuery.trim().toLocaleLowerCase();
    const matchesQuery = !query || `${r.model.name} ${r.model.developer} ${r.model.family} ${modelDescription(r.model)}`.toLocaleLowerCase().includes(query);
    if (!matchesQuery) return false;
    if (filter === 'All models') return true;
    if (filter === 'Top picks') return !r.result || (r.result.compatible && r.result.status !== 'limited');
    if (filter === 'Vision') return r.model.capabilities.includes('vision');
    if (filter === 'Coding') return r.model.capabilities.includes('coding') || r.model.category === 'Coding';
    if (filter === 'Reasoning') return r.model.capabilities.includes('reasoning');
    return r.model.category === filter;
  });
  const visible = filter === 'Top picks' && !catalogQuery.trim() ? matching.slice(0,8) : matching;
  const pending = status?.deployments.find(
    (d) => !['running', 'stopped', 'cancelled'].includes(d.stage),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Cpu size={22} />
          </span>
          CanIRunAI<span className="beta">测试版</span>
        </a>
        <div className="workspace-label">你的本地 AI 空间</div>
        <nav aria-label="主导航">
          {[
            ['Discover', Sparkles],
            ['My AI', Box],
            ['Chat', MessageSquare],
          ].map(([name, Icon]) => {
            const I = Icon as typeof Sparkles;
            return (
              <button
                key={categoryLabel(name as string)}
                className={`nav-item ${view === name ? 'active' : ''}`}
                onClick={() => setView(name as string)}
              >
                <I size={18} />
                {categoryLabel(name as string)}
                {name === 'My AI' && !!status?.installed.length && (
                  <span className="nav-count">{status.installed.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <div>
              你的电脑，你的 AI。<small>隐私，始终优先。</small>
            </div>
          </div>
          <button
            className={`nav-item ${view === 'Settings' ? 'active' : ''}`}
            onClick={() => setView('Settings')}
          >
            <Settings2 size={18} />
            设置
          </button>
          <button
            className="bridge-state"
            onClick={() => (connected ? setView('Settings') : setModal('pair'))}
          >
            <span className={`dot ${connected ? '' : 'gray'}`} />
            {connected ? 'Bridge 已连接' : '连接 Bridge'}
            <span>v0.2</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            工作空间 <span className="slash">/</span>
            <strong>{categoryLabel(view)}</strong>
          </span>
          <span className="local-label">
            <ShieldCheck size={14} />
            {connected ? '已连接这台电脑' : '专为本地运行而生'}
          </span>
        </header>
        <div className="feedback" aria-live="polite">
          {error && (
            <div className="error-banner">
              <span>{localizeError(error)}</span>
              <button aria-label="关闭错误提示" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice">
              <Check size={16} />
              {notice}
            </div>
          )}
        </div>
        {view === 'Discover' && (
          <section className="content">
            <div className="eyebrow">少一点配置，多一点可能。</div>
            <h1>
              让 AI 的能力，
              <br />
              <span>就在你的电脑上。</span>
            </h1>
            <p className="intro">
              找到适合你的 AI，一键部署，让数据留在自己手中。
            </p>
            <div className="device-panel">
              <div className="device-icon">
                <Laptop size={45} strokeWidth={1.25} />
              </div>
              <div>
                <div className="eyebrow">这台电脑</div>
                <h2>{connected ? status?.device.chip : quick.os}</h2>
                <p>
                  {connected
                    ? `${status?.device.memoryGB.toFixed(0)} GB 统一内存 · ${status?.device.cpuCores} 核 CPU · ${status?.device.gpuCores ?? '未知'} 核 GPU`
                    : `${quick.cores || '未知'} 个逻辑核心 · 具体芯片待检测`}
                </p>
                <span className="device-storage">
                  <HardDrive size={12} />
                  {connected
                    ? `${Math.floor(status!.device.diskFreeGB)} GB 可用空间 · macOS ${status?.device.osVersion}`
                    : phase}
                </span>
              </div>
              {connected ? (
                <span
                  className={`badge ${status?.device.supported ? '' : 'neutral'}`}
                >
                  <span className="dot" />
                  {status?.device.supported
                    ? '已准备好运行本地 AI'
                    : '暂不支持此系统'}
                </span>
              ) : (
                <button
                  className="outline-btn connect-btn"
                  onClick={() => setModal('pair')}
                >
                  启用本地 AI
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
            {pending && (
              <button
                className="deployment-strip"
                onClick={() => {
                  setActiveId(pending.id);
                  setModal('deploy');
                }}
              >
                <Download size={16} />
                <span>
                  {models.find((m) => m.id === pending.modelId)?.name}{' '}
                  <span className="muted">· {stageLabels[pending.stage]}</span>
                </span>
                <ChevronRight size={16} />
              </button>
            )}
            <div className="section-head">
              <div>
                <h2>
                  {connected ? '最适合这台电脑的 AI' : '从这里，遇见你的 AI'}
                </h2>
                <p>
                  {connected
                    ? '根据本机硬件精选，轻松开启本地 AI 体验。'
                    : '连接 Bridge，获取适合这台电脑的推荐。'}
                </p>
              </div>
              <button
                className="small-link"
                onClick={() =>
                  setFilter(
                    filter === 'All models' ? 'Top picks' : 'All models',
                  )
                }
              >
                {filter === 'All models' ? '返回精选推荐' : '浏览全部模型'}
                <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="catalog-toolbar">
              <div className="catalog-stamp"><span className="dot"/>模型库已核验 · {new Date(catalogInfo.verifiedAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}<small>{catalogInfo.modelCount} 个模型版本 · {catalogInfo.familyCount} 个系列 · 精选本地模型</small></div>
              <label className="catalog-search"><span className="sr-only">搜索模型或开发者</span><input type="search" value={catalogQuery} onChange={e=>setCatalogQuery(e.target.value)} placeholder="搜索模型或开发者…"/>{catalogQuery&&<button aria-label="清空搜索" onClick={()=>setCatalogQuery('')}><X size={14}/></button>}</label>
            </div>
            <Tabs value={filter} onValueChange={(v) => setFilter(String(v))}>
              <TabsList variant="line" className="model-filters">
                {[
                  'Top picks',
                  'Coding',
                  'Reasoning',
                  'Vision',
                  'Fastest',
                  'All models',
                ].map((f) => (
                  <TabsTrigger key={f} value={f}>
                    {categoryLabel(f)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="model-grid">
              {visible.map(({ model, result }) => {
                const installed = status?.installed.some(
                    (m) => m.modelId === model.id,
                  ),
                  isRunning = status?.running.some(
                    (m) => m.modelId === model.id,
                  ),
                  measured = status?.benchmarks.find(
                    (b) => b.modelId === model.id,
                  );
                return (
                  <article
                    className={`model-card ${model.category === 'Best overall' ? 'featured' : ''}`}
                    key={model.id}
                  >
                    <div className="card-top">
                      <ModelIcon model={model} />
                      <span className="category-label">
                        {categoryLabel(model.category)}
                      </span>
                    </div>
                    <h3>{model.name}</h3>
                    <div className="byline">
                      {model.developer} <span>·</span> {Number(model.parameters.toFixed(2))}B
                    </div>
                    <p>{modelDescription(model)}</p>
                    <div className="capability-tags"><span>{model.capabilities.includes('vision') ? '支持图片' : '文字对话'}</span>{model.validation==='inference_tested'&&<span>本机已验证</span>}{status?.runtime.available&&!runtimeCompatible(status.runtime.version,model.minimumRuntimeVersion)&&<span className="runtime-warning">需更新运行环境</span>}</div>
                    <div className="card-rule" />
                    {result ? (
                      <>
                        <span
                          className={`match ${result.compatible ? '' : 'unfit'}`}
                        >
                          <span className="match-icon">
                            {result.compatible ? (
                              <Check size={10} />
                            ) : (
                              <X size={10} />
                            )}
                          </span>
                          {labels[result.status]}
                        </span>
                        <div className="model-meta">
                          <span>
                            <MemoryStick size={13} />
                            {gb(result.memory.total)} 内存
                          </span>
                          <span>
                            <Zap size={13} />
                            {measured
                              ? `${Math.round(measured.tokensPerSecond)} 词元/秒 · 实测`
                              : '速度尚未实测'}
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="unpaired-meta">
                        <Lock size={13} />
                        连接后查看适配结果
                      </div>
                    )}
                    <div className="card-actions">
                      <button
                        disabled={
                          busy ||
                          (connected && (!result?.compatible || status?.busy))
                        }
                        className={`deploy-btn ${installed ? 'installed' : ''}`}
                        onClick={() =>
                          isRunning ? openChat(model) : deploy(model)
                        }
                      >
                        {isRunning ? (
                          <MessageSquare size={14} />
                        ) : installed ? (
                          <Play size={14} />
                        ) : (
                          <Download size={14} />
                        )}{' '}
                        {isRunning ? '聊天' : installed ? '启动' : '部署'}
                      </button>
                      <button
                        className="details-btn"
                        onClick={() => openDetails(model)}
                      >
                        详情
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {!visible.length && (
              <div className="empty">
                <Cpu size={30} />
                <h3>{catalogQuery ? '没有找到匹配的模型' : '暂时没有适合流畅运行的模型'}</h3>
                <p>查看全部模型了解兼容性详情，或重新检测这台电脑。</p>
                <button
                  className="outline-btn"
                  onClick={() => {setCatalogQuery('');setFilter('All models');}}
                >
                  查看全部模型
                </button>
              </div>
            )}
            <footer>
              <ShieldCheck size={14} />
              本地模型，无需订阅，对话始终留在这台电脑。
            </footer>
          </section>
        )}
        {view === 'My AI' && (
          <section className="content">
            <div className="eyebrow">完全属于你</div>
            <h1>
              我的 AI
              <span className="heading-count">
                {status?.installed.length ?? 0}
              </span>
            </h1>
            <p className="intro">把更多可能，收藏在自己的电脑里。</p>
            {!status?.installed.length ? (
              <div className="empty">
                <Box size={38} strokeWidth={1} />
                <h2>你的第一个 AI，正在等你</h2>
                <p>选一个合适的模型，剩下的配置交给我们。</p>
                <button
                  className="solid-btn"
                  onClick={() => setView('Discover')}
                >
                  发现适合你的 AI <ArrowRight size={15} />
                </button>
              </div>
            ) : (
              <div className="installed-list">
                {status.installed.map((item) => {
                  const model = models.find((m) => m.id === item.modelId)!;
                  const run = status.running.some(
                    (m) => m.modelId === model.id,
                  );
                  return (
                    <article className="installed-row" key={model.id}>
                      <ModelIcon model={model} />
                      <div className="installed-title">
                        <h3>{model.name}</h3>
                        <p>
                          {bytes(item.bytes)} · {model.developer}
                        </p>
                      </div>
                      <span className={`badge ${run ? '' : 'neutral'}`}>
                        {run ? '本地运行中' : '已安装'}
                      </span>
                      <div className="row-actions">
                        <button
                          className="outline-btn"
                          disabled={busy || status.busy}
                          onClick={() =>
                            run ? openChat(model) : deploy(model)
                          }
                        >
                          {run ? (
                            <MessageSquare size={14} />
                          ) : (
                            <Play size={14} />
                          )}{' '}
                          {run ? '聊天' : '启动'}
                        </button>
                        {run && (
                          <button
                            className="icon-btn"
                            title="停止模型"
                            aria-label={`停止 ${model.name}`}
                            disabled={busy || status.busy}
                            onClick={() =>
                              action({
                                action: 'stop_model',
                                model_id: model.id,
                              })
                            }
                          >
                            <Square size={15} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          aria-label={`${model.name} 设置`}
                          onClick={() => openDetails(model)}
                        >
                          <Settings2 size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`移除 ${model.name}`}
                          onClick={() => {
                            setSelected(model);
                            setModal('remove');
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {pending && (
              <button
                className="deployment-strip"
                onClick={() => {
                  setActiveId(pending.id);
                  setModal('deploy');
                }}
              >
                <Download size={15} />
                {stageLabels[pending.stage]}
                <ChevronRight size={15} />
              </button>
            )}
          </section>
        )}
        {view === 'Chat' && (
          <section className="chat-view">
            <div className="chat-toolbar">
              <div>
                <span className="eyebrow">当前 AI</span>
                <button
                  className="chat-model"
                  disabled={streaming || preparingImages}
                  onClick={() => setView('My AI')}
                >
                  {models.find((m) => m.id === chatModel)?.name}
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="row-actions">
                <span className={`badge ${running ? '' : 'neutral'}`}>
                  <span className={`dot ${running ? '' : 'gray'}`} />
                  {running ? '私密 · 本地运行' : '未运行'}
                </span>
                <button
                  className="icon-btn"
                  aria-label="使用 API"
                  onClick={() => {
                    setSelected(models.find((m) => m.id === chatModel)!);
                    setModal('api');
                  }}
                >
                  <Code2 size={18} />
                </button>
                <button
                  className="icon-btn"
                  disabled={streaming || !messages.length}
                  aria-label="清空当前对话"
                  onClick={() => {
                    setMessages([]);
                    void clearChat(chatModel).catch(() =>
                      setError('清空本地对话失败，请重试。'),
                    );
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
            <div className="chat-messages">
              {!messages.length ? (
                <div className="chat-welcome">
                  <span className="welcome-icon">
                    <Sparkles size={30} strokeWidth={1} />
                  </span>
                  <h2>让想法，在这里展开。</h2>
                  <p>问一个问题，理清一个思路，创造一点新东西。</p>
                  {running ? (
                    <div className="suggestions">
                      {[
                        '用简单的话解释一个概念',
                        '帮我写一段文字',
                        '一起构思一个新想法',
                      ].map((t) => (
                        <button key={t} onClick={() => setInput(t)}>
                          {t}
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="solid-btn"
                      onClick={() =>
                        setView(status?.installed.length ? 'My AI' : 'Discover')
                      }
                    >
                      {status?.installed.length
                        ? '启动一个 AI'
                        : '找到你的第一个 AI'}
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`message ${m.role}`}>
                    <span className="message-avatar">
                      {m.role === 'user' ? '你' : <Sparkles size={16} />}
                    </span>
                    <div className="message-body">
                      {!!m.images?.length && (
                        <div className="message-images">
                          {m.images.map((image) => (
                            <figure key={image.id}>
                              <img
                                src={image.dataUrl}
                                alt={image.name}
                                width={image.width}
                                height={image.height}
                                loading="lazy"
                              />
                              <figcaption>{image.name}</figcaption>
                            </figure>
                          ))}
                        </div>
                      )}
                      {m.content || (
                        <span className="thinking">
                          <LoaderCircle size={15} className="spin" />
                          正在本地思考…
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className={`composer ${draggingImages ? 'image-drop-active' : ''}`}
              onSubmit={send}
              onDragEnter={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                  dragDepth.current++;
                  setDraggingImages(true);
                }
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) e.preventDefault();
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                if (--dragDepth.current <= 0) {
                  dragDepth.current = 0;
                  setDraggingImages(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                dragDepth.current = 0;
                setDraggingImages(false);
                void addImages(Array.from(e.dataTransfer.files));
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.items)
                  .filter((item) => item.type.startsWith('image/'))
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => file !== null);
                if (files.length) {
                  e.preventDefault();
                  void addImages(files);
                }
              }}
            >
              {draggingImages && (
                <div className="drop-hint" role="status">
                  {supportsVision
                    ? '松开鼠标，添加图片'
                    : '当前模型只支持文字，请切换视觉模型'}
                </div>
              )}
              {!!attachments.length && (
                <div className="attachment-tray" aria-label="待发送的图片">
                  {attachments.map((image) => (
                    <div className="attachment" key={image.id}>
                      <img src={image.dataUrl} alt={image.name} />
                      <span title={image.name}>{image.name}</span>
                      <button
                        className="attachment-remove"
                        type="button"
                        aria-label={`移除图片 ${image.name}`}
                        disabled={preparingImages || streaming}
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((i) => i.id !== image.id),
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                aria-label="选择图片"
                onChange={(e) => {
                  void addImages(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />

              <textarea
                aria-label="向本地 AI 发送消息"
                placeholder={
                  running
                    ? supportsVision
                      ? '输入问题，或粘贴 / 拖入图片…'
                      : '有什么想聊的？'
                    : '启动一个 AI，开始私密对话。'
                }
                value={input}
                disabled={!running || !connected || loadedChat !== chatModel}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
              />
              <div className="composer-bottom">
                <div className="composer-tools">
                  {supportsVision && (
                    <button
                      className="image-upload-btn"
                      type="button"
                      title="添加图片（PNG、JPEG、WebP；最多 4 张，单张原图不超过 10 MB）"
                      aria-label="添加图片"
                      disabled={
                        !running ||
                        !connected ||
                        streaming ||
                        preparingImages ||
                        attachments.length >= MAX_CHAT_IMAGES
                      }
                      onClick={() => fileInput.current?.click()}
                    >
                      {preparingImages ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <ImagePlus size={18} />
                      )}
                      <span>
                        {preparingImages ? '处理图片中…' : '添加图片'}
                      </span>
                    </button>
                  )}
                  <span className="composer-privacy">
                    <Lock size={12} />
                    {saveHistory ? '仅保存在此浏览器' : '对话记录保存已关闭'}
                  </span>
                </div>
                {streaming ? (
                  <button
                    type="button"
                    className="send-btn"
                    aria-label="停止生成"
                    onClick={() => streamAbort.current?.abort()}
                  >
                    <Square size={16} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-btn"
                    aria-label="发送消息"
                    disabled={
                      (!input.trim() && !attachments.length) ||
                      !running ||
                      !connected ||
                      preparingImages ||
                      loadedChat !== chatModel
                    }
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </form>
            <p className="chat-footnote">
              {supportsVision
                ? '最多 4 张图片 · 自动缩小处理 · 最近 4 张图片保留在视觉上下文中 · 全程本地'
                : '当前模型仅支持文字。切换到视觉模型后，即可发送图片。'}
            </p>
          </section>
        )}
        {view === 'Settings' && (
          <section className="content settings-view">
            <div className="eyebrow">用起来，更自在</div>
            <h1>你的本地工作空间。</h1>
            <p className="intro">设置简单，一切清晰。</p>
            <div className="settings-panel">
              <h2>
                <Unplug size={19} />
                CanIRunAI Bridge
              </h2>
              <div className="settings-row">
                <div>
                  <h3>{phase}</h3>
                  <p>本地服务仅允许从这台电脑访问。</p>
                </div>
                <button
                  className="outline-btn"
                  onClick={() => (connected ? disconnect() : setModal('pair'))}
                >
                  {connected ? '断开连接' : '连接'}
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <h3>这台电脑</h3>
                  <p>
                    {status
                      ? `${status.device.chip} · ${status.device.model} · ${status.device.memoryGB} GB 内存`
                      : quick.os}
                  </p>
                </div>
                <button
                  className="icon-btn"
                  aria-label="重新检测本机"
                  disabled={busy}
                  onClick={async () => {
                    if (!connected) {
                      await probe();
                      return;
                    }
                    await action({ action: 'detect_hardware' });
                    setNotice('硬件信息已更新。');
                  }}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <h3>本地运行环境</h3>
                  <p>
                    {status?.runtime.available
                      ? `Ollama ${status.runtime.version}`
                      : '运行本地模型需要 Ollama。'}
                  </p>
                </div>
                {status?.runtime.available ? (
                  <span className="badge">可用</span>
                ) : (
                  <button
                    className="outline-btn"
                    onClick={() => setModal(connected ? 'runtime' : 'pair')}
                  >
                    安装
                  </button>
                )}
              </div>
            </div>
            <div className="settings-panel">
              <h2>
                <ShieldCheck size={19} />
                隐私
              </h2>
              <div className="settings-row">
                <div>
                  <h3>在本机保存对话记录</h3>
                  <p>关闭后也会删除此前保存的对话记录。</p>
                </div>
                <Switch
                  aria-label="保存对话记录"
                  checked={saveHistory}
                  onCheckedChange={(v) => {
                    setSaveHistory(v);
                    localStorage.setItem('canirun-save-history', String(v));
                    if (!v)
                      void clearChat().catch(() =>
                        setError('删除历史记录失败，请稍后重试。'),
                      );
                  }}
                />
              </div>
              <div className="settings-row">
                <div>
                  <h3>使用数据统计与云端推理</h3>
                  <p>当前版本不发送使用统计，也不使用云端模型。</p>
                </div>
                <span className="badge neutral">已关闭</span>
              </div>
            </div>
            <div className="settings-panel">
              <h2>
                <Activity size={19} />
                测一测真实速度
              </h2>
              <p className="settings-copy">
                对当前 AI
                进行一次简短的生成测试。结果保留在本机，并显示在模型推荐卡片上。
              </p>
              <button
                className="outline-btn"
                disabled={
                  !connected ||
                  !status?.running.some((m) => m.modelId) ||
                  busy ||
                  status?.busy
                }
                onClick={async () => {
                  const modelId = status?.running.find(
                    (m) => m.modelId,
                  )?.modelId;
                  if (modelId) {
                    const result = await action({
                      action: 'benchmark_model',
                      model_id: modelId,
                    });
                    if (result)
                      setNotice(
                        `实测生成速度：每秒 ${result.tokensPerSecond.toFixed(1)} 词元。`,
                      );
                  }
                }}
              >
                {busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Zap size={15} />
                )}
                开始快速测试
              </button>
            </div>
          </section>
        )}
      </main>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent className="product-dialog sm:max-w-[520px]">
          {error && (
            <p className="inline-warning" role="alert">
              {localizeError(error)}
            </p>
          )}
          {modal === 'pair' && (
            <>
              <span className="dialog-symbol">
                <Unplug size={24} />
              </span>
              <DialogTitle>把这台电脑，变成你的 AI 空间。</DialogTitle>
              <DialogDescription>
                连接 CanIRunAI Bridge，获取准确推荐并一键部署。
              </DialogDescription>
              <div className="pair-benefits">
                <span>
                  <Check size={15} />
                  自动检测本机硬件
                </span>
                <span>
                  <Check size={15} />
                  下载并运行本地 AI
                </span>
                <span>
                  <Check size={15} />
                  让对话保留在本机
                </span>
              </div>
              <div className="pair-help">
                启动 CanIRunAI，输入本地终端中显示的 8 位配对码。配对码在 10
                分钟后失效。
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect();
                }}
              >
                <label htmlFor="pair-code" className="input-label">
                  本机配对码
                </label>
                <input
                  id="pair-code"
                  className="pair-input"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="00000000"
                />
                <button
                  className="solid-btn full"
                  disabled={busy || code.length !== 8}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Lock size={15} />
                  )}
                  安全连接
                </button>
              </form>
              <p className="dialog-note">
                Bridge 仅提供预定义的 AI
                操作，不提供文件浏览或任意命令执行接口。
              </p>
              <button className="small-link" onClick={() => probe()}>
                检查 Bridge 连接 <RefreshCw size={13} />
              </button>
              <span className="muted">{phase}</span>
            </>
          )}
          {modal === 'details' && (
            <>
              <ModelIcon model={selected} />
              <DialogTitle>{selected.name}</DialogTitle>
              <DialogDescription>
                {modelDescription(selected)}
              </DialogDescription>
              {recommendation ? (
                <>
                  <span className="badge">
                    {labels[recommendation.result.status]}
                  </span>
                  <div className="detail-grid">
                    <div>
                      <span>内存占用</span>
                      <strong>{gb(recommendation.result.memory.total)}</strong>
                    </div>
                    <div>
                      <span>下载大小</span>
                      <strong>{bytes(selected.variants[0].bytes)}</strong>
                    </div>
                    <div>
                      <span>推荐上下文</span>
                      <strong>
                        {recommendation.result.context.recommended / 1024}K
                      </strong>
                    </div>
                    <div>
                      <span>可用上下文上限</span>
                      <strong>
                        {recommendation.result.context.practicalMax / 1024}K
                      </strong>
                    </div>
                  </div>
                  {recommendation.result.reasons.map((r) => (
                    <p className="inline-warning" key={r}>
                      {localizeError(r)}
                    </p>
                  ))}
                  <details className="technical">
                    <summary>技术详情</summary>
                    <p className="catalog-detail-note">核验时间：{new Date(selected.verifiedAt).toLocaleDateString('zh-CN')} · {selected.validation==='inference_tested'?'已通过本机推理测试':'已核验官方元数据，尚未逐一实机测试'}</p>
                    <dl>
                      <dt>模型版本</dt>
                      <dd>{selected.variants[0].quantization}</dd>
                      <dt>运行环境</dt><dd>Ollama · Metal</dd><dt>最低 Ollama 版本</dt><dd>{selected.minimumRuntimeVersion ?? '官方未注明'}</dd><dt>模型总参数</dt><dd>{selected.parameters.toFixed(2)}B</dd>
                      <dt>模型上下文上限</dt>
                      <dd>{selected.context / 1024}K 词元</dd>
                      <dt>模型权重</dt>
                      <dd>{gb(recommendation.result.memory.model)}</dd>
                      <dt>上下文内存</dt>
                      <dd>{gb(recommendation.result.memory.kvCache)}</dd>
                      <dt>运行环境开销</dt>
                      <dd>{gb(recommendation.result.memory.runtime)}</dd>
                      <dt>系统预留</dt>
                      <dd>
                        {gb(recommendation.result.memory.reserve)} + 15%
                        安全余量
                      </dd>
                      <dt>许可证</dt>
                      <dd>{selected.license}</dd>
                    </dl>
                    <p className="catalog-detail-note">{selected.memoryEstimateNote}</p>
                    <p className="digest">
                      SHA-256 {selected.variants[0].digest}
                    </p>
                    <label className="input-label" htmlFor="context">
                      下次启动使用的上下文
                    </label>
                    <select
                      id="context"
                      value={context}
                      onChange={(e) => setContext(Number(e.target.value))}
                    >
                      {[2048, 4096, 8192, 16384, 32768]
                        .filter(
                          (c) =>
                            c <= recommendation.result.context.practicalMax,
                        )
                        .map((c) => (
                          <option key={c} value={c}>
                            {c / 1024}K 词元
                          </option>
                        ))}
                    </select>
                  </details>
                </>
              ) : (
                <div className="pair-help">
                  连接 Bridge，查看适合这台电脑的配置。
                </div>
              )}
              <a
                className="small-link"
                href={selected.officialSource}
                target="_blank"
                rel="noreferrer"
              >
                查看已核验的模型来源 <ArrowUpRight size={14} />
              </a>
              <button
                className="solid-btn full"
                disabled={
                  busy || (connected && !recommendation?.result.compatible)
                }
                onClick={() => deploy(selected, false, context)}
              >
                <Download size={16} />
                {connected
                  ? selectedInstalled
                    ? '使用此配置启动'
                    : '部署这个 AI'
                  : '启用本地 AI'}
              </button>
            </>
          )}
          {modal === 'deploy' && (
            <>
              <span className="dialog-symbol">
                {active?.stage === 'running' ? (
                  <Check size={26} />
                ) : (
                  <Download size={24} />
                )}
              </span>
              <DialogTitle>
                {active ? stageLabels[active.stage] : '正在准备部署'}
              </DialogTitle>
              <DialogDescription>
                {models.find((m) => m.id === active?.modelId)?.name}{' '}
                {active?.stage === 'running'
                  ? '正在这台电脑上运行。'
                  : '· 全部操作均在本机完成。'}
              </DialogDescription>
              {active && (
                <>
                  <div className="deployment-steps">
                    {[
                      ['准备中', ['preparing', 'checking']],
                      ['运行环境', ['installing_runtime']],
                      ['正在下载模型', ['downloading', 'paused']],
                      ['正在配置', ['verifying', 'configuring']],
                      ['正在启动', ['starting', 'health_check']],
                      ['就绪', ['running']],
                    ].map(([label, stages], i) => {
                      const order = [
                        'preparing',
                        'checking',
                        'installing_runtime',
                        'downloading',
                        'paused',
                        'verifying',
                        'configuring',
                        'starting',
                        'health_check',
                        'running',
                      ];
                      const current = (stages as string[]).includes(
                          active.stage,
                        ),
                        done =
                          order.indexOf(active.stage) >
                          Math.max(
                            ...(stages as string[]).map((s) =>
                              order.indexOf(s),
                            ),
                          );
                      return (
                        <div
                          className={`deployment-step ${current ? 'current' : ''}`}
                          key={label as string}
                        >
                          <span className={`step-num ${done ? 'done' : ''}`}>
                            {done ? <Check size={12} /> : i + 1}
                          </span>
                          <span>{label as string}</span>
                          <small>
                            {done ? '已完成' : current ? '进行中' : '等待中'}
                          </small>
                        </div>
                      );
                    })}
                  </div>
                  {['downloading', 'paused'].includes(active.stage) && (
                    <div className="download-progress">
                      <Progress
                        value={Math.min(
                          100,
                          (active.download.completed /
                            Math.max(1, active.download.total)) *
                            100,
                        )}
                      />
                      <div>
                        <span>
                          {bytes(active.download.completed)} /{' '}
                          {bytes(active.download.total)}
                        </span>
                        <span>
                          {active.stage === 'paused'
                            ? '已暂停'
                            : `${bytes(active.download.speed)}/s${active.download.eta ? ` · ~${Math.ceil(active.download.eta / 60)} 分钟` : ''}`}
                        </span>
                      </div>
                    </div>
                  )}
                  {active.error && (
                    <div className="inline-warning">
                      {localizeError(active.error.message)}
                    </div>
                  )}
                  <div className="dialog-actions">
                    {active.stage === 'downloading' && (
                      <button
                        className="outline-btn"
                        disabled={busy}
                        onClick={() =>
                          action({
                            action: 'pause_download',
                            deployment_id: active.id,
                          })
                        }
                      >
                        <Pause size={14} />
                        暂停
                      </button>
                    )}
                    {['paused', 'failed', 'cancelled'].includes(
                      active.stage,
                    ) && (
                      <button
                        className="solid-btn"
                        disabled={busy || status?.busy}
                        onClick={() =>
                          active.error?.fix === 'install_runtime'
                            ? setModal('runtime')
                            : active.error?.fix === 'reduce_context'
                              ? deploy(
                                  models.find((m) => m.id === active.modelId)!,
                                  false,
                                  Math.max(2048, active.plan.context / 2),
                                )
                              : action({
                                  action: 'resume_download',
                                  deployment_id: active.id,
                                })
                        }
                      >
                        <Play size={14} />
                        {active.error ? '修复并重试' : '继续下载'}
                      </button>
                    )}
                    {['downloading', 'paused', 'failed'].includes(
                      active.stage,
                    ) && (
                      <button
                        className="outline-btn"
                        disabled={busy}
                        onClick={() =>
                          action({
                            action: 'cancel_deployment',
                            deployment_id: active.id,
                          })
                        }
                      >
                        取消
                      </button>
                    )}
                    {active.stage === 'running' && (
                      <>
                        <button
                          className="solid-btn"
                          onClick={() =>
                            openChat(
                              models.find((m) => m.id === active.modelId)!,
                            )
                          }
                        >
                          <MessageSquare size={15} />
                          开始聊天
                        </button>
                        <button
                          className="outline-btn"
                          onClick={() => {
                            setSelected(
                              models.find((m) => m.id === active.modelId)!,
                            );
                            setModal('api');
                          }}
                        >
                          使用 API
                        </button>
                      </>
                    )}
                  </div>
                  <details className="technical">
                    <summary>查看开发者日志</summary>
                    <pre>{active.logs.join('\n')}</pre>
                  </details>
                </>
              )}
            </>
          )}
          {modal === 'runtime' && (
            <>
              <span className="dialog-symbol">
                <Box size={24} />
              </span>
              <DialogTitle>{status?.runtime.available ? '这个模型需要更新运行环境。' : '只需完成这一步设置。'}</DialogTitle>
              <DialogDescription>
                CanIRunAI 需要本地运行环境来启动 AI。我们将安装已核验的 Ollama
                官方版本。
              </DialogDescription>
              <div className="detail-grid">
                <div>
                  <span>运行环境</span>
                  <strong>Ollama {runtimeRelease.version}</strong>
                </div>
                <div>
                  <span>下载大小</span>
                  <strong>{bytes(runtimeRelease.bytes)}</strong>
                </div>
              </div>
              <div className="pair-help">
                来源：github.com/ollama/ollama
                <br />
                安装前将校验 SHA-256。
                <br />
                安装在 CanIRunAI 的本地数据目录中。
              </div>
              {status?.runtime.available ? <div className="runtime-update"><p>当前版本 {status.runtime.version}，此模型至少需要 {selected.minimumRuntimeVersion ?? runtimeRelease.version}。更新 Ollama 并重新启动后，即可继续部署。</p><a className="solid-btn full" href="https://ollama.com/download/mac" target="_blank" rel="noreferrer">打开 Ollama 官方下载页 <ArrowUpRight size={15}/></a><button className="outline-btn full" onClick={async()=>{await refresh();setModal(null);}}>我已更新，重新检查</button></div> : <button
                className="solid-btn full"
                disabled={busy}
                onClick={async () => {
                  const result = await action({
                    action: 'install_runtime',
                    confirmed: true,
                  });
                  if (result) {
                    setModal(null);
                    setNotice('运行环境已安装，可以部署 AI 了。');
                  }
                }}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Download size={16} />
                )}{' '}
                {busy ? '正在安装运行环境…' : '安装运行环境'}
              </button>}
            </>
          )}
          {modal === 'switch' && (
            <>
              <span className="dialog-symbol">
                <RefreshCw size={24} />
              </span>
              <DialogTitle>为 {selected.name} 腾出空间。</DialogTitle>
              <DialogDescription>
                为保证电脑运行流畅，我们会先停止{' '}
                {status?.running
                  .map(
                    (m) =>
                      models.find((x) => x.id === m.modelId)?.name ?? m.tag,
                  )
                  .join(', ')}{' '}
                再启动这个 AI。已保存的对话不会丢失。
              </DialogDescription>
              <button
                className="solid-btn full"
                disabled={busy}
                onClick={() => deploy(selected, true)}
              >
                切换模型
                <ArrowRight size={16} />
              </button>
            </>
          )}
          {modal === 'remove' && (
            <>
              <DialogTitle>移除 {selected.name}？</DialogTitle>
              <DialogDescription>
                这将停止模型，并从 Ollama
                中移除已下载的模型文件。已保存的对话仍会保留在此浏览器中。
              </DialogDescription>
              <div className="dialog-actions">
                <button className="outline-btn" onClick={() => setModal(null)}>
                  保留模型
                </button>
                <button
                  className="danger-btn"
                  disabled={busy || status?.busy}
                  onClick={async () => {
                    const result = await action({
                      action: 'delete_model',
                      model_id: selected.id,
                    });
                    if (result !== null) {
                      setModal(null);
                      setNotice('模型已移除。');
                    }
                  }}
                >
                  移除模型
                </button>
              </div>
            </>
          )}
          {modal === 'api' && (
            <>
              <span className="dialog-symbol">
                <Code2 size={24} />
              </span>
              <DialogTitle>在自己的应用里，使用你的 AI。</DialogTitle>
              <DialogDescription>
                模型运行时，可通过本机的 OpenAI 兼容接口调用。会话令牌在 15
                分钟后失效，保持页面打开时会自动轮换。
              </DialogDescription>
              <div className="api-url">http://127.0.0.1:31415/v1</div>
              <pre className="api-example">{`POST /v1/chat/completions\nOrigin: http://localhost:3000\nAuthorization: Bearer <临时会话令牌>\n\n{\n  "model": "${selected.id}",\n  "messages": [\n    { "role": "user", "content": "你好！" }\n  ]\n}`}</pre>
              <button
                className="solid-btn full"
                disabled={!connected}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `curl http://127.0.0.1:31415/v1/chat/completions -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' -H 'Authorization: Bearer ${session.current}' -d '${JSON.stringify({ model: selected.id, messages: [{ role: 'user', content: '你好！' }], stream: false })}'`,
                    );
                    setNotice('已复制 API 示例，其中包含你的临时会话令牌。');
                  } catch {
                    setError('无法访问剪贴板。');
                  }
                }}
              >
                复制 API 示例
              </button>
              <p className="dialog-note">
                仅限本机访问。请像保护密码一样保管临时令牌。
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
