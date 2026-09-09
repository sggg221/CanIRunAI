import { readHistory, type ChatMessage } from './chat-images';
const revisions = new Map<string, number>();
let globalRevision = 0;
const DB = 'canirun-local-chats',
  STORE = 'conversations';
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function loadChat(modelId: string): Promise<ChatMessage[]> {
  if (localStorage.getItem('canirun-save-history') === 'false') return [];
  const db = await openDB();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(modelId);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return readHistory(
      value ??
        JSON.parse(localStorage.getItem('canirun-chat-' + modelId) ?? '[]'),
    );
  } finally {
    db.close();
  }
}
export async function saveChat(modelId: string, messages: ChatMessage[]) {
  const revision = revisions.get(modelId) ?? 0,
    global = globalRevision;
  const db = await openDB();
  try {
    if (global !== globalRevision || revision !== (revisions.get(modelId) ?? 0))
      return;
    if (localStorage.getItem('canirun-save-history') === 'false') return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(messages, modelId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    localStorage.removeItem('canirun-chat-' + modelId);
  } finally {
    db.close();
  }
}
export async function clearChat(modelId?: string) {
  if (modelId) revisions.set(modelId, (revisions.get(modelId) ?? 0) + 1);
  else globalRevision++;
  if (modelId) localStorage.removeItem('canirun-chat-' + modelId);
  else
    Object.keys(localStorage)
      .filter((k) => k.startsWith('canirun-chat-'))
      .forEach((k) => localStorage.removeItem(k));
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (modelId) tx.objectStore(STORE).delete(modelId);
      else tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
