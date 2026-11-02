import {
  ALL_WEEKDAYS,
  billableMonths,
  billLines,
  checkMark,
  checkService,
  computeBill,
  dayState,
  formatQty,
  formatQtyWithUnit,
  markId,
  monthEnd,
  usualQty,
  withPriceFrom,
  withStartDate,
  type ServiceFields,
} from '../household';
import type { HouseholdService } from '../model';

const G = '90000000-0000-4000-8000-000000000001';
const SVC = '70000000-0000-4000-8000-000000000001';

function service(over: Partial<HouseholdService> = {}): HouseholdService {
  return {
    id: SVC,
    groupId: G,
    name: 'Milk',
    kind: 'per_unit',
    unit: 'L',
    defaultQty: 100,
    rates: [{ from: '2026-10-01', ratePaise: 3000 }],
    weekdays: ALL_WEEKDAYS,
    paidLeaves: 0,
    startDate: '2026-10-01',
    endDate: null,
    bills: {},
    createdByMemberId: 'b0000000-0000-4000-8000-000000000001',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    version: 1,
    ...over,
  };
}

const marks = (entries: [string, number][]) => new Map(entries);

describe('computeBill: per unit', () => {
  it('counts the usual quantity every day of a complete month', () => {
    const bill = computeBill(service(), marks([]), '2026-10');
    expect(bill.amountPaise).toBe(31 * 3000);
    expect(bill.lines).toEqual([{ ratePaise: 3000, quantity: 3100, amountPaise: 93_000 }]);
    expect(bill.complete).toBe(true);
  });

  it('applies absences, extra milk and half litres', () => {
    const bill = computeBill(
      service(),
      marks([
        ['2026-10-02', 0],
        ['2026-10-03', 0],
        ['2026-10-10', 250],
        ['2026-10-11', 50],
      ]),
      '2026-10',
    );
    // 27 usual days + 2.5 + 0.5 = 30 L
    expect(bill.lines[0]!.quantity).toBe(3000);
    expect(bill.amountPaise).toBe(90_000);
    expect(bill.absentDays).toBe(2);
    expect(bill.changedDays).toBe(2);
  });

  it('prices each day at the rate in force that day, rounding once per rate', () => {
    const s = service({
      rates: [
        { from: '2026-10-01', ratePaise: 3000 },
        { from: '2026-10-15', ratePaise: 3250 },
      ],
      defaultQty: 50, // half a litre a day
    });
    const bill = computeBill(s, marks([]), '2026-10');
    expect(bill.lines).toEqual([
      { ratePaise: 3000, quantity: 700, amountPaise: 21_000 },
      { ratePaise: 3250, quantity: 850, amountPaise: 27_625 },
    ]);
    expect(bill.amountPaise).toBe(48_625);
  });

  it('rounds half up to the paisa', () => {
    // 0.5 L at ₹30.01 = 1500.5 paise → 1501
    const s = service({
      rates: [{ from: '2026-10-01', ratePaise: 3001 }],
      defaultQty: 50,
      startDate: '2026-10-01',
      endDate: '2026-10-01',
    });
    expect(computeBill(s, marks([]), '2026-10').amountPaise).toBe(1501);
  });

  it('counts only up to the given day, and only scheduled weekdays as usual', () => {
    // Newspaper Mon–Sat; 1–4 Oct 2026 = Thu, Fri, Sat, Sun.
    const s = service({
      unit: 'paper',
      weekdays: ALL_WEEKDAYS & ~1,
      rates: [{ from: '2026-10-01', ratePaise: 500 }],
    });
    const bill = computeBill(s, marks([['2026-10-04', 100]]), '2026-10', '2026-10-04');
    expect(bill.upTo).toBe('2026-10-04');
    expect(bill.complete).toBe(false);
    // 3 usual papers + 1 on the Sunday it was marked
    expect(bill.amountPaise).toBe(2000);
  });

  it('ignores days before the start and after the end', () => {
    const s = service({
      startDate: '2026-10-11',
      endDate: '2026-10-20',
      rates: [{ from: '2026-10-11', ratePaise: 3000 }],
    });
    const bill = computeBill(
      s,
      marks([
        ['2026-10-05', 300],
        ['2026-10-25', 300],
      ]),
      '2026-10',
    );
    expect(bill.amountPaise).toBe(10 * 3000);
  });
});

