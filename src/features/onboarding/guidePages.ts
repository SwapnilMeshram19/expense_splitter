import type { IconName } from '@/ui/Icon';

export interface GuidePage {
  key: string;
  icon: IconName;
  title: string;
  body: string;
  /** Two or three short facts, each one line on a small phone. */
  points: readonly { icon: IconName; text: string }[];
}

/**
 * The first-run guide: what the app does, in the order people use it. Plain words, no feature
 * names they haven't met yet. Kept to four pages: anything longer gets skipped unread.
 */
export const GUIDE_PAGES: readonly GuidePage[] = [
  {
    key: 'groups',
    icon: 'groups',
    title: 'Make a group for anything',
    body: 'A trip, your flat, office lunches, a family function. Add people by name.',
    points: [
      { icon: 'personAdd', text: 'Friends don’t need the app to be in a group' },
      { icon: 'link', text: 'Invite them with a link or code when ready' },
    ],
  },
  {
    key: 'expenses',
    icon: 'receipt',
    title: 'Add what you spend',
    body: 'Enter the amount, who paid, and how to split it.',
    points: [
      { icon: 'check', text: 'Equally, exact amounts, percentages or shares' },
      { icon: 'camera', text: 'Attach a photo of the bill' },
      { icon: 'cloudOff', text: 'Works offline, syncs when you’re back' },
    ],
  },
  {
    key: 'balances',
    icon: 'settle',
    title: 'See who owes whom',
    body: 'Balances update as you add. Debts are simplified to the fewest payments.',
    points: [
      { icon: 'rupee', text: 'Amounts in ₹ with lakh and crore' },
      { icon: 'history', text: 'Every change is in Activity' },
    ],
  },
  {
    key: 'settle',
    icon: 'upiPay',
    title: 'Settle up by UPI',
    body: 'Tap Pay to open your UPI app with the amount filled in. Paid in cash? Just record it.',
    points: [
      { icon: 'wallet', text: 'Add your UPI ID so friends can pay you' },
      { icon: 'login', text: 'Sign in from Account to share and back up' },
    ],
  },
];
