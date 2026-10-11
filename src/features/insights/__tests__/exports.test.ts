import type { InsightMember, InsightSettlement } from '../compute';
import { buildExpensesCsv, CSV_BOM, csvText, memberColumnTitles, minorToDecimal } from '../csv';
import { exportFileName, fileSlug } from '../fileNames';
import { buildReportHtml, escapeHtml } from '../reportHtml';

import { expense } from './fixtures';

const members: InsightMember[] = [
  { id: 'me', name: 'Asha', active: true },
  { id: 'rahul', name: 'Rahul', active: true },
  { id: 'old', name: 'Vikram', active: false },
  { id: 'gone', name: 'Neha', active: false },
];

const payment = (
  date: string,
  from: string,
  to: string,
  amount: number,
  extra: Partial<InsightSettlement> = {},
): InsightSettlement => ({
  id: `s-${date}`,
  date,
  createdAt: 0,
  fromMemberId: from,
  toMemberId: to,
  amount,
  method: 'upi',
  note: null,
  ...extra,
});

/** Parse our own CSV output (quoted text cells, unquoted numbers). */
function parse(csv: string): string[][] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const text = csv.slice(1);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  return rows;
}

describe('csv cells', () => {
  it('quotes and doubles quotes', () => {
    expect(csvText('Dinner, "Goa"')).toBe('"Dinner, ""Goa"""');
    expect(csvText(null)).toBe('""');
    expect(csvText('line\nbreak')).toBe('"line\nbreak"');
  });

  it('neutralises formulas', () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    for (const lead of ['+', '-', '@', '\t', '\r'])
      expect(csvText(`${lead}1`).startsWith(`"'`)).toBe(true);
    expect(csvText('Rs 50 = ok')).toBe('"Rs 50 = ok"');
  });

  it('writes amounts as plain decimals in the currency digits', () => {
    expect(minorToDecimal(123450, 'INR')).toBe('1234.50');
    expect(minorToDecimal(-5, 'INR')).toBe('-0.05');
    expect(minorToDecimal(0, 'USD')).toBe('0.00');
    expect(minorToDecimal(1500, 'JPY')).toBe('1500');
    expect(minorToDecimal(1250, 'KWD')).toBe('1.250');
    expect(() => minorToDecimal(1.5, 'INR')).toThrow(RangeError);
  });

  it('makes member columns unique', () => {
    expect(
      memberColumnTitles([
        { id: 'a', name: 'Rahul', active: true },
        { id: 'b', name: 'rahul', active: true },
        { id: 'c', name: 'Neha', active: false },
      ]),
    ).toEqual(['Rahul', 'rahul (2)', 'Neha (left)']);
  });
});

describe('buildExpensesCsv', () => {
  const expenses = [
    expense('2026-10-02', 90000, {
      description: '=cmd|calc',
      category: 'other',
      categoryLabel: 'Petrol',
      split: { me: 30000, rahul: 30000, old: 30000 },
      paidBy: { rahul: 90000 },
      note: 'full tank',
    }),
    expense('2026-09-20', 1000, {
      description: 'Chai',
      split: { me: 500, rahul: 500 },
      paidBy: { me: 600, rahul: 400 },
      originalCurrency: 'USD',
      originalAmountMinor: 12,
    }),
  ];
  const settlements = [payment('2026-10-05', 'me', 'rahul', 29900, { note: 'thanks' })];

  it('lists expenses and payments oldest first with balance effects that add up', () => {
    const rows = parse(
      buildExpensesCsv({ currency: 'INR', members, expenses, settlements, period: null }),
    );
    expect(rows[0]).toEqual([
      'Date',
      'Type',
      'Description',
      'Category',
      'Amount',
      'Currency',
      'Original amount',
      'Original currency',
      'Paid by',
      'Note',
      'Asha',
      'Rahul',
      'Vikram (left)',
    ]);
    // Neha left without any rows: no column.
    expect(rows.map((r) => r[0])).toEqual(['Date', '2026-09-20', '2026-10-02', '2026-10-05', '']);
    expect(rows[1]).toEqual([
      '2026-09-20',
      'Expense',
      'Chai',
      'Food & drinks',
      '10.00',
      'INR',
      '0.12',
      'USD',
      'Asha 6.00; Rahul 4.00',
      '',
      '1.00',
      '-1.00',
      '0.00',
    ]);
    expect(rows[2]!.slice(1, 4)).toEqual(['Expense', "'=cmd|calc", 'Petrol']);
    expect(rows[2]!.slice(8)).toEqual(['Rahul', 'full tank', '-300.00', '600.00', '-300.00']);
    expect(rows[3]!.slice(1, 5)).toEqual(['Payment', 'Asha paid Rahul', 'UPI', '299.00']);
    expect(rows[3]!.slice(10)).toEqual(['299.00', '-299.00', '0.00']);
    expect(rows[4]!.slice(2)).toEqual([
      'Balance',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '0.00',
      '300.00',
      '-300.00',
    ]);
  });

  it('filters to one month and labels the total', () => {
    const rows = parse(
      buildExpensesCsv({ currency: 'INR', members, expenses, settlements, period: '2026-09' }),
    );
    expect(rows).toHaveLength(3);
    expect(rows[2]![2]).toBe('Total for September 2026');
    // Active members keep their column even with nothing this month; leavers only when involved.
    expect(rows[0]!.slice(10)).toEqual(['Asha', 'Rahul']);
  });

  it('still adds up when a line names an unknown member', () => {
    const odd = [expense('2026-10-01', 100, { split: { ghost: 100 }, paidBy: { me: 100 } })];
    const rows = parse(
      buildExpensesCsv({ currency: 'INR', members, expenses: odd, settlements: [], period: null }),
    );
    expect(rows[0]!.slice(10)).toEqual(['Asha', 'Rahul', 'Unknown member (left)']);
    expect(rows[2]!.slice(10)).toEqual(['1.00', '0.00', '-1.00']);
  });

  it('uses CRLF line ends and ends with one', () => {
    const csv = buildExpensesCsv({
      currency: 'INR',
      members,
      expenses: [],
      settlements: [],
      period: null,
    });
    expect(csv).toBe(
      `${CSV_BOM}${[
        '"Date","Type","Description","Category","Amount","Currency","Original amount","Original currency","Paid by","Note","Asha","Rahul"',
        ',,"Balance",,,,,,,,0.00,0.00',
      ].join('\r\n')}\r\n`,
    );
  });
});

