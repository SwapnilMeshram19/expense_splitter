import { formatDayLine, formatIsoDate, fromIsoDate, toLocalIsoDate, todayIsoDate } from '../dates';

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

  it('round-trips through a local Date without timezone shifts', () => {
    expect(toLocalIsoDate(fromIsoDate('2026-03-31'))).toBe('2026-03-31');
    expect(toLocalIsoDate(fromIsoDate('2024-02-29'))).toBe('2024-02-29');
  });

  it('falls back to now for malformed input', () => {
    expect(fromIsoDate('bad')).toBeInstanceOf(Date);
  });
});
describe('formatDayLine', () => {
  it('reads weekday, day and short month', () => {
    expect(formatDayLine(new Date(2026, 9, 17, 18, 0))).toBe('Saturday, 17 Oct');
    expect(formatDayLine(new Date(2027, 0, 3))).toBe('Sunday, 3 Jan');
  });
});
