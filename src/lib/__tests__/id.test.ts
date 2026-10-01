import { uuidv7, uuidv7Timestamp } from '../id';

const fixedRandom = (fill: number) => () => new Uint8Array(10).fill(fill);

describe('uuidv7', () => {
  it('produces a valid v7 UUID string', () => {
    const id = uuidv7(fixedRandom(0xff), 1_700_000_000_000);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const now = 1_727_740_800_123;
    expect(uuidv7Timestamp(uuidv7(fixedRandom(0), now))).toBe(now);
  });

  it('sorts by creation time across milliseconds', () => {
    const earlier = uuidv7(fixedRandom(0xff), 1_000);
    const later = uuidv7(fixedRandom(0x00), 1_001);
    expect(earlier < later).toBe(true);
  });

  it('rejects invalid timestamps and wrong random length', () => {
    expect(() => uuidv7(fixedRandom(0), -1)).toThrow(RangeError);
    expect(() => uuidv7(fixedRandom(0), 1.5)).toThrow(RangeError);
    expect(() => uuidv7(fixedRandom(0), 2 ** 48)).toThrow(RangeError);
    expect(() => uuidv7(() => new Uint8Array(9), 1)).toThrow(RangeError);
  });
});