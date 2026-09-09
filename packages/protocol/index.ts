import { z } from "zod";
const gb = z.number().nonnegative();
export const DeviceProfileSchema = z
  .object({
    os: z.string(),
    osVersion: z.string(),
    architecture: z.string(),
    supported: z.boolean(),
    model: z.string(),
    chip: z.string(),
    cpuCores: z.number(),
    gpuCores: z.number().nullable(),
    memoryGB: gb,
    freeMemoryGB: gb,
    diskFreeGB: gb,
    metal: z.string().nullable(),
    neuralEngine: z.string().nullable(),
    bandwidthGBs: z.number().nullable(),
    powerMode: z.string().nullable(),
  })
  .strict();
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;
export const ModelVariantSchema = z
  .object({
    id: z.string(),
    tag: z.string(),
    quantization: z.string(),
    runtime: z.literal("ollama"),
    bytes: gb,
    weightGB: gb,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    modelDigest: z.string(),
    layers: z.number(),
    kvHeads: z.number(),
    headDim: z.number(),
    kvHeadsByLayer: z.array(z.number().nonnegative()).optional(),
    stateMemoryGB: gb.optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export const ModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    developer: z.string(),
    family: z.string(),
    architecture: z.string(),
    parameters: z.number(),
    activeParameters: z.number().nullable(),
    category: z.string(),
    description: z.string(),
    context: z.number(),
    capabilities: z.array(z.string()),
    officialSource: z.url(),
    license: z.string(),
    releaseDate: z.string().nullable(),
    minimumRuntimeVersion: z.string().nullable().optional(),
    memoryEstimateNote: z.string().optional(),
    metadataSource: z.string().optional(),
    validation: z.enum(["metadata_verified", "inference_tested"]).optional(),
    quality: z.number(),
    variants: z.array(ModelVariantSchema).min(1),
    verifiedAt: z.string(),
  })
  .strict();
export type Model = z.infer<typeof ModelSchema>;
export type ModelVariant = z.infer<typeof ModelVariantSchema>;
export const CompatibilityResultSchema = z.object({
  compatible: z.boolean(),
  status: z.enum(["perfect", "great", "well", "limited", "unsupported"]),
  reasons: z.array(z.string()),
  recommendedVariant: z.string(),
  recommendedRuntime: z.literal("ollama"),
  memory: z.object({
    model: gb,
    kvCache: gb,
    runtime: gb,
    reserve: gb,
    total: gb,
    safeAvailable: gb,
    headroom: z.number(),
  }),
  context: z.object({
    modelMax: z.number(),
    minimum: z.number(),
    recommended: z.number(),
    practicalMax: z.number(),
  }),
  performance: z.object({
    min: gb.nullable(),
    max: gb.nullable(),
    confidence: z.enum(["estimated", "measured", "unknown"]),
  }),
  scores: z.object({
    compatibility: z.number(),
    performance: z.number(),
    quality: z.number(),
    runtimeConfidence: z.number(),
    benchmarkConfidence: z.number(),
    recommendation: z.number(),
  }),
});
export type CompatibilityResult = z.infer<typeof CompatibilityResultSchema>;
export const RecommendationSchema = z.object({
  model: ModelSchema,
  result: CompatibilityResultSchema,
});
export type Recommendation = z.infer<typeof RecommendationSchema>;
export const RuntimeSchema = z.object({
  id: z.literal("ollama"),
  version: z.string(),
  supportedOS: z.array(z.string()),
  architecture: z.array(z.string()),
  source: z.url(),
  checksum: z.string(),
  bytes: gb,
  format: z.array(z.string()),
});
export const DeploymentPlanSchema = z.object({
  modelId: z.string(),
  variantId: z.string(),
  runtimeId: z.literal("ollama"),
  context: z.number(),
  backend: z.literal("metal"),
  downloadBytes: gb,
  memoryGB: gb,
});
export type DeploymentPlan = z.infer<typeof DeploymentPlanSchema>;
export const LocalErrorSchema = z.object({
  code: z.enum([
    "disk_full",
    "runtime_missing",
    "runtime_install_failed",
    "unsupported",
    "oom",
    "model_corrupt",
    "download_failed",
    "runtime_offline",
    "busy",
    "unknown",
  ]),
  message: z.string(),
  fix: z.enum(["retry", "reduce_context", "install_runtime", "free_disk", "none"]),
});
export type LocalError = z.infer<typeof LocalErrorSchema>;
export const FixActionSchema = z
  .object({
    action: z.enum(["retry", "reduce_context", "install_runtime", "free_disk", "none"]),
    deploymentId: z.string(),
  })
  .strict();
