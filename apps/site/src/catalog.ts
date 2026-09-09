import { recommend } from "../../../packages/compatibility-engine/index.ts";
import type {
  DeviceProfile,
  Model,
  Recommendation,
} from "../../../packages/protocol/index.ts";

export type Configuration = {
  platform: "apple" | "unsupported";
  memoryGB: number;
  freeMemoryGB: number;
  diskFreeGB: number;
};
export type Category =
  | "all"
  | "vision"
  | "coding"
  | "reasoning"
  | "lightweight";
export type Sort = "recommended" | "size" | "name";
export const defaults: Configuration = {
  platform: "apple",
  memoryGB: 16,
  freeMemoryGB: 12,
  diskFreeGB: 100,
};

function bounded(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  if (!value?.trim() || !Number.isFinite(Number(value))) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

export function readConfiguration(params: URLSearchParams): Configuration {
  const memoryGB = bounded(params.get("memory"), defaults.memoryGB, 4, 512);
  return {
    platform:
      params.get("platform") === "unsupported" ? "unsupported" : "apple",
    memoryGB,
    freeMemoryGB: bounded(
      params.get("free"),
      Math.min(defaults.freeMemoryGB, memoryGB),
      0,
      memoryGB,
    ),
    diskFreeGB: bounded(params.get("disk"), defaults.diskFreeGB, 0, 1_000_000),
  };
}

export function readConfigurationURL(url: string): Configuration {
  const { hash } = new URL(url);
  return readConfiguration(
    new URLSearchParams(hash.startsWith("#config?") ? hash.slice(8) : ""),
  );
}

export function configurationURL(url: string, config: Configuration) {
  const result = new URL(url);
  result.search = "";
  // URL fragments stay in the browser instead of entering hosting access logs.
  result.hash = `config?${new URLSearchParams({
    platform: config.platform,
    memory: String(config.memoryGB),
    free: String(config.freeMemoryGB),
    disk: String(config.diskFreeGB),
  })}`;
  return result.href;
}

export function deviceFromConfiguration(config: Configuration): DeviceProfile {
  return {
    memoryGB: config.memoryGB,
    freeMemoryGB: config.freeMemoryGB,
    diskFreeGB: config.diskFreeGB,
    os: config.platform === "apple" ? "macOS" : "unsupported",
    osVersion: "Unknown",
    architecture: config.platform === "apple" ? "arm64" : "Unknown",
    supported: config.platform === "apple",
    model: "手动配置",
    chip: "Unknown",
    cpuCores: 0,
    gpuCores: null,
    metal: null,
    neuralEngine: null,
    bandwidthGBs: null,
    powerMode: null,
  };
}

export function recommendations(config: Configuration, models: Model[]) {
  return recommend(deviceFromConfiguration(config), models);
}

export const statusLabels = {
  perfect: "余量充足",
  great: "适合运行",
  well: "可以运行",
  limited: "内存较紧张",
  unsupported: "暂不适合",
};
const reasonLabels: Record<string, string> = {
  "This release supports Apple Silicon macOS only.":
    "目前只评估 Apple Silicon Mac，不能据此判断其他平台。",
  "Not enough free storage.": "剩余磁盘空间不足，请预留下载与安装空间。",
  "Not enough safe memory for practical conversation.":
    "可用内存不足以支持实用的对话上下文。",
};
export const translateReason = (reason: string) =>
  reasonLabels[reason] ?? reason;
const descriptions: Record<string, string> = {
  "qwen3-0.6b": "轻巧、迅速，随时回答你的日常问题。",
  "qwen3-1.7b": "小巧的体积，多一点思考的能力。",
  "qwen3-4b": "陪你写作、探索，把复杂的想法理清楚。",
  "qwen3-8b": "为复杂的问题，留出更多思考空间。",
  "qwen2.5-coder-7b": "从第一个想法，到真正能运行的代码。",
  "gemma3-4b": "用新的视角，理解文字与图像。",
};
export const description = (model: Model) =>
  descriptions[model.id] ??
  model.description.replace(
    /(?<=[\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu,
    "",
  );
export const selectedVariant = ({ model, result }: Recommendation) =>
  model.variants.find((v) => v.id === result.recommendedVariant)!;
export const fileSize = (bytes: number) =>
  bytes < 1e9
    ? `${Math.round(bytes / 1e6)} MB`
    : `${(bytes / 1e9).toFixed(1)} GB`;
export const contextSize = (tokens: number) =>
  tokens >= 1024
    ? `${(tokens / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`
    : String(tokens);

export function filterModels(
  entries: Recommendation[],
  options: {
    query: string;
    category: Category;
    compatibleOnly: boolean;
    sort: Sort;
  },
) {
  const query = options.query.trim().toLocaleLowerCase();
  return entries
    .filter((entry) => {
      const { model, result } = entry;
      if (options.compatibleOnly && !result.compatible) return false;
      if (
        options.category === "lightweight" &&
        selectedVariant(entry).bytes > 2e9
      )
        return false;
      if (
        options.category !== "all" &&
        options.category !== "lightweight" &&
        !model.capabilities.includes(options.category)
      )
        return false;
      return `${model.name} ${model.developer} ${model.id} ${description(model)}`
        .toLocaleLowerCase()
        .includes(query);
    })
    .sort((a, b) => {
      if (options.sort === "size")
        return selectedVariant(a).bytes - selectedVariant(b).bytes;
      if (options.sort === "name")
        return a.model.name.localeCompare(b.model.name);
      return b.result.scores.recommendation - a.result.scores.recommendation;
    });
}
