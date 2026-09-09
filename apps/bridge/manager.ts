import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { models, getModel } from "../../packages/model-registry/index.ts";
import { evaluate, kvMemory, recommend, runtimeCompatible } from "../../packages/compatibility-engine/index.ts";
import {
  DeploymentSchema,
  type Deployment,
  type LocalError,
  type DeviceProfile,
} from "../../packages/protocol/index.ts";
import { detectHardware } from "./hardware.ts";
import { ollama, OLLAMA, runtimeStatus, startRuntime, installRuntime } from "./runtime.ts";
import { runtimeInstallBytes } from "../../packages/runtime-registry/index.ts";
export function reclaimableModelMemory(device: DeviceProfile, loaded: { modelId: string | null; memoryGB: number }[]) {
  return device.os === "darwin" && device.architecture === "arm64"
    ? loaded.filter((model) => model.modelId).reduce((total, model) => total + model.memoryGB, 0)
    : 0;
}
const G = 1073741824;
export class LocalFailure extends Error {
  constructor(
    public code: LocalError["code"],
    message: string,
    public fix: LocalError["fix"] = "retry",
  ) {
    super(message);
  }
}
export class Manager {
  deployments: Deployment[] = [];
  benchmarks: any[] = [];
  controllers = new Map<string, AbortController>();
  busy = false;
  chatBusy = false;
  writeQueue = Promise.resolve();
  hardware: DeviceProfile | null = null;
  private hardwareUpdatedAt = 0;
  private hardwareRequest: Promise<DeviceProfile> | null = null;
  constructor(public dataDir: string, private runtimeStarter = startRuntime) {}
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    try {
      const state = JSON.parse(await readFile(path.join(this.dataDir, "state.json"), "utf8"));
      this.deployments = DeploymentSchema.array().parse(state.deployments);
      this.benchmarks = state.benchmarks ?? [];
      for (const d of this.deployments)
        if (!["running", "stopped", "failed", "paused", "cancelled"].includes(d.stage)) {
          d.stage = "paused";
          d.logs.push("Bridge restarted. Resume to continue.");
        }
      await this.persist();
    } catch {}
  }
  persist() {
    const data = JSON.stringify({ deployments: this.deployments, benchmarks: this.benchmarks });
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const f = path.join(this.dataDir, "state.json");
        await writeFile(f + ".tmp", data, { mode: 0o600 });
        await rename(f + ".tmp", f);
      });
    return this.writeQueue;
  }
  async device(force = true): Promise<DeviceProfile> {
    if (this.hardwareRequest) return this.hardwareRequest;
    if (!force && this.hardware && Date.now() - this.hardwareUpdatedAt < 10000)
      return this.hardware;
    this.hardwareRequest = detectHardware(this.dataDir, this.hardware).then((device) => {
      this.hardware = device;
      this.hardwareUpdatedAt = Date.now();
      return device;
    });
    try {
      return await this.hardwareRequest;
    } finally {
      this.hardwareRequest = null;
    }
  }
  async installed() {
    try {
      const data = await ollama("/api/tags");
      return models.flatMap((model) => {
        const installed = data.models.find((m: any) =>
          model.variants.some((v) => v.tag === m.name && v.digest === m.digest),
        );
        return installed ? [{ modelId: model.id, tag: installed.name, bytes: installed.size }] : [];
      });
    } catch {
      return [];
    }
  }
  async running() {
    try {
      const data = await ollama("/api/ps");
      return data.models.map((m: any) => ({
        modelId: models.find((x) => x.variants.some((v) => v.tag === m.name))?.id ?? null,
        tag: m.name,
        memoryGB: (m.size_vram || m.size) / G,
        context: m.context_length ?? 0,
      }));
    } catch {
      return [];
    }
  }
  async status() {
    const [rt, installed, running] = await Promise.all([
      runtimeStatus(),
      this.installed(),
      this.running(),
    ]);
    const device = await this.device(false);
    return {
      version: "0.2.0",
      device,
      runtime: rt,
      installed,
      running,
      deployments: this.deployments,
      recommendations: recommend(
        {
          ...device,
          freeMemoryGB:
            device.freeMemoryGB +
            reclaimableModelMemory(device, running),
        },
        models,
      ),
      benchmarks: this.benchmarks,
      busy: this.busy || this.chatBusy,
    };
  }
  async stage(d: Deployment, stage: Deployment["stage"], log: string) {
    d.stage = stage;
    d.updatedAt = new Date().toISOString();
    d.logs.push(log);
    d.logs = d.logs.slice(-60);
    await this.persist();
  }
  async checkRuntimeVersion(modelId: string) {
    const rt = await runtimeStatus(), registered = getModel(modelId);
    if (rt.available && !runtimeCompatible(rt.version, registered.minimumRuntimeVersion))
      throw new LocalFailure("unsupported", `此模型需要 Ollama ${registered.minimumRuntimeVersion} 或更新版本（当前 ${rt.version}）。请更新本地 Ollama 后重试。`, "none");
    return rt;
  }
  async preflight(modelId: string, context?: number) {
    await this.checkRuntimeVersion(modelId);
    const model = getModel(modelId),
      device = await this.device(),
      loaded = await this.running(),
      result = evaluate(
        {
          ...device,
          freeMemoryGB:
            device.freeMemoryGB +
            reclaimableModelMemory(device, loaded),
        },
        model,
      ),
      v = model.variants.find((v) => v.id === result.recommendedVariant)!;
    if (!device.supported)
      throw new LocalFailure("unsupported", "This version requires Apple Silicon macOS or x64 Windows 10 (build 19045+) / Windows 11.", "none");
    if (!result.compatible)
      throw new LocalFailure(
        result.reasons.some((r) => r.includes("storage")) ? "disk_full" : "oom",
        result.reasons.join(" "),
        result.reasons.some((r) => r.includes("storage")) ? "free_disk" : "reduce_context",
      );
    const ctx = context ?? result.context.recommended;
    if (ctx > result.context.practicalMax)
      throw new LocalFailure(
        "oom",
        "This context would use too much memory. Choose a smaller context.",
        "reduce_context",
      );
    return {
      model,
      result,
      plan: {
        modelId: model.id,
        variantId: v.id,
        runtimeId: "ollama" as const,
        context: ctx,
        backend: device.os === "darwin" ? "metal" as const : "auto" as const,
        downloadBytes: v.bytes,
        memoryGB: v.weightGB + result.memory.runtime + kvMemory(v, ctx),
      },
    };
  }
  async stopOthers(modelId: string, confirmed = false) {
    const others = (await this.running()).filter((m: any) => m.modelId !== modelId);
    if (others.length && !confirmed)
      throw new LocalFailure(
        "busy",
        `Switch models to stop ${others.map((m: any) => m.tag).join(", ")} and free memory.`,
        "none",
      );
    for (const m of others) {
      if (!m.modelId)
        throw new LocalFailure(
          "busy",
          `Stop ${m.tag} in Ollama first. CanIRunAI only manages its registered models.`,
          "none",
        );
      await this.stop(m.modelId);
    }
  }
  async deploy(modelId: string, context?: number, confirmed = false) {
    if (this.busy || this.chatBusy)
      throw new LocalFailure("busy", "Wait for the current operation to finish.", "none");
    this.busy = true;
    try {
      const { plan } = await this.preflight(modelId, context);
      await this.stopOthers(modelId, confirmed);
      const d: Deployment = {
        id: randomUUID(),
        modelId,
        stage: "preparing",
        plan,
        download: { completed: 0, total: plan.downloadBytes, speed: 0, eta: null },
        logs: [],
        error: null,
        updatedAt: new Date().toISOString(),
      };
      this.deployments.unshift(d);
      this.deployments = this.deployments.slice(0, 40);
      await this.persist();
      void this.run(d);
      return d;
    } catch (e) {
      this.busy = false;
      throw e;
    }
  }
  async run(d: Deployment) {
    const controller = new AbortController();
    this.controllers.set(d.id, controller);
    try {
      await this.stage(d, "checking", "Checking memory, storage, runtime and model revision.");
      await this.preflight(d.modelId, d.plan.context);
      try {
        await this.runtimeStarter(this.dataDir);
      } catch {
        throw new LocalFailure(
          "runtime_missing",
          "Ollama could not start. Confirm installation of the verified runtime in CanIRunAI, or start your existing Ollama and retry.",
          "install_runtime",
        );
      }
      // Preflight cannot inspect the version of a stopped daemon.
      const rt = await this.checkRuntimeVersion(d.modelId);
      if (!rt.available)
        throw new LocalFailure("runtime_offline", "Ollama stopped responding. Start it and retry.");
      const model = getModel(d.modelId),
        v = model.variants.find((v) => v.id === d.plan.variantId)!;
      const tags = await ollama("/api/tags");
      const exists = tags.models.some((m: any) => m.name === v.tag && m.digest === v.digest);
      if (!exists) {
        await this.stage(
          d,
          "downloading",
          `Downloading ${v.tag} from registry.ollama.ai. Ollama resumes verified partial layers.`,
        );
        const resp = await fetch(OLLAMA + "/api/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: v.tag, stream: true }),
          signal: controller.signal,
        });
        if (!resp.ok)
          throw new LocalFailure("download_failed", "Could not reach the model download service.");
        const reader = resp.body!.getReader();
        let buffer = "",
          last = Date.now(),
          bytes = 0;
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.error) throw new LocalFailure("download_failed", event.error);
            if (event.digest === v.modelDigest && event.total) {
              d.download.completed = event.completed ?? 0;
              d.download.total = event.total;
              const now = Date.now();
              if (now - last > 750) {
                d.download.speed = Math.max(
                  0,
                  (d.download.completed - bytes) / ((now - last) / 1000),
                );
                d.download.eta = d.download.speed
                  ? Math.max(0, (event.total - d.download.completed) / d.download.speed)
                  : null;
                bytes = d.download.completed;
                last = now;
                await this.persist();
              }
            }
          }
        }
      }
      controller.signal.throwIfAborted();
      await this.stage(
        d,
        "verifying",
        "Verifying pinned manifest SHA-256 and runtime-verified model layers.",
      );
      const verifiedTags = await ollama("/api/tags");
      if (!verifiedTags.models.some((m: any) => m.name === v.tag && m.digest === v.digest))
        throw new LocalFailure(
          "model_corrupt",
          "The downloaded model does not match the pinned registry revision.",
          "none",
        );
      d.download.completed = d.download.total;
      await this.stage(d, "configuring", `Ollama · ${d.plan.backend === "metal" ? "Metal" : "automatic GPU/CPU"} · ${d.plan.context} context · local-only`);
      await this.preflight(d.modelId, d.plan.context);
      await this.stopOthers(d.modelId, false);
      await this.stage(d, "starting", "Loading the model into memory.");
      await ollama(
        "/api/generate",
        {
          model: v.tag,
          prompt: "",
          stream: false,
          keep_alive: "30m",
          options: { num_ctx: d.plan.context },
        },
        controller.signal,
      );
      await this.stage(d, "health_check", "Checking the running model.");
      if (!(await this.running()).some((r: any) => r.modelId === d.modelId))
        throw new LocalFailure("runtime_offline", "The model did not pass its health check.");
      await this.stage(d, "running", "Ready. Inference stays on this computer.");
    } catch (e) {
      if (controller.signal.aborted) {
        if (d.stage !== "cancelled")
          await this.stage(d, "paused", "Download paused. Verified partial files are retained.");
      } else {
        d.error =
          e instanceof LocalFailure
            ? { code: e.code, message: e.message, fix: e.fix }
            : {
                code: "unknown",
                message: e instanceof Error ? e.message : "Deployment failed",
                fix: "retry",
              };
        await this.stage(d, "failed", d.error.message);
      }
    } finally {
      this.controllers.delete(d.id);
      this.busy = false;
      await this.persist();
    }
  }
  async pause(id: string, cancel = false) {
    const d = this.find(id);
    if (!["downloading", "paused", "failed"].includes(d.stage))
      throw new LocalFailure("busy", "This operation cannot be paused right now.", "none");
    if (cancel) d.stage = "cancelled";
    this.controllers.get(id)?.abort();
    if (!this.controllers.has(id))
      await this.stage(
        d,
        cancel ? "cancelled" : "paused",
        cancel ? "Deployment cancelled." : "Download paused.",
      );
    return d;
  }
  find(id: string) {
    const d = this.deployments.find((d) => d.id === id);
    if (!d) throw new Error("Unknown deployment");
    return d;
  }
  async resume(id: string) {
    if (this.busy || this.chatBusy)
      throw new LocalFailure("busy", "Another operation is still finishing.", "none");
    const d = this.find(id);
    if (!["paused", "failed", "cancelled", "stopped"].includes(d.stage))
      throw new Error("Deployment is not resumable");
    this.busy = true;
    try {
      await this.stopOthers(d.modelId, false);
      await this.preflight(d.modelId, d.plan.context);
      d.error = null;
      void this.run(d);
      return d;
    } catch (e) {
      this.busy = false;
      throw e;
    }
  }
  async stop(id: string) {
    if (this.chatBusy)
      throw new LocalFailure("busy", "Finish or stop the current response first.", "none");
    const m = getModel(id);
    await ollama("/api/generate", { model: m.variants[0].tag, keep_alive: 0, stream: false });
    for (const d of this.deployments)
      if (d.modelId === id && d.stage === "running") d.stage = "stopped";
    await this.persist();
  }
  async remove(id: string) {
    if (this.busy || this.chatBusy)
      throw new LocalFailure("busy", "Wait for the current operation to finish.", "none");
    await this.stop(id);
    const m = getModel(id);
    const r = await fetch(OLLAMA + "/api/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m.variants[0].tag }),
    });
    if (!r.ok) throw new Error("Could not remove model");
    this.deployments = this.deployments.filter((d) => d.modelId !== id);
    await this.persist();
  }
  async install() {
    if (this.busy || this.chatBusy)
      throw new LocalFailure("busy", "Another operation is in progress.", "none");
    this.busy = true;
    try {
      const device = await this.device();
      if (!device.supported)
        throw new LocalFailure("unsupported", "运行环境安装仅支持 Apple Silicon Mac 或 x64 Windows 10（19045+）/ Windows 11。", "none");
      try {
        await this.runtimeStarter(this.dataDir);
        const existing = await runtimeStatus();
        if (existing.available) return existing;
      } catch {}
      const requiredBytes = runtimeInstallBytes(device.os, device.architecture);
      if (device.diskFreeGB * G < requiredBytes)
        throw new LocalFailure("disk_full", "Free storage for the runtime archive and extracted files before installing.", "free_disk");
      await installRuntime(this.dataDir);
      const installed = await runtimeStatus();
      if (!installed.available) throw new LocalFailure("runtime_offline", "安装后 Ollama 未就绪，请检查助手终端。", "none");
      return installed;
    } finally {
      this.busy = false;
    }
  }
  async benchmark(id: string) {
    if (this.busy || this.chatBusy)
      throw new LocalFailure("busy", "Another operation is in progress.", "none");
    if (!(await this.running()).some((r: any) => r.modelId === id))
      throw new LocalFailure("runtime_offline", "Start this model before benchmarking.");
    this.chatBusy = true;
    try {
      const model = getModel(id);
      const out = await ollama("/api/chat", {
        model: model.variants[0].tag,
        messages: [{ role: "user", content: "Count from 1 to 50, separated by commas." }],
        think: false,
        stream: false,
        options: { num_predict: 96, temperature: 0 },
      });
      const result = {
        modelId: id,
        tokens: out.eval_count,
        tokensPerSecond: out.eval_count / (out.eval_duration / 1e9),
        promptTokensPerSecond: out.prompt_eval_count / (out.prompt_eval_duration / 1e9),
        measuredAt: new Date().toISOString(),
        device: (this.hardware ?? (await this.device())).chip,
        runtime: (await runtimeStatus()).version,
      };
      this.benchmarks = this.benchmarks.filter((b) => b.modelId !== id).concat(result);
      await this.persist();
      return result;
    } finally {
      this.chatBusy = false;
    }
  }
}