export const DownloadTaskSchema = z.object({
  completed: gb,
  total: gb,
  speed: gb,
  eta: gb.nullable(),
});
export const DeploymentSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  stage: z.enum([
    "preparing",
    "checking",
    "installing_runtime",
    "downloading",
    "verifying",
    "configuring",
    "starting",
    "health_check",
    "running",
    "paused",
    "failed",
    "cancelled",
    "stopped",
  ]),
  plan: DeploymentPlanSchema,
  download: DownloadTaskSchema,
  logs: z.array(z.string()),
  error: LocalErrorSchema.nullable(),
  updatedAt: z.string(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;
export const RunningModelSchema = z.object({
  modelId: z.string(),
  tag: z.string(),
  memoryGB: gb,
  context: z.number(),
});
export const BenchmarkResultSchema = z.object({
  modelId: z.string(),
  tokens: z.number(),
  tokensPerSecond: z.number(),
  promptTokensPerSecond: z.number(),
  measuredAt: z.string(),
  device: z.string(),
  runtime: z.string(),
});
const id = z.string().min(1).max(100);
export const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("detect_hardware") }).strict(),
  z.object({ action: z.literal("list_models") }).strict(),
  z.object({ action: z.literal("install_runtime"), confirmed: z.literal(true) }).strict(),
  z
    .object({
      action: z.literal("deploy"),
      model_id: id,
      context_length: z.number().int().min(2048).max(32768).optional(),
      switch_confirmed: z.boolean().optional(),
    })
    .strict(),
  ...(
    ["start_model", "stop_model", "restart_model", "delete_model", "benchmark_model"] as const
  ).map((action) =>
    z
      .object({ action: z.literal(action), model_id: id, switch_confirmed: z.boolean().optional() })
      .strict(),
  ),
  ...(["pause_download", "resume_download", "cancel_deployment", "retry_deployment"] as const).map(
    (action) => z.object({ action: z.literal(action), deployment_id: id }).strict(),
  ),
]);
export const PairSchema = z
  .object({ challenge: z.string().length(48), code: z.string().regex(/^\d{8}$/) })
  .strict();
// Only inline image bytes are accepted. No remote URLs or local file paths.
export const MAX_CHAT_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_CHAT_BODY_BYTES = 12 * 1024 * 1024;
export const ImageDataUrlSchema = z
  .string()
  .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64, "图片处理后不能超过 2 MB。")
  .regex(
    /^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    "仅支持内嵌的 PNG、JPEG 或 WebP 图片。",
  )
  .refine((value) => {
    const payload = value.slice(value.indexOf(",") + 1);
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    const bytes = (payload.length * 3) / 4 - padding;
    return bytes > 0 && bytes <= MAX_IMAGE_BYTES;
  }, "图片数据不能为空，且不能超过 2 MB。");
export const ContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(32000) }).strict(),
  z
    .object({
      type: z.literal("image_url"),
      image_url: z
        .object({ url: ImageDataUrlSchema, detail: z.enum(["auto", "low", "high"]).optional() })
        .strict(),
    })
    .strict(),
]);
export const MessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.union([z.string().max(32000), z.array(ContentPartSchema).min(1).max(8)]),
  })
  .strict()
  .superRefine((message, ctx) => {
    if (Array.isArray(message.content)) {
      if (message.role !== "user" && message.content.some((p) => p.type === "image_url"))
        ctx.addIssue({ code: "custom", message: "只有用户消息可以附带图片。" });
      if (message.content.reduce((n, p) => n + (p.type === "text" ? p.text.length : 0), 0) > 32000)
        ctx.addIssue({ code: "custom", message: "单条消息的文字过长。" });
    }
  });
export const ChatSchema = z
  .object({
    model: id,
    messages: z.array(MessageSchema).min(1).max(64),
    stream: z.boolean().default(true),
    max_tokens: z.number().int().min(1).max(2048).default(768),
    temperature: z.number().min(0).max(2).default(0.7),
  })
  .strict()
  .superRefine((chat, ctx) => {
    const images = chat.messages.reduce(
      (n, m) =>
        n + (Array.isArray(m.content) ? m.content.filter((p) => p.type === "image_url").length : 0),
      0,
    );
    if (images > MAX_CHAT_IMAGES)
      ctx.addIssue({ code: "custom", message: "一次请求最多包含 4 张图片。" });
  });
export type ChatInput = z.infer<typeof ChatSchema>;
