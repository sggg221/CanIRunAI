import type {
  DeviceProfile,
  Model,
  ModelVariant,
  CompatibilityResult,
  Recommendation,
} from "../protocol/index.ts";
const G = 1073741824;
const contexts = [2048, 4096, 8192, 16384, 32768, 65536, 131072];
export function kvMemory(v: ModelVariant, context: number) {
  return (2 * (v.kvHeadsByLayer?.reduce((n, heads) => n + heads, 0) ?? v.layers * v.kvHeads) * v.headDim * 2 * context) / G;
}
export function evaluate(device: DeviceProfile, model: Model): CompatibilityResult {
  // Dedicated/shared GPU memory is not additive to the RAM-only fallback budget.
  const reserve = Math.max(4, device.memoryGB * 0.2),
    safeAvailable = Math.min(
      Math.max(0, device.memoryGB - reserve) * 0.85,
      device.freeMemoryGB * 0.9,
    );
  const choices = model.variants
    .filter(v => !v.archived)
    .map((v) => {
      const base = v.weightGB * 1.12 + 1.1 + (v.stateMemoryGB ?? 0) + (model.capabilities.includes("vision") ? 0.5 : 0);
      const fits = contexts.filter(
        (c) => c <= model.context && base + kvMemory(v, c) <= safeAvailable,
      );
      return { v, base, max: fits.at(-1) ?? 0 };
    })
    .sort(
      (a, b) =>
        Number(b.max >= 4096) - Number(a.max >= 4096) ||
        Number(b.v.quantization.match(/Q(\d)/)?.[1] ?? 4) -
          Number(a.v.quantization.match(/Q(\d)/)?.[1] ?? 4),
    );
  const { v, base, max } = choices[0];
  const recommended = Math.min(max || 2048, 8192),
    kv = kvMemory(v, recommended),
    total = base + kv;
  const reasons: string[] = [];
  if (!device.supported) reasons.push("This release supports Apple Silicon macOS and Windows 10 22H2 (build 19045+) / Windows 11 with an x64 helper only; Linux, Intel Macs and Windows ARM64 helpers are unsupported.");
  if (device.diskFreeGB < (v.bytes / G) * 1.15 + 1) reasons.push("Not enough free storage.");
  if (max < 2048) reasons.push("Not enough safe memory for practical conversation.");
  const compatible = !reasons.length;
  const headroom = safeAvailable - total;
  const status = !compatible
    ? "unsupported"
    : max < 4096 || headroom < 0.5
      ? "limited"
      : headroom > safeAvailable * 0.45
        ? "perfect"
        : headroom > safeAvailable * 0.2
          ? "great"
          : "well";
  // No measured bandwidth database: conservative architecture heuristic, deliberately wide.
  const bandwidth = device.os === "darwin" && device.architecture === "arm64"
    ? device.bandwidthGBs : null;
  const min = bandwidth ? Math.round((bandwidth * 0.25) / v.weightGB) : null,
    maxSpeed = bandwidth ? Math.round((bandwidth * 0.55) / v.weightGB) : null;
  const performance = Math.max(0, 100 - v.weightGB * 9),
    recommendation = compatible
      ? model.quality * 0.65 + performance * 0.15 + Math.min(20, Math.max(0, headroom) * 3)
      : 0;
  return {
    compatible,
    status,
    reasons,
    recommendedVariant: v.id,
    recommendedRuntime: "ollama",
    memory: {
      model: v.weightGB,
      kvCache: kv,
      runtime: base - v.weightGB,
      reserve,
      total,
      safeAvailable,
      headroom,
    },
    context: { modelMax: model.context, minimum: 2048, recommended, practicalMax: max },
    performance: { min, max: maxSpeed, confidence: bandwidth ? "estimated" : "unknown" },
    scores: {
      compatibility: compatible ? 100 : 0,
      performance,
      quality: model.quality,
      runtimeConfidence: 90,
      benchmarkConfidence: 0,
      recommendation,
    },
  };
}
export function recommend(device: DeviceProfile, models: Model[]): Recommendation[] {
  return models
    .map((model) => ({ model, result: evaluate(device, model) }))
    .sort((a, b) => b.result.scores.recommendation - a.result.scores.recommendation);
}

export function runtimeCompatible(installed: string | null | undefined, minimum: string | null | undefined) {
  if (!minimum) return true;
  if (!installed) return false;
  const left = installed.match(/^(\d+)\.(\d+)\.(\d+)/), right = minimum.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!left || !right) return false;
  for (let i = 1; i <= 3; i++) {
    if (+left[i] > +right[i]) return true;
    if (+left[i] < +right[i]) return false;
  }
  return true;
}
