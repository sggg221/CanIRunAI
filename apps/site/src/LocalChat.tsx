import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  ImagePlus,
  LoaderCircle,
  MessageSquare,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  prepareImage,
  toWireMessages,
  MAX_CHAT_IMAGES,
  type ChatImage,
  type ChatMessage,
} from "../../web/lib/chat-images";
import type { LocalBridge } from "./use-bridge";

export default function LocalChat({
  bridge,
  modelId,
}: {
  bridge: LocalBridge;
  modelId: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [input, setInput] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]),
    [streaming, setStreaming] = useState(false),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    imageLock = useRef(false),
    fileInput = useRef<HTMLInputElement>(null),
    mounted = useRef(true);
  const model = bridge.status?.recommendations.find(
    (e) => e.model.id === modelId,
  )?.model;
  const running = bridge.status?.running.some((m) => m.modelId === modelId);
  const ready = !!running && bridge.phase === "connected";
  const supportsVision = !!model?.capabilities.includes("vision");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!ready) controller.current?.abort();
  }, [ready]);
  async function attach(files: File[]) {
    if (!ready || streaming || imageLock.current || !files.length) return;
    if (!supportsVision) {
      setError("当前模型只支持文字，请先部署并选择视觉模型。");
      return;
    }
    if (images.length + files.length > MAX_CHAT_IMAGES) {
      setError("每次最多附带 4 张图片。");
      return;
    }
    imageLock.current = true;
    setPreparing(true);
    setError("");
    try {
      const prepared: ChatImage[] = [];
      for (const file of files) prepared.push(await prepareImage(file));
      if (mounted.current) setImages((current) => [...current, ...prepared]);
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : "无法处理图片");
    } finally {
      imageLock.current = false;
      if (mounted.current) setPreparing(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      !ready ||
      streaming ||
      imageLock.current ||
      bridge.pending ||
      bridge.status?.busy ||
      (!input.trim() && !images.length)
    )
      return;
    const conversation: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: input.trim() || "请描述这些图片。",
        ...(images.length ? { images } : {}),
      },
    ];
    setMessages([...conversation, { role: "assistant", content: "" }]);
    setInput("");
    setImages([]);
    setError("");
    setStreaming(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      await bridge.client.chat(
        {
          model: modelId,
          messages: toWireMessages(conversation),
          stream: true,
          max_tokens: 768,
          temperature: 0.7,
        },
        abort.signal,
        (answer) => {
          if (mounted.current)
            setMessages([
              ...conversation,
              { role: "assistant", content: answer },
            ]);
        },
      );
    } catch (error) {
      if (mounted.current && !abort.signal.aborted)
        setError(error instanceof Error ? error.message : "本地推理失败");
    } finally {
      controller.current = null;
      if (mounted.current) {
        setStreaming(false);
        void bridge.refresh();
      }
    }
  }
  return (
    <section className="local-chat" aria-labelledby="chat-title">
      <div className="local-chat-heading">
        <div>
          <h3 id="chat-title">
            <MessageSquare size={19} />与 {model?.name ?? modelId} 对话
          </h3>
          <p>
            真实本机推理 · 不发送到网站服务器 · 记录仅在当前页面，刷新后清空
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="清空本页聊天"
          disabled={streaming || preparing}
          onClick={() => {
            setMessages([]);
            setImages([]);
            setError("");
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
      <div
        className="chat-history"
        role="log"
        aria-live="polite"
        aria-label="本地聊天记录"
      >
        {!messages.length && (
          <p className="chat-empty">
            模型已就绪。问一个问题，开始本地对话。
            {supportsVision && "也可以上传或粘贴图片。"}
          </p>
        )}
        {messages.map((message, i) => (
          <div className={`chat-message ${message.role}`} key={i}>
            <strong>
              {message.role === "user" ? "你" : (model?.name ?? "AI")}
            </strong>
            {message.images?.map((image) => (
              <img
                className="chat-picture"
                key={image.id}
                src={image.dataUrl}
                alt={image.name}
              />
            ))}
            <p>
              {message.content ||
                (streaming && i === messages.length - 1
                  ? "正在思考…"
                  : "（本次回答未生成文字）")}
            </p>
          </div>
        ))}
      </div>
      {error && (
        <p className="local-error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={send}
        className="chat-composer"
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length) {
            event.preventDefault();
            void attach(files);
          }
        }}
      >
        {images.length > 0 && (
          <div className="chat-attachments">
            {images.map((image) => (
              <div key={image.id}>
                <img src={image.dataUrl} alt={image.name} />
                <button
                  type="button"
                  disabled={streaming || preparing}
                  onClick={() =>
                    setImages((current) =>
                      current.filter((i) => i.id !== image.id),
                    )
                  }
                  aria-label={`移除图片 ${image.name}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          aria-label="聊天消息"
          placeholder={ready ? "发送消息给本机模型…" : "请先连接并启动此模型"}
          maxLength={32000}
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!ready || streaming}
        />
        <div className="composer-actions">
          <div>
            <input
              hidden
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => {
                void attach(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              className="text-link attach-button"
              type="button"
              disabled={!ready || !supportsVision || streaming || preparing}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus size={17} />
              {supportsVision ? "添加图片" : "此模型仅支持文字"}
            </button>
            {preparing && (
              <span role="status">
                <LoaderCircle size={14} className="spin" />
                正在处理图片
              </span>
            )}
          </div>
          {streaming ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => controller.current?.abort()}
            >
              <Square size={14} />
              停止生成
            </button>
          ) : (
            <button
              className="button primary"
              type="submit"
              disabled={
                !ready ||
                preparing ||
                bridge.pending ||
                bridge.status?.busy ||
                (!input.trim() && !images.length)
              }
            >
              发送
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
