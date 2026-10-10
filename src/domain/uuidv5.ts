/**
 * UUIDv5 (RFC 9562, SHA-1 name-based), byte-for-byte equal to Postgres's
 * extensions.uuid_generate_v5(namespace, name). Pure TypeScript, no crypto API (Hermes + Deno).
 * Used for ids that two phones and the server must derive independently (recurring occurrences).
 */

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return out;
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

/** SHA-1 digest (20 bytes). Not for security: only for deterministic ids. */
export function sha1(bytes: readonly number[]): number[] {
  const message = [...bytes, 0x80];
  while (message.length % 64 !== 56) message.push(0);
  const bitLength = bytes.length * 8;
  for (let i = 7; i >= 0; i--) message.push(Math.floor(bitLength / 2 ** (i * 8)) & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] =
        (message[j]! << 24) | (message[j + 1]! << 16) | (message[j + 2]! << 8) | message[j + 3]!;
    }
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out: number[] = [];
  for (const h of [h0, h1, h2, h3, h4])
    out.push((h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255);
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidv5(namespace: string, name: string): string {
  if (!UUID.test(namespace)) throw new RangeError(`Invalid namespace: ${namespace}`);
  const ns = namespace
    .replace(/-/g, '')
    .match(/../g)!
    .map((h) => parseInt(h, 16));
  const hash = sha1([...ns, ...utf8(name)]).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC variant
  const hex = hash.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
