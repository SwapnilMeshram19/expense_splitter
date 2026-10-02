import {
  CHUNK_SIZE,
  MAX_CHUNKS,
  createChunkedStorage,
  splitIntoChunks,
  type SecureKeyValueStore,
} from '../chunkedStorage';

const KEY = 'sb-ref-auth-token';

function memoryStore() {
  const data = new Map<string, string>();
  const store: SecureKeyValueStore = {
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) => {
      if (v.length > CHUNK_SIZE) throw new Error('value over limit');
      data.set(k, v);
    },
    deleteItemAsync: async (k) => {
      data.delete(k);
    },
  };
  return { data, storage: createChunkedStorage(store) };
}

describe('splitIntoChunks', () => {
  it('never splits a surrogate pair', () => {
    const value = 'a'.repeat(CHUNK_SIZE - 1) + '😀' + 'b';
    const chunks = splitIntoChunks(value);

    expect(chunks.join('')).toBe(value);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE - 1);
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it('returns one empty chunk for an empty string', () => {
    expect(splitIntoChunks('')).toEqual(['']);
  });
});

describe('createChunkedStorage', () => {
  it('round-trips a value larger than one chunk', async () => {
    const { data, storage } = memoryStore();
    const value = 'x'.repeat(CHUNK_SIZE * 4 + 17);

    await storage.setItem(KEY, value);

    expect(data.get(`${KEY}.count`)).toBe('5');
    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('round-trips non-ASCII text', async () => {
    const { storage } = memoryStore();
    const value = JSON.stringify({ name: 'स्वप्निल 😀 Meshram', pad: 'y'.repeat(1500) });

    await storage.setItem(KEY, value);

    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('deletes leftover chunks when a value shrinks', async () => {
    const { data, storage } = memoryStore();
    await storage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * 5));
    await storage.setItem(KEY, 'short');

    expect(await storage.getItem(KEY)).toBe('short');
    for (let i = 1; i < 5; i++) expect(data.has(`${KEY}.${i}`)).toBe(false);
  });

  it('reads a torn write as no value', async () => {
    const { data, storage } = memoryStore();
    await storage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * 3));
    data.delete(`${KEY}.1`);

    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('reads as no value when the underlying store throws', async () => {
    const storage = createChunkedStorage({
      getItemAsync: async () => {
        throw new Error('keystore unavailable');
      },
      setItemAsync: async () => undefined,
      deleteItemAsync: async () => undefined,
    });

    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('removes every chunk', async () => {
    const { data, storage } = memoryStore();
    await storage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * 3));
    await storage.removeItem(KEY);

    expect(data.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('round-trips an empty string', async () => {
    const { storage } = memoryStore();
    await storage.setItem(KEY, '');

    expect(await storage.getItem(KEY)).toBe('');
  });

  it('rejects oversized values and keeps the previous one', async () => {
    const { storage } = memoryStore();
    await storage.setItem(KEY, 'previous');

    await expect(storage.setItem(KEY, 'x'.repeat(CHUNK_SIZE * (MAX_CHUNKS + 1)))).rejects.toThrow();
    expect(await storage.getItem(KEY)).toBe('previous');
  });
});