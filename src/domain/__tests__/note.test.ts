import {
  isCanonicalNote,
  isReceiptId,
  MAX_NOTE_LENGTH,
  normalizeNote,
  receiptObjectPath,
} from '../note';

describe('notes', () => {
  it('normalises line breaks, control characters, blank runs and edges', () => {
    expect(normalizeNote('  Table 4\r\nincl. tip  ')).toEqual({ ok: true, note: 'Table 4\nincl. tip' });
    expect(normalizeNote('a\n\n\n\nb')).toEqual({ ok: true, note: 'a\n\nb' });
    expect(normalizeNote('bell\u0007 tab\tok')).toEqual({ ok: true, note: 'bell tab\tok' });
    expect(normalizeNote('   \n ')).toEqual({ ok: true, note: null });
    expect(normalizeNote(null)).toEqual({ ok: true, note: null });
    expect(normalizeNote('₹ बिल 🧾')).toEqual({ ok: true, note: '₹ बिल 🧾' });
  });

  it('limits the length', () => {
    expect(normalizeNote('x'.repeat(MAX_NOTE_LENGTH)).ok).toBe(true);
    expect(normalizeNote('x'.repeat(MAX_NOTE_LENGTH + 1))).toEqual({ ok: false, error: 'TOO_LONG' });
    // Trimmed before measuring.
    expect(normalizeNote(` ${'x'.repeat(MAX_NOTE_LENGTH)} `).ok).toBe(true);
  });

  it('accepts only canonical notes from the network', () => {
    expect(isCanonicalNote(null)).toBe(true);
    expect(isCanonicalNote('fine')).toBe(true);
    expect(isCanonicalNote(' padded')).toBe(false);
    expect(isCanonicalNote('')).toBe(false);
    expect(isCanonicalNote('a\r\nb')).toBe(false);
    expect(isCanonicalNote(42)).toBe(false);
  });
});

describe('receipt ids', () => {
  it('are lowercase UUIDs and name a storage path', () => {
    const id = '0192f0c4-7b1a-7c3e-8a10-2b3c4d5e6f70';
    expect(isReceiptId(id)).toBe(true);
    expect(isReceiptId(id.toUpperCase())).toBe(false);
    expect(isReceiptId('../../etc/passwd')).toBe(false);
    expect(receiptObjectPath('G-1', 'E-1', id)).toBe(`g-1/e-1/${id}.jpg`);
  });
});
