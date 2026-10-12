import { formatMoneyList } from '@/domain/currency';
import type { CurrencyTotal } from '@/features/overview/loadOverview';

/**
 * The weekly settle-up reminder, from my per-currency totals (never converted between
 * currencies, like the Home tab). Null when I'm settled everywhere: nothing is scheduled then.
 */
export function weeklyReminderText(
  totals: readonly CurrencyTotal[],
): { title: string; body: string } | null {
  const owe = formatMoneyList(totals.map((t) => ({ currency: t.currency, minor: t.iOwe })));
  const owed = formatMoneyList(totals.map((t) => ({ currency: t.currency, minor: t.owedToMe })));
  if (owe) {
    return {
      title: 'Settle up this week?',
      body: owed
        ? `You owe ${owe} and are owed ${owed}. Tap to see who.`
        : `You owe ${owe}. Tap to see who to pay.`,
    };
  }
  if (owed) {
    return {
      title: 'Friends owe you money',
      body: `You’re owed ${owed}. Tap to send a reminder.`,
    };
  }
  return null;
}
