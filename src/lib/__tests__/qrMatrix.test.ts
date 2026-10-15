import { buildUpiPayUri } from '@/domain/upi';

import { qrMatrix, rowRuns, utf8Bytes } from '../qrMatrix';

describe('qrMatrix', () => {
  const uri = buildUpiPayUri({ payeeVpa: 'rahul.k@okaxis', payeeName: 'Rahul K', amountPaise: 30050, note: 'Goa trip' });

  it('produces a square matrix of a valid QR size', () => {
    const m = qrMatrix(uri);
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect((m.length - 17) % 4).toBe(0);
    expect(m.every((row) => row.length === m.length)).toBe(true);
  });

  it('has the three finder patterns', () => {
    const m = qrMatrix(uri);
    const n = m.length;
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      for (let i = 0; i < 7; i++) {
        expect(m[r0]![c0 + i]).toBe(true); // top edge
        expect(m[r0 + 6]![c0 + i]).toBe(true); // bottom edge
      }
      expect(m[r0 + 1]![c0 + 1]).toBe(false); // light ring
      expect(m[r0 + 3]![c0 + 3]).toBe(true); // centre
    }
  });

  it('is deterministic and grows with the content', () => {
    expect(qrMatrix(uri)).toEqual(qrMatrix(uri));
    expect(qrMatrix(`${uri}&tn=${'x'.repeat(100)}`).length).toBeGreaterThan(qrMatrix(uri).length);
  });
});

describe('rowRuns', () => {
  it('merges consecutive dark modules', () => {
    expect(rowRuns([true, true, false, true, false, false, true, true, true])).toEqual([
      { start: 0, length: 2 },
      { start: 3, length: 1 },
      { start: 6, length: 3 },
    ]);
    expect(rowRuns([false, false])).toEqual([]);
    expect(rowRuns([])).toEqual([]);
  });
});
describe('utf8Bytes', () => {
  it('matches Node’s UTF-8 encoder (names in EPC QR codes)', () => {
    for (const text of ['upi://pay?pa=a@b', 'Jürgen Müller', '₹ 1,000', 'José 🙂']) {
      expect(utf8Bytes(text)).toEqual([...Buffer.from(text, 'utf8')]);
    }
  });
});

describe('UTF-8 in QR codes', () => {
  it('needs more room for accented names, as UTF-8 does (2 bytes each)', () => {
    // 60 ASCII letters fit a smaller code than 60 "é", which are 120 bytes in UTF-8 (60 in Latin-1).
    expect(qrMatrix('é'.repeat(60)).length).toBeGreaterThan(qrMatrix('e'.repeat(60)).length);
  });
});
