import {
  MAX_CHAT_IMAGES,
  MAX_IMAGE_BYTES,
  ImageDataUrlSchema,
} from '../../../packages/protocol/index';
export type ChatImage = {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
};
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
};
export { MAX_CHAT_IMAGES };
export async function prepareImage(file: File): Promise<ChatImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
  if (file.size > 10 * 1024 * 1024)
    throw new Error(`「${file.name}」超过 10 MB，请缩小后再试。`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`无法读取「${file.name}」，请检查图片是否完整。`);
  }
  try {
    if (bitmap.width * bitmap.height > 32_000_000)
      throw new Error('图片像素过大，请先缩小到 3200 万像素以内。');
    const ratio = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height)),
      width = Math.max(1, Math.round(bitmap.width * ratio)),
      height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器暂不支持图片处理。');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if ((dataUrl.length * 3) / 4 > MAX_IMAGE_BYTES)
      dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    if ((dataUrl.length * 3) / 4 > MAX_IMAGE_BYTES)
      throw new Error('压缩后的图片仍过大，请使用尺寸更小的图片。');
    return {
      id: crypto.randomUUID(),
      name: file.name || '粘贴的图片',
      dataUrl,
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}
// Keep the newest four images in context; older pictures remain visible in history.
export function toWireMessages(messages: ChatMessage[]) {
  let remaining = MAX_CHAT_IMAGES;
  return messages
    .slice(-32)
    .map((m) => ({ ...m }))
    .reverse()
    .map((message) => {
      const images = message.images ?? [],
        kept = remaining ? images.slice(-remaining) : [];
      remaining -= kept.length;
      const text =
        message.content +
        (kept.length < images.length
          ? '\n[此轮较早的图片已不在当前视觉上下文中；如需再次查看，请重新发送。]'
          : '');
      return {
        role: message.role,
        content: kept.length
          ? [
              { type: 'text' as const, text },
              ...kept.map((image) => ({
                type: 'image_url' as const,
                image_url: { url: image.dataUrl },
              })),
            ]
          : text,
      };
    })
    .reverse();
}
export function readHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (m) =>
        m &&
        ['user', 'assistant'].includes(m.role) &&
        typeof m.content === 'string',
    )
    .map((m) => ({
      role: m.role,
      content: m.content,
      images:
        m.role === 'user' && Array.isArray(m.images)
          ? m.images
              .filter(
                (i: ChatImage) =>
                  i &&
                  typeof i.id === 'string' &&
                  typeof i.name === 'string' &&
                  ImageDataUrlSchema.safeParse(i.dataUrl).success,
              )
              .slice(0, MAX_CHAT_IMAGES)
          : undefined,
    }));
}