describe('computeBill: monthly', () => {
  const maid = (over: Partial<HouseholdService> = {}) =>
    service({
      name: 'Maid',
      kind: 'monthly',
      unit: null,
      rates: [{ from: '2026-10-01', ratePaise: 300_000 }],
      paidLeaves: 2,
      ...over,
    });

  it('pays the full fee with absences inside the paid leaves', () => {
    const bill = computeBill(
      maid(),
      marks([
        ['2026-10-05', 0],
        ['2026-10-06', 0],
      ]),
      '2026-10',
    );
    expect(bill.amountPaise).toBe(300_000);
    expect(bill.freeLeaves).toBe(2);
    expect(bill.deductedDays).toBe(0);
  });

  it('cuts absences beyond the paid leaves pro rata', () => {
    const bill = computeBill(
      maid(),
      marks([
        ['2026-10-05', 0],
        ['2026-10-06', 0],
        ['2026-10-07', 0],
      ]),
      '2026-10',
    );
    // 30 of 31 days: 3000 × 30 / 31 = 2903.2258 → ₹2,903.23
    expect(bill.deductedDays).toBe(1);
    expect(bill.amountPaise).toBe(290_323);
  });

  it('spreads the fee over working days only (Sundays off)', () => {
    // Oct 2026 has 4 Sundays: 27 working days. One deducted absence.
    const s = maid({ weekdays: ALL_WEEKDAYS & ~1, paidLeaves: 0 });
    const bill = computeBill(
      s,
      marks([
        ['2026-10-05', 0],
        ['2026-10-04', 0],
      ]),
      '2026-10',
    );
    expect(bill.workingDays).toBe(27);
    // The Sunday mark doesn't count: one absence.
    expect(bill.absentDays).toBe(1);
    expect(bill.amountPaise).toBe(Math.round((300_000 * 26) / 27));
  });

  it('is pro rata for a mid-month start', () => {
    const s = maid({
      startDate: '2026-10-17',
      rates: [{ from: '2026-10-17', ratePaise: 310_000 }],
    });
    const bill = computeBill(s, marks([]), '2026-10');
    expect(bill.lines).toEqual([{ ratePaise: 310_000, quantity: 15, amountPaise: 150_000 }]);
  });

  it('is 0 in a month without working days', () => {
    const s = maid({ weekdays: 0 });
    expect(computeBill(s, marks([]), '2026-10').amountPaise).toBe(0);
  });
});

describe('days', () => {
  it('describes calendar states', () => {
    const s = service({ weekdays: ALL_WEEKDAYS & ~1 });
    expect(dayState(s, '2026-10-05', undefined)).toBe('usual');
    expect(dayState(s, '2026-10-04', undefined)).toBe('off'); // Sunday
    expect(dayState(s, '2026-10-04', 100)).toBe('more');
    expect(dayState(s, '2026-10-05', 0)).toBe('absent');
    expect(dayState(s, '2026-10-05', 50)).toBe('less');
    expect(usualQty(s, '2026-09-30')).toBe(0); // before the start
  });

  it('derives the same mark id for the same day', () => {
    expect(markId(SVC, '2026-10-05')).toBe(markId(SVC.toUpperCase(), '2026-10-05'));
    expect(markId(SVC, '2026-10-05')).not.toBe(markId(SVC, '2026-10-06'));
  });
});

describe('checkMark', () => {
  const today = '2026-10-20';

  it('stores the usual quantity as "usual"', () => {
    expect(checkMark(service(), '2026-10-05', 100, today)).toEqual({ ok: true, qty: null });
    expect(checkMark(service(), '2026-10-05', 0, today)).toEqual({ ok: true, qty: 0 });
  });

  it('refuses odd steps, days outside the service and far dates', () => {
    expect(checkMark(service(), '2026-10-05', 125, today)).toEqual({
      ok: false,
      error: { code: 'INVALID_QTY' },
    });
    expect(checkMark(service({ unit: 'can' }), '2026-10-05', 50, today).ok).toBe(false);
    expect(checkMark(service(), '2026-09-30', 0, today)).toEqual({
      ok: false,
      error: { code: 'OUT_OF_RANGE' },
    });
    expect(checkMark(service(), '2027-01-01', 0, today).ok).toBe(false);
  });

  it('only takes present/absent on working days for monthly services', () => {
    const maid = service({ kind: 'monthly', unit: null, weekdays: ALL_WEEKDAYS & ~1 });
    expect(checkMark(maid, '2026-10-05', 0, today)).toEqual({ ok: true, qty: 0 });
    expect(checkMark(maid, '2026-10-05', 200, today).ok).toBe(false);
    expect(checkMark(maid, '2026-10-04', 0, today)).toEqual({
      ok: false,
      error: { code: 'NOT_SCHEDULED' },
    });
  });
});

