/**
 * Stores values larger than a secure store's per-value limit by splitting them across keys:
 *   <key>.count = number of chunks, <key>.0 … <key>.N-1 = the chunks.
 *
 * Write order makes torn writes safe: the count is deleted first and written last, so a crash
 * mid-write reads back as "no value" (signed out), never as a spliced session.
 */

export interface SecureKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Shape supabase-js accepts as `auth.storage`. */
export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * UTF-16 code units per chunk. Worst case is 3 UTF-8 bytes per unit (BMP, e.g. Devanagari),
 * so 600 units ≤ 1800 bytes — under expo-secure-store's 2048-byte value limit.
 */
export const CHUNK_SIZE = 600;
export const MAX_CHUNKS = 64;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Split without breaking surrogate pairs: a lone surrogate can't be UTF-8 encoded. */
export function splitIntoChunks(value: string, size: number = CHUNK_SIZE): string[] {
  if (size < 2) throw new Error('chunk size must be at least 2');
  if (value.length === 0) return [''];

  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + size, value.length);
    if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Secure-store keys allow only [A-Za-z0-9._-]. */
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export function createChunkedStorage(store: SecureKeyValueStore): AsyncKeyValueStorage {
  const countKey = (key: string) => `${safeKey(key)}.count`;
  const chunkKey = (key: string, index: number) => `${safeKey(key)}.${index}`;

  async function readCount(key: string): Promise<number> {
    const raw = await store.getItemAsync(countKey(key));
    if (raw === null) return 0;
    const count = Number(raw);
    return Number.isInteger(count) && count > 0 && count <= MAX_CHUNKS ? count : 0;
  }

  return {
    async getItem(key) {
      try {
        const count = await readCount(key);
        if (count === 0) return null;
        const parts: string[] = [];
        for (let i = 0; i < count; i++) {
          const part = await store.getItemAsync(chunkKey(key, i));
          if (part === null) return null; // torn write
          parts.push(part);
        }
        return parts.join('');
      } catch {
        // Keystore entries can become unreadable (e.g. after an OS restore): treat as signed out.
        return null;
      }
    },

    async setItem(key, value) {
      const chunks = splitIntoChunks(value);
      if (chunks.length > MAX_CHUNKS) throw new Error('value too large for secure storage');

      const previous = await readCount(key);
      await store.deleteItemAsync(countKey(key));
      for (let i = 0; i < chunks.length; i++) {
        await store.setItemAsync(chunkKey(key, i), chunks[i]!);
      }
      for (let i = chunks.length; i < previous; i++) {
        await store.deleteItemAsync(chunkKey(key, i));
      }
      await store.setItemAsync(countKey(key), String(chunks.length));
    },

    async removeItem(key) {
      const count = await readCount(key);
      await store.deleteItemAsync(countKey(key));
      for (let i = 0; i < count; i++) {
        await store.deleteItemAsync(chunkKey(key, i));
      }
    },
  };
}