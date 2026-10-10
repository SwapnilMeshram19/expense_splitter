import {
  describeSchedule,
  dueOccurrences,
  nextOccurrence,
  occurrenceActivityId,
  occurrenceDate,
  occurrenceId,
  validateSchedule,
} from '../recurrence';

describe('occurrence dates (same rules as Postgres date + interval)', () => {
  it('steps weekly, monthly and yearly from the start', () => {
    expect([0, 1, 2].map((n) => occurrenceDate('2026-12-24', 'weekly', n))).toEqual([
      '2026-12-24',
      '2026-12-31',
      '2027-01-07',
    ]);
    expect([0, 1, 2, 12].map((n) => occurrenceDate('2026-11-05', 'monthly', n))).toEqual([
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
      '2027-11-05',
    ]);
  });

  it('clamps to the month end without drifting', () => {
    // 31 Jan → 28 Feb → 31 Mar (always from the start date, never from the previous one).
    expect([0, 1, 2, 3].map((n) => occurrenceDate('2027-01-31', 'monthly', n))).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    expect(occurrenceDate('2028-01-31', 'monthly', 1)).toBe('2028-02-29'); // leap year
    expect([0, 1, 4].map((n) => occurrenceDate('2028-02-29', 'yearly', n))).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2032-02-29',
    ]);
  });

  it('lists due dates up to today and the end date', () => {
    const rent = { startDate: '2026-08-01', endDate: null, frequency: 'monthly' as const };
    expect(dueOccurrences(rent, '2026-10-10')).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(dueOccurrences(rent, '2026-07-31')).toEqual([]);
    expect(dueOccurrences({ ...rent, endDate: '2026-09-15' }, '2026-12-01')).toEqual([
      '2026-08-01',
      '2026-09-01',
    ]);
    expect(nextOccurrence(rent, '2026-10-10')).toBe('2026-11-01');
    expect(nextOccurrence(rent, '2026-10-01')).toBe('2026-11-01');
    expect(nextOccurrence({ ...rent, endDate: '2026-10-31' }, '2026-10-10')).toBeNull();
  });
});

describe('occurrence ids', () => {
  it('are deterministic per rule and date, case-insensitive on the rule id', () => {
    const rule = '0192f0c4-7b1a-7c3e-8a10-2b3c4d5e6f70';
    expect(occurrenceId(rule, '2026-11-01')).toBe(occurrenceId(rule.toUpperCase(), '2026-11-01'));
    expect(occurrenceId(rule, '2026-11-01')).not.toBe(occurrenceId(rule, '2026-12-01'));
    expect(occurrenceActivityId(rule, '2026-11-01')).not.toBe(occurrenceId(rule, '2026-11-01'));
    expect(occurrenceId(rule, '2026-11-01')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('schedule checks and wording', () => {
  it('validates', () => {
    expect(
      validateSchedule({ startDate: '2026-10-01', endDate: null, frequency: 'monthly' }),
    ).toBeNull();
    expect(validateSchedule({ startDate: '2026-10-01', endDate: null, frequency: 'daily' })).toBe(
      'INVALID_FREQUENCY',
    );
    expect(validateSchedule({ startDate: '2026-02-30', endDate: null, frequency: 'weekly' })).toBe(
      'INVALID_START',
    );
    expect(
      validateSchedule({ startDate: '2026-10-01', endDate: '2026-09-01', frequency: 'weekly' }),
    ).toBe('END_BEFORE_START');
  });

  it('describes schedules', () => {
    expect(describeSchedule('weekly', '2026-10-12')).toBe('Every week on Monday');
    expect(describeSchedule('monthly', '2026-10-01')).toBe('Every month on the 1st');
    expect(describeSchedule('monthly', '2026-10-22')).toBe('Every month on the 22nd');
    expect(describeSchedule('monthly', '2026-10-11')).toBe('Every month on the 11th');
    expect(describeSchedule('monthly', '2026-10-31')).toBe(
      'Every month on the 31st (or the last day)',
    );
    expect(describeSchedule('yearly', '2028-02-29')).toBe('Every year on 29 Feb');
  });
});
