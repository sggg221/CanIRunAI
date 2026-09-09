import { useState } from "react";
import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { Recommendation } from "../../../packages/protocol/index.ts";
import type { BridgeAction } from "./bridge";
import type { LocalBridge } from "./use-bridge";
import { fileSize } from "./catalog";
import LocalChat from "./LocalChat";

const stages: Record<string, string> = {
  preparing: "准备中",
  checking: "检测设备与环境",
  installing_runtime: "安装运行环境",
  downloading: "正在下载",
  verifying: "校验模型",
  configuring: "配置模型",
  starting: "启动模型",
  health_check: "检查运行状态",
  running: "部署完成",
  paused: "已暂停",
  failed: "需要处理",
  cancelled: "已取消",
  stopped: "已停止",
};
const activeStages = new Set([
  "preparing",
  "checking",
  "installing_runtime",
  "downloading",
  "verifying",
  "configuring",
  "starting",
  "health_check",
]);
export default function LocalWorkbench({
  bridge,
  onDeploy,
}: {
  bridge: LocalBridge;
  onDeploy: (entry: Recommendation) => void;
}) {
  const [chatId, setChatId] = useState("");
  const [error, setError] = useState("");
  const status = bridge.status;
  if (!status) return null;
  const known = status.recommendations;
  const running = status.running.filter(
    (m) => m.modelId && known.some((e) => e.model.id === m.modelId),
  );
  const activeChat = running.some((m) => m.modelId === chatId)
    ? chatId
    : (running[0]?.modelId ?? "");
  const uniqueJobs = status.deployments
    .filter(
      (d, index, all) =>
        all.findIndex((other) => other.modelId === d.modelId) === index,
    )
    .slice(0, 8);
  async function action(input: BridgeAction) {
    setError("");
    try {
      await bridge.action(input);
    } catch (error) {
      setError(error instanceof Error ? error.message : "操作失败");
    }
  }
  return (
    <section
      className="local-workbench container"
      id="local-workbench"
      aria-labelledby="workbench-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">REAL MODELS. REAL LOCAL INFERENCE.</p>
          <h2 id="workbench-title">你的本地 AI 工作台</h2>
          <p>状态来自本机助手。关闭网页不等于停止本机模型。</p>
        </div>
        <span className="local-badge">
          <Check size={14} />
          已连接本机
        </span>
      </div>
      {bridge.pending && (
        <p className="operation-progress" role="status">
          <LoaderCircle size={18} className="spin" />
          正在执行本机操作，请保持助手运行…
        </p>
      )}
      {error && (
        <p className="local-error" role="alert">
          {error}
        </p>
      )}
      {uniqueJobs.length > 0 && (
        <div className="deployment-list" aria-label="本机部署任务">
          {uniqueJobs.map((job) => {
            const progress =
              job.download.total > 0
                ? Math.min(
                    100,
                    (job.download.completed / job.download.total) * 100,
                  )
                : 0;
            const entry = known.find((e) => e.model.id === job.modelId);
            return (
              <article className="deployment-item" key={job.id}>
                <div className="deployment-title">
                  <strong>{entry?.model.name ?? job.modelId}</strong>
                  <span>
                    {activeStages.has(job.stage) && (
                      <LoaderCircle size={14} className="spin" />
                    )}
                    {stages[job.stage] ?? job.stage}
                  </span>
                </div>
                {job.stage === "downloading" && (
                  <>
                    <progress
                      max={100}
                      value={progress}
                      aria-label={`${entry?.model.name ?? job.modelId} 下载进度`}
                    />
                    <p className="download-numbers">
                      {fileSize(job.download.completed)} /{" "}
                      {fileSize(job.download.total)}
                      {job.download.speed > 0 &&
                        ` · ${fileSize(job.download.speed)}/s`}
                    </p>
                  </>
                )}
                {job.error && (
                  <p className="local-error">{job.error.message}</p>
                )}
                <div className="deployment-actions">
                  {job.stage === "downloading" && (
                    <button
                      disabled={bridge.pending}
                      onClick={() =>
                        void action({
                          action: "pause_download",
                          deployment_id: job.id,
                        })
                      }
                    >
                      <Pause size={13} />
                      暂停
                    </button>
                  )}
                  {job.stage === "paused" && (
                    <button
                      disabled={bridge.pending || status.busy}
                      onClick={() =>
                        void action({
                          action: "resume_download",
                          deployment_id: job.id,
                        })
                      }
                    >
                      <Play size={13} />
                      继续下载
                    </button>
                  )}
                  {job.stage === "failed" && entry && (
                    <button
                      disabled={bridge.pending || status.busy}
                      onClick={() => onDeploy(entry)}
                    >
                      <RefreshCw size={13} />
                      处理并重试
                    </button>
                  )}
                  {["downloading", "paused", "failed"].includes(job.stage) && (
                    <button
                      disabled={bridge.pending}
                      onClick={() =>
                        void action({
                          action: "cancel_deployment",
                          deployment_id: job.id,
                        })
                      }
                    >
                      <X size={13} />
                      取消任务
                    </button>
                  )}
                </div>
                <details className="deployment-logs">
                  <summary>查看真实任务日志</summary>
                  <pre>
                    {job.logs.join("\n") || "任务已创建，等待助手更新。"}
                  </pre>
                </details>
              </article>
            );
          })}
        </div>
      )}
      <h3 className="installed-heading">
        <Download size={17} />
        已安装模型 <span>{status.installed.length}</span>
      </h3>
      {!status.installed.length ? (
        <div className="local-empty">
          <p>本机暂未发现目录中已校验的模型。选择下方模型，点击“一键部署”。</p>
          <a className="text-link" href="#models">
            选择一个模型 <ArrowRight size={14} />
          </a>
        </div>
      ) : (
        <div className="installed-list">
          {status.installed.map((installed) => {
            const entry = known.find((e) => e.model.id === installed.modelId);
            const isRunning = running.some(
              (m) => m.modelId === installed.modelId,
            );
            return (
              <article key={installed.modelId}>
                <div>
                  <strong>{entry?.model.name ?? installed.modelId}</strong>
                  <p>
                    {fileSize(installed.bytes)} ·{" "}
                    {isRunning ? "运行中" : "已安装，未运行"}
                  </p>
                </div>
                <div className="installed-actions">
                  {isRunning ? (
                    <>
                      <button
                        disabled={bridge.pending}
                        onClick={() => {
                          setChatId(installed.modelId);
                          document
                            .getElementById("local-chat-area")
                            ?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        <MessageSquare size={14} />
                        聊天
                      </button>
                      <button
                        disabled={bridge.pending || status.busy}
                        onClick={() =>
                          void action({
                            action: "stop_model",
                            model_id: installed.modelId,
                          })
                        }
                      >
                        <Square size={13} />
                        停止
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={
                        !entry ||
                        bridge.pending ||
                        status.busy ||
                        !status.device.supported
                      }
                      onClick={() => entry && onDeploy(entry)}
                    >
                      <Play size={14} />
                      启动
                    </button>
                  )}
                  <button
                    aria-label={`删除 ${entry?.model.name ?? installed.modelId}`}
                    disabled={bridge.pending || status.busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除本机模型 ${entry?.model.name ?? installed.modelId}？这会删除 Ollama 管理的模型权重，其他使用该模型的程序也会受到影响。`,
                        )
                      )
                        void action({
                          action: "delete_model",
                          model_id: installed.modelId,
                        });
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {activeChat && (
        <div id="local-chat-area">
          {running.length > 1 && (
            <label className="chat-model-selector">
              聊天模型
              <select
                aria-label="聊天模型"
                value={activeChat}
                onChange={(e) => setChatId(e.target.value)}
                disabled={status.busy}
              >
                {running.map((m) => (
                  <option value={m.modelId!} key={m.modelId}>
                    {known.find((e) => e.model.id === m.modelId)?.model.name ??
                      m.tag}
                  </option>
                ))}
              </select>
            </label>
          )}
          <LocalChat bridge={bridge} modelId={activeChat} key={activeChat} />
        </div>
      )}
    </section>
  );
}
