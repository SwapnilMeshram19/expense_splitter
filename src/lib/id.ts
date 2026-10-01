/**
 * UUIDv7 (RFC 9562): 48-bit Unix-ms timestamp + 74 random bits.
 * Time-ordered ids: sort by creation time and keep B-tree inserts append-mostly.
 * Randomness is injected so this stays pure and testable; the app wires in expo-crypto.
 * Note: ids created within the same millisecond are not ordered among themselves.
 */
export type RandomBytes = (length: number) => Uint8Array;

const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

export function uuidv7(randomBytes: RandomBytes, nowMs: number = Date.now()): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > MAX_TIMESTAMP_MS) {
    throw new RangeError(`Invalid timestamp: ${nowMs}`);
  }
  const random = randomBytes(10);
  if (random.length !== 10) throw new RangeError('randomBytes must return 10 bytes');

  const bytes = new Uint8Array(16);
  let ts = nowMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes.set(random, 6);
  bytes[6] = (random[0]! & 0x0f) | 0x70; // version 7
  bytes[8] = (random[2]! & 0x3f) | 0x80; // RFC 4122 variant (10xx)

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extract the creation timestamp (ms) from a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}