/**
 * What the home-services screens show, computed from a group snapshot (plain TypeScript: the web
 * app can reuse it). Money in minor units of the group currency; quantities in hundredths.
 */
import { markValue } from '@/domain/commands';
import {
  addMonths,
  billLines,
  billableMonths,
  computeBill,
  datesOfMonth,
  dayState,
  formatQtyWithUnit,
  isActiveOn,
  isScheduled,
  marksByDate,
  MARK_FUTURE_DAYS,
  addDays,
  monthEnd,
  monthOf,
  unitWord,
  usualQty,
  weekdayOf,
  type Bill,
  type DayState,
} from '@/domain/household';
import type { Expense, GroupSnapshot, HouseholdService } from '@/domain/model';
import { selfMember } from '@/domain/model';

export interface ServiceToday {
  service: HouseholdService;
  /** Inside its start/end dates today. */
  active: boolean;
  /** A usual day (scheduled weekday). */
  scheduled: boolean;
  /** What counts today. */
  qty: number;
  usual: number;
  /** The stored mark (null = as usual): sent as `expected` with the next change. */
  stored: number | null;
  status: string;
  /** This month so far. */
  monthAmount: number;
  /** The posted bill for this month differs from the marks. */
  billChanged: boolean;
}

export interface HouseholdList {
  currency: string;
  /** My member id, or null when I'm not in the group (read-only). */
  me: string | null;
  items: ServiceToday[];
}

/** One-line status for today ("1 L as usual", "Absent today"…). */
export function statusFor(
  service: HouseholdService,
  date: string,
  qty: number,
  today: string,
): string {
  const when = date === today ? 'today' : '';
  if (!isActiveOn(service, date)) return date < service.startDate ? 'Not started yet' : 'Stopped';
  const usual = usualQty(service, date);
  if (service.kind === 'monthly') {
    if (usual === 0) return 'Day off';
    return qty === 0 ? `Absent ${when}`.trim() : `Came ${when}`.trim();
  }
  if (qty === usual)
    return usual === 0 ? `None ${when}`.trim() : `${formatQtyWithUnit(qty, service.unit)} as usual`;
  if (qty === 0) return `Skipped ${when}`.trim();
  return `${formatQtyWithUnit(qty, service.unit)} ${when}`.trim();
}

/** The expense a month's bill was posted as, if it still exists. */
export const postedExpense = (
  snapshot: GroupSnapshot,
  service: HouseholdService,
  month: string,
): Expense | null => {
  const id = service.bills[month];
  return id ? (snapshot.expenses.find((e) => e.id === id) ?? null) : null;
};

/** Days counted for a month's bill: up to today in the current month. */
export const billUpTo = (month: string, today: string): string =>
  month === monthOf(today) ? today : monthEnd(month);

export function loadHouseholdList(
  snapshot: GroupSnapshot | null,
  userId: string,
  today: string,
): HouseholdList | null {
  if (!snapshot) return null;
  const month = monthOf(today);
  const items = snapshot.householdServices.map((service): ServiceToday => {
    const marks = marksByDate(snapshot.householdMarks, service.id);
    const mark = marks.get(today);
    const usual = usualQty(service, today);
    const qty = isActiveOn(service, today) ? (mark ?? usual) : 0;
    const bill = computeBill(service, marks, month, today);
    const posted = postedExpense(snapshot, service, month);
    return {
      service,
      active: isActiveOn(service, today),
      scheduled: isScheduled(service, today),
      qty,
      usual,
      stored: markValue(snapshot, service.id, today),
      status: statusFor(service, today, qty, today),
      monthAmount: bill.amountPaise,
      billChanged: posted !== null && posted.amountPaise !== bill.amountPaise,
    };
  });
  return { currency: snapshot.group.currency, me: selfMember(snapshot, userId)?.id ?? null, items };
}

export interface CalendarDay {
  date: string;
  day: number;
  state: DayState;
  qty: number;
  isToday: boolean;
  /** Can be changed (inside the service's dates, not too far ahead). */
  editable: boolean;
}

export interface ServiceMonth {
  service: HouseholdService;
  currency: string;
  me: string | null;
  month: string;
  /** Blank cells before the 1st in a Monday-first week. */
  leadingBlanks: number;
  days: CalendarDay[];
  /** null for a month that hasn't started. */
  bill: Bill | null;
  billText: string[];
  posted: Expense | null;
  /** The posted expense's amount no longer matches the marks. */
  billChanged: boolean;
  canPost: boolean;
  prevMonth: string | null;
  nextMonth: string | null;
  unit: string;
}

export function loadServiceMonth(
  snapshot: GroupSnapshot | null,
  serviceId: string,
  month: string,
  userId: string,
  today: string,
): ServiceMonth | null {
  const service = snapshot?.householdServices.find((h) => h.id === serviceId.toLowerCase());
  if (!snapshot || !service) return null;
  const marks = marksByDate(snapshot.householdMarks, service.id);
  const lastEditable = addDays(today, MARK_FUTURE_DAYS);
  const days = datesOfMonth(month).map((date): CalendarDay => {
    const mark = marks.get(date);
    return {
      date,
      day: Number(date.slice(8)),
      state: isActiveOn(service, date) ? dayState(service, date, mark) : 'off',
      qty: isActiveOn(service, date) ? (mark ?? usualQty(service, date)) : 0,
      isToday: date === today,
      editable:
        isActiveOn(service, date) &&
        date <= lastEditable &&
        (service.kind === 'per_unit' || isScheduled(service, date)),
    };
  });

  const billable = billableMonths(service, today);
  const started = month <= monthOf(today);
  const bill =
    started && billable.includes(month)
      ? computeBill(service, marks, month, billUpTo(month, today))
      : null;
  const posted = postedExpense(snapshot, service, month);
  const firstMonth = billable[0] ?? monthOf(service.startDate);
  const lastMonth = monthOf(lastEditable);
  const me = selfMember(snapshot, userId)?.id ?? null;
  return {
    service,
    currency: snapshot.group.currency,
    me,
    month,
    leadingBlanks: (weekdayOf(`${month}-01`) + 6) % 7,
    days,
    bill,
    billText: bill ? billLines(service, bill, snapshot.group.currency) : [],
    posted,
    billChanged: posted !== null && bill !== null && posted.amountPaise !== bill.amountPaise,
    canPost:
      me !== null &&
      bill !== null &&
      bill.amountPaise > 0 &&
      (posted === null || posted.amountPaise !== bill.amountPaise),
    prevMonth: month > firstMonth ? addMonths(month, -1) : null,
    nextMonth: month < lastMonth ? addMonths(month, 1) : null,
    unit: service.kind === 'monthly' ? 'day' : unitWord(service.unit),
  };
}

/** Who pays and who shares a bill by default: the posted bill's people, else me and everyone. */
export function defaultBillPeople(
  snapshot: GroupSnapshot,
  posted: Expense | null,
  me: string | null,
) {
  const active = snapshot.members.filter((m) => m.deletedAt === null).map((m) => m.id);
  if (posted) {
    const payer = posted.payers[0]?.memberId;
    const sharers = posted.shares.map((s) => s.memberId).filter((id) => active.includes(id));
    return {
      paidBy: payer && active.includes(payer) ? payer : (me ?? active[0] ?? ''),
      memberIds: sharers.length > 0 ? sharers : active,
    };
  }
  return { paidBy: me ?? active[0] ?? '', memberIds: active };
}
