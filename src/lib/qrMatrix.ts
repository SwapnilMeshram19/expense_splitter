import createQrCode from 'qrcode-generator';

/** Blank border (in modules) required around a QR code for reliable scanning. */
export const QR_QUIET_ZONE = 4;

/** UTF-8 bytes. The library's default keeps only the low byte of each character (Latin-1). */
export function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return bytes;
}

// ASCII payloads (UPI, EMV codes) encode the same either way; names in EPC codes ("Jürgen") need UTF-8.
// Set on the factory object on purpose: the library reads qrcode.stringToBytes from it when adding
// data (both its CommonJS and ES builds); the named export is only a copy.
// eslint-disable-next-line import/no-named-as-default-member
createQrCode.stringToBytes = utf8Bytes;

/** QR modules as rows of booleans (true = dark). Error correction M: good balance for screens. */
export function qrMatrix(text: string): boolean[][] {
  const qr = createQrCode(0, 'M'); // 0 = smallest version that fits
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

export interface Run {
  start: number;
  length: number;
}

/** Consecutive dark modules merged into runs: one View per run instead of per module. */
export function rowRuns(row: readonly boolean[]): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i <= row.length; i++) {
    const dark = i < row.length && row[i];
    if (dark && start < 0) start = i;
    else if (!dark && start >= 0) {
      runs.push({ start, length: i - start });
      start = -1;
    }
  }
  return runs;
}