describe('checkService', () => {
  const fields = (over: Partial<ServiceFields> = {}): ServiceFields => ({
    name: '  Milk  ',
    kind: 'per_unit',
    unit: 'L',
    defaultQty: 100,
    rates: [{ from: '2026-10-01', ratePaise: 3000 }],
    weekdays: ALL_WEEKDAYS,
    paidLeaves: 3,
    startDate: '2026-10-01',
    endDate: null,
    ...over,
  });

  it('normalizes the name and clears fields the kind doesn’t use', () => {
    const r = checkService(fields(), [], 1e12);
    expect(r).toMatchObject({ ok: true, row: { name: 'Milk', paidLeaves: 0 } });
    const maid = checkService(fields({ kind: 'monthly', unit: 'L', defaultQty: 250 }), [], 1e12);
    expect(maid).toMatchObject({ ok: true, row: { unit: null, defaultQty: 100, paidLeaves: 3 } });
  });

  it('refuses duplicates and bad values', () => {
    expect(checkService(fields(), ['milk'], 1e12)).toEqual({
      ok: false,
      error: { code: 'DUPLICATE_NAME', name: 'Milk' },
    });
    expect(checkService(fields({ weekdays: 0 }), [], 1e12).ok).toBe(false);
    expect(checkService(fields({ rates: [] }), [], 1e12).ok).toBe(false);
    expect(
      checkService(fields({ rates: [{ from: '2026-10-05', ratePaise: 3000 }] }), [], 1e12),
    ).toEqual({
      ok: false,
      error: { code: 'INVALID_RATES' },
    });
    expect(
      checkService(fields({ rates: [{ from: '2026-10-01', ratePaise: 0 }] }), [], 1e12).ok,
    ).toBe(false);
    expect(checkService(fields({ endDate: '2026-09-01' }), [], 1e12).ok).toBe(false);
    expect(checkService(fields({ unit: 'litre' as never }), [], 1e12)).toEqual({
      ok: false,
      error: { code: 'INVALID_UNIT' },
    });
  });

  it('drops a repeated price from the history', () => {
    const r = checkService(
      fields({
        rates: [
          { from: '2026-10-01', ratePaise: 3000 },
          { from: '2026-10-10', ratePaise: 3000 },
        ],
      }),
      [],
      1e12,
    );
    expect(r.ok && r.row.rates).toEqual([{ from: '2026-10-01', ratePaise: 3000 }]);
  });
});

describe('price history', () => {
  const rates = [{ from: '2026-10-01', ratePaise: 3000 }];

  it('adds a new price from a date and replaces anything planned after it', () => {
    const next = withPriceFrom(rates, '2026-10-01', 3200, '2026-11-01');
    expect(next).toEqual([...rates, { from: '2026-11-01', ratePaise: 3200 }]);
    expect(withPriceFrom(next, '2026-10-01', 3100, '2026-10-15')).toEqual([
      ...rates,
      { from: '2026-10-15', ratePaise: 3100 },
    ]);
    expect(withPriceFrom(next, '2026-10-01', 2900, '2026-10-01')).toEqual([
      { from: '2026-10-01', ratePaise: 2900 },
    ]);
  });

  it('moves the first price with the start date', () => {
    const next = withStartDate([...rates, { from: '2026-11-01', ratePaise: 3200 }], '2026-10-15');
    expect(next).toEqual([
      { from: '2026-10-15', ratePaise: 3000 },
      { from: '2026-11-01', ratePaise: 3200 },
    ]);
  });
});

describe('text', () => {
  it('formats quantities', () => {
    expect(formatQty(150)).toBe('1.5');
    expect(formatQty(125)).toBe('1.25');
    expect(formatQty(300)).toBe('3');
    expect(formatQtyWithUnit(100, 'packet')).toBe('1 packet');
    expect(formatQtyWithUnit(200, 'packet')).toBe('2 packets');
    expect(formatQtyWithUnit(150, 'L')).toBe('1.5 L');
  });

  it('writes the bill breakdown', () => {
    const bill = computeBill(service(), marks([['2026-10-02', 0]]), '2026-10', '2026-10-20');
    expect(billLines(service(), bill, 'INR')).toEqual([
      '19 L × ₹30 = ₹570',
      '1 day skipped',
      'Till 20 Oct 2026',
    ]);
  });

  it('lists the months that can be billed', () => {
    expect(billableMonths(service({ startDate: '2026-08-20' }), '2026-10-05')).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(billableMonths(service({ startDate: '2024-01-01' }), '2026-10-05')).toHaveLength(13);
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });
});
