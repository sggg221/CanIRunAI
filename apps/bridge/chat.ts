import { MAX_IMAGE_BYTES, type ChatInput, type Model } from "../../packages/protocol/index.ts";
export function decodeImage(dataUrl: string): string {
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("图片格式无效。");
  const [, format, base64] = match,
    bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== base64)
    throw new Error("图片数据无效或超过 2 MB。");
  const valid =
    format === "png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : format === "jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new Error("图片内容与格式不符，请重新选择有效图片。");
  return base64;
}
export function toOllamaMessages(input: ChatInput, model: Model) {
  return input.messages.map((message) => {
    if (typeof message.content === "string") return message;
    const images = message.content.filter((part) => part.type === "image_url");
    if (images.length && !model.capabilities.includes("vision"))
      throw new Error("当前模型不支持图片，请切换到支持视觉的模型（例如 Gemma 3）。");
    return {
      role: message.role,
      content: message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
      ...(images.length ? { images: images.map((part) => decodeImage(part.image_url.url)) } : {}),
    };
  });
}
