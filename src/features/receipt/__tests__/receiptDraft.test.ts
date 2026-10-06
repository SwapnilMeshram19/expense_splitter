import { eq } from 'drizzle-orm';

import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { settings } from '@/db/schema';

import { EMPTY_RECEIPT, type ParsedReceipt } from '../parseReceipt';
import {
  analyzeReceiptDraft,
  clearReceiptDraft,
  draftFromParsed,
  getReceiptDraft,
  RECEIPT_DRAFT_KEY,
  saveReceiptDraft,
  type ReceiptDraft,
} from '../receiptDraft';

let n = 0;
const newId = () => `i${++n}`;

const parsed: ParsedReceipt = {
  merchant: 'Hotel Saffron',
  items: [
    { name: 'Paneer Tikka', amountPaise: 36000, quantity: 2 },
    { name: 'Chaas', amountPaise: 6000, quantity: null },
  ],
  charges: [{ label: 'GST 5%', amountPaise: 2100 }],
  subtotalPaise: 42000,
  totalPaise: null,
};

const assign = (draft: ReceiptDraft, ...memberIds: string[][]): ReceiptDraft => ({
  ...draft,
  items: draft.items.map((item, i) => ({ ...item, memberIds: memberIds[i] ?? [] })),
});

describe('draftFromParsed + analyzeReceiptDraft', () => {
  it('starts unassigned, with the total from sub-total + charges when no total was printed', () => {
    const draft = draftFromParsed(parsed, 'g1', newId, 1000);
    expect(draft.description).toBe('Hotel Saffron');
    expect(draft.items.map((i) => i.memberIds)).toEqual([[], []]);

    const analysis = analyzeReceiptDraft(draft);
    expect(analysis.totalPaise).toBe(44100);
    expect(analysis.unassignedCount).toBe(2);
    expect(analysis.problems).toEqual(['Choose who had 2 items.']);
    expect(analysis.splitInput).toBeNull();
  });

  it('splits by item and shares charges in proportion once everything is assigned', () => {
    const analysis = analyzeReceiptDraft(assign(draftFromParsed(parsed, 'g1', newId, 1000), ['a', 'b'], ['b']));
    expect(analysis.problems).toEqual([]);
    expect(analysis.differencePaise).toBe(2100);
    expect(analysis.differenceExplained).toBe(true);
    // a: 180 of 420 → 189.00; b: 240 of 420 → 252.00
    expect(Object.fromEntries(analysis.preview)).toEqual({ a: 18900, b: 25200 });
    expect(analysis.splitInput).toEqual({
      type: 'itemized',
      items: [
        { name: 'Paneer Tikka', amountPaise: 36000, memberIds: ['a', 'b'] },
        { name: 'Chaas', amountPaise: 6000, memberIds: ['b'] },
      ],
    });
  });

  it('flags a gap the parsed charges don’t explain (possibly a missed item)', () => {
    const draft = { ...assign(draftFromParsed(parsed, 'g1', newId, 1000), ['a'], ['b']), totalText: '500' };
    const analysis = analyzeReceiptDraft(draft);
    expect(analysis.differencePaise).toBe(8000);
    expect(analysis.differenceExplained).toBe(false);
    expect(analysis.problems).toEqual([]);
  });

  it('ignores blank rows and reports bad amounts', () => {
    const base = assign(draftFromParsed(parsed, 'g1', newId, 1000), ['a'], ['b']);
    const withBlank = { ...base, items: [...base.items, { id: 'x', name: '', amountText: '', quantity: null, memberIds: [] }] };
    expect(analyzeReceiptDraft(withBlank).problems).toEqual([]);

    const bad = { ...base, items: [{ ...base.items[0]!, amountText: 'abc' }, base.items[1]!] };
    expect(analyzeReceiptDraft(bad).problems[0]).toMatch(/Check the amount of “Paneer Tikka”/);
  });

  it('gives manual entry one blank item and no total', () => {
    const draft = draftFromParsed(EMPTY_RECEIPT, 'g1', newId, 1000);
    expect(draft.items).toHaveLength(1);
    expect(draft.description).toBe('Bill');
    expect(analyzeReceiptDraft(draft).problems).toEqual(['Add at least one item.', 'Enter the bill total.']);
  });
});

describe('draft storage', () => {
  let t: TestContext;

  beforeEach(() => {
    t = createTestContext();
  });

  afterEach(() => {
    t.close();
  });

  it('round-trips, clears, and ignores malformed data', () => {
    const draft = draftFromParsed(parsed, 'g1', newId, 1000);
    saveReceiptDraft(t.ctx, draft);
    expect(getReceiptDraft(t.ctx)).toEqual(draft);

    clearReceiptDraft(t.ctx);
    expect(getReceiptDraft(t.ctx)).toBeNull();

    t.ctx.db.insert(settings).values({ key: RECEIPT_DRAFT_KEY, value: '{"v":1,"items":"nope"}' }).run();
    expect(getReceiptDraft(t.ctx)).toBeNull();
    t.ctx.db.update(settings).set({ value: 'not json' }).where(eq(settings.key, RECEIPT_DRAFT_KEY)).run();
    expect(getReceiptDraft(t.ctx)).toBeNull();
  });
});