describe('buildReportHtml', () => {
  const base = {
    groupName: 'Goa <script>alert(1)</script>',
    currency: 'INR',
    members,
    today: '2026-10-11',
    balances: new Map([
      ['me', -100],
      ['rahul', 100],
    ]),
    budget: null,
  };
  const expenses = [
    expense('2026-09-01', 100000, {
      description: 'Hotel & "spa"',
      category: 'stay',
      split: { me: 50000, rahul: 50000 },
      paidBy: { rahul: 100000 },
    }),
    expense('2026-10-02', 2000, {
      description: '<img src=x onerror=alert(1)>',
      note: "Raj's note",
    }),
  ];

  it('escapes everything users typed', () => {
    const html = buildReportHtml({ ...base, expenses, period: null });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('Goa &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Hotel &amp; &quot;spa&quot;');
    expect(html).toContain('Raj&#39;s note');
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('has the summary, months, categories, people and balances for all time', () => {
    const html = buildReportHtml({ ...base, expenses, period: null });
    expect(html).toContain('Spending report · All time');
    expect(html).toContain('₹1,020'); // total
    expect(html).toContain('By month');
    expect(html).toContain('Sep 2026');
    expect(html).toContain('Stay');
    expect(html).toContain('Balance now');
    expect(html).toContain('gets back ₹1');
    expect(html).toContain('owes ₹1');
  });

  it('shows one month without months table or balances', () => {
    const html = buildReportHtml({ ...base, balances: null, expenses, period: '2026-10' });
    expect(html).toContain('October 2026');
    expect(html).not.toContain('By month');
    expect(html).not.toContain('Balance now');
    expect(html).not.toContain('Hotel');
  });

  it('shows a monthly budget only for its own month', () => {
    const budget = {
      limit: 5000,
      period: 'monthly' as const,
      spent: 2000,
      remaining: 3000,
      ratio: 0.4,
      level: 'ok' as const,
      month: '2026-10',
    };
    expect(buildReportHtml({ ...base, budget, expenses, period: '2026-10' })).toContain(
      'Monthly budget',
    );
    expect(buildReportHtml({ ...base, budget, expenses, period: '2026-09' })).not.toContain(
      'Monthly budget',
    );
    expect(buildReportHtml({ ...base, budget, expenses, period: null })).not.toContain(
      'Monthly budget',
    );
  });

  it('says so when a period has no expenses', () => {
    expect(buildReportHtml({ ...base, expenses, period: '2026-01' })).toContain(
      'No expenses in this period.',
    );
  });
});

describe('file names', () => {
  it('slugs group names to ASCII', () => {
    expect(fileSlug('Goa trip 2026!')).toBe('goa-trip-2026');
    expect(fileSlug('Café ☕ crew')).toBe('cafe-crew');
    expect(fileSlug('गोवा')).toBe('group');
    expect(fileSlug('a'.repeat(39) + ' bcd')).toBe('a'.repeat(39));
  });

  it('names the period', () => {
    expect(exportFileName('Flat 302', null, 'csv')).toBe('flat-302-all-time.csv');
    expect(exportFileName('Flat 302', '2026-10', 'pdf')).toBe('flat-302-2026-10.pdf');
  });
});
