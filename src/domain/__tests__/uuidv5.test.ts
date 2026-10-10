import { sha1, uuidv5 } from '../uuidv5';

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
const bytes = (s: string) => [...Buffer.from(s, 'utf8')];

describe('sha1', () => {
  it('matches the standard test vectors', () => {
    expect(hex(sha1(bytes('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(bytes('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
    expect(hex(sha1(bytes('a'.repeat(1000))))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba');
  });
});

describe('uuidv5', () => {
  it('equals Postgres uuid_generate_v5', () => {
    // select extensions.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'hello');
    expect(uuidv5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'hello')).toBe(
      '074171de-bc84-5ea4-b636-1135477620e1',
    );
    // RFC 9562 appendix: DNS namespace, "www.example.com"
    expect(uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('handles non-ASCII names and rejects bad namespaces', () => {
    // UTF-8 encoded, like Postgres.
    expect(uuidv5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'किराया ₹')).toBe(
      '6e9ef4c4-a099-5610-866e-eac5d177b683',
    );
    expect(() => uuidv5('nope', 'x')).toThrow(RangeError);
  });
});
