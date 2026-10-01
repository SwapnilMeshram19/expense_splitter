import { formatIsoDate, todayIsoDate } from '../dates';

describe('dates', () => {
  it('formats ISO dates for display', () => {
    expect(formatIsoDate('2026-10-01')).toBe('1 Oct 2026');
    expect(formatIsoDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('returns malformed input unchanged', () => {
    expect(formatIsoDate('2026-13-01')).toBe('2026-13-01');
    expect(formatIsoDate('oops')).toBe('oops');
  });

  it('uses local calendar date, zero-padded', () => {
    expect(todayIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});