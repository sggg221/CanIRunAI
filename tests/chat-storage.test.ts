import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { saveChat, loadChat, clearChat } from "../apps/web/lib/chat-storage.ts";
import type { ChatMessage } from "../apps/web/lib/chat-images.ts";
const storage: Record<string, any> = {};
Object.defineProperties(storage, {
  getItem: { value: (key: string) => storage[key] ?? null },
  setItem: {
    value: (key: string, value: string) => {
      storage[key] = value;
    },
  },
  removeItem: {
    value: (key: string) => {
      delete storage[key];
    },
  },
});
Object.defineProperty(globalThis, "localStorage", { value: storage });
const messages: ChatMessage[] = [
  {
    role: "user",
    content: "看一下",
    images: [
      {
        id: "1",
        name: "图片.png",
        width: 1,
        height: 1,
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=",
      },
    ],
  },
  { role: "assistant", content: "好的" },
];
test("image conversations persist by model and legacy text chats migrate without losing data", async () => {
  storage.setItem("canirun-save-history", "true");
  storage.setItem("canirun-chat-old", JSON.stringify([{ role: "user", content: "原有文字" }]));
  assert.equal((await loadChat("old"))[0].content, "原有文字");
  await saveChat("vision", messages);
  assert.equal((await loadChat("vision"))[0].images?.[0].dataUrl, messages[0].images?.[0].dataUrl);
  assert.equal((await loadChat("other")).length, 0);
  await clearChat("vision");
  assert.equal((await loadChat("vision")).length, 0);
  assert.equal((await loadChat("old"))[0].content, "原有文字");
});
test("disabling history clears pictures and prevents pending writes from restoring them", async () => {
  storage.setItem("canirun-save-history", "true");
  const pending = saveChat("vision", messages);
  storage.setItem("canirun-save-history", "false");
  await clearChat();
  await pending;
  storage.setItem("canirun-save-history", "true");
  assert.equal((await loadChat("vision")).length, 0);
  assert.equal((await loadChat("old")).length, 0);
});
test("clearing a conversation wins over an outstanding image save", async () => {
  const pending = saveChat("race", messages);
  await clearChat("race");
  await pending;
  assert.equal((await loadChat("race")).length, 0);
});
