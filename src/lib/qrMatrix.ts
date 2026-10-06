import createQrCode from 'qrcode-generator';

/** Blank border (in modules) required around a QR code for reliable scanning. */
export const QR_QUIET_ZONE = 4;

/** QR modules as rows of booleans (true = dark). Error correction M: good balance for screens. */
export function qrMatrix(text: string): boolean[][] {
  const qr = createQrCode(0, 'M'); // 0 = smallest version that fits
  qr.addData(text, 'Byte'); // UPI links are ASCII (pn/tn are sanitized + encoded)
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