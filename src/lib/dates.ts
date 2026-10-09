const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as 'YYYY-MM-DD' (device timezone, not UTC). */
export function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayIsoDate(now: Date = new Date()): string {
  return toLocalIsoDate(now);
}

/** 'YYYY-MM-DD' -> local Date at midnight. Falls back to now if malformed. */
export function fromIsoDate(isoDate: string): Date {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** '2026-10-01' -> '1 Oct 2026'. Returns the input unchanged if malformed. */
export function formatIsoDate(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return isoDate;
  return `${Number(match[3])} ${month} ${match[1]}`;
}
/** Header greeting by the phone's local time. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
