/**
 * Recurring expenses: schedules and occurrence ids. Pure TypeScript, zero dependencies (copied to
 * the Edge Function). The server's generator (SQL) computes the same dates and ids:
 *   date n  = start + n weeks / months / years (Postgres date + interval: month-end and 29 Feb clamp)
 *   id      = uuid_generate_v5(RECURRING_NAMESPACE, '<rule id>/<YYYY-MM-DD>')
 * so a phone and the server creating the same occurrence produce the same row.
 */
import { uuidv5 } from './uuidv5';

export const FREQUENCIES = ['weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** Fixed namespace for occurrence ids. Never change it: existing ids would no longer match. */
export const RECURRING_NAMESPACE = '5c1e9a52-4b7d-4f2e-9d0a-3c8b6e2f1a47';

/** Occurrences created per rule in one run; a long gap catches up over the next runs. */
export const MAX_OCCURRENCES_PER_RUN = 24;
/** Safety bound on the schedule walk (≈ 19 years of weekly dates). */
const MAX_STEPS = 1000;

export const isFrequency = (value: unknown): value is Frequency =>
  typeof value === 'string' && (FREQUENCIES as readonly string[]).includes(value);

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function parse(iso: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const format = ({ y, m, d }: Ymd) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && parse(value) !== null;

/** The n-th occurrence (n = 0 is the start date). */
export function occurrenceDate(start: string, frequency: Frequency, n: number): string {
  const s = parse(start);
  if (!s) throw new RangeError(`Invalid date: ${start}`);
  if (frequency === 'weekly') {
    const t = new Date(Date.UTC(s.y, s.m - 1, s.d + 7 * n));
    return format({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
  }
  const months = frequency === 'monthly' ? n : 12 * n;
  const index = s.y * 12 + (s.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return format({ y, m, d: Math.min(s.d, daysInMonth(y, m)) });
}

export interface Schedule {
  startDate: string;
  endDate: string | null;
  frequency: Frequency;
}

/** Every occurrence date up to and including `today` (and the end date), oldest first. */
export function dueOccurrences(schedule: Schedule, today: string): string[] {
  const out: string[] = [];
  for (let n = 0; n < MAX_STEPS; n++) {
    const date = occurrenceDate(schedule.startDate, schedule.frequency, n);
    if (date > today || (schedule.endDate !== null && date > schedule.endDate)) break;
    out.push(date);
  }
  return out;
}

/** The first occurrence after `today`, or null when the schedule has ended. */
export function nextOccurrence(schedule: Schedule, today: string): string | null {
  for (let n = 0; n < MAX_STEPS; n++) {
    const date = occurrenceDate(schedule.startDate, schedule.frequency, n);
    if (schedule.endDate !== null && date > schedule.endDate) return null;
    if (date > today) return date;
  }
  return null;
}

/** Id of the expense created for `ruleId` on `date`: same on every phone and on the server. */
export const occurrenceId = (ruleId: string, date: string): string =>
  uuidv5(RECURRING_NAMESPACE, `${ruleId.toLowerCase()}/${date}`);

/** Id of that occurrence's history entry (so two creators can't log it twice). */
export const occurrenceActivityId = (ruleId: string, date: string): string =>
  uuidv5(RECURRING_NAMESPACE, `${ruleId.toLowerCase()}/${date}/activity`);

export type ScheduleError =
  'INVALID_FREQUENCY' | 'INVALID_START' | 'INVALID_END' | 'END_BEFORE_START';

export function validateSchedule(schedule: {
  startDate: unknown;
  endDate: unknown;
  frequency: unknown;
}): ScheduleError | null {
  if (!isFrequency(schedule.frequency)) return 'INVALID_FREQUENCY';
  if (!isIsoDate(schedule.startDate)) return 'INVALID_START';
  if (schedule.endDate !== null && !isIsoDate(schedule.endDate)) return 'INVALID_END';
  if (schedule.endDate !== null && (schedule.endDate as string) < schedule.startDate)
    return 'END_BEFORE_START';
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "Every week on Monday", "Every month on the 31st (or the last day)", "Every year on 29 Feb". */
export function describeSchedule(frequency: Frequency, startDate: string): string {
  const s = parse(startDate);
  if (!s) return '';
  if (frequency === 'weekly') {
    return `Every week on ${WEEKDAYS[new Date(Date.UTC(s.y, s.m - 1, s.d)).getUTCDay()]}`;
  }
  if (frequency === 'monthly') {
    return `Every month on the ${ordinal(s.d)}${s.d > 28 ? ' (or the last day)' : ''}`;
  }
  return `Every year on ${s.d} ${MONTHS[s.m - 1]}`;
}
