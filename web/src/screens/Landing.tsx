/**
 * The home page for someone with no groups yet: what Expense Splitter does, shown with a worked
 * example instead of claims. The example is computed by the real balance and debt-simplifying
 * code (src/domain), so the numbers on the page are exactly what the app would show.
 */
import { useMemo } from 'react';
import { Link } from 'wouter';

import { computeBalances } from '@/domain/balances';
import { formatMoney } from '@/domain/currency';
import { simplifyDebts } from '@/domain/simplify';
import { computeSplit } from '@/domain/splits';

import { Avatar, CategoryTile, Icon } from '../ui/kit';

const PEOPLE = [
  { id: 'alex', name: 'Alex' },
  { id: 'mia', name: 'Mia' },
  { id: 'kenji', name: 'Kenji' },
  { id: 'sofia', name: 'Sofia' },
] as const;

const EXAMPLE = [
  {
    id: 'stay',
    description: 'Beach villa, 2 nights',
    category: 'stay',
    paidBy: 'kenji',
    amount: 8_000_00,
  },
  { id: 'food', description: 'Seafood dinner', category: 'food', paidBy: 'alex', amount: 2_400_00 },
  { id: 'cab', description: 'Airport cab', category: 'transport', paidBy: 'mia', amount: 1_600_00 },
] as const;

const nameOf = (id: string) => PEOPLE.find((p) => p.id === id)?.name ?? id;
const inr = (paise: number) => formatMoney(paise, 'INR');

function useExample() {
  return useMemo(() => {
    const everyone = PEOPLE.map((p) => p.id);
    const expenses = EXAMPLE.map((e) => {
      const split = computeSplit(e.amount, { type: 'equal', memberIds: [...everyone] });
      return {
        id: e.id,
        payers: [{ memberId: e.paidBy, amountPaise: e.amount }],
        shares: split.ok ? split.shares : [],
      };
    });
    const { balances } = computeBalances(expenses, []);
    const total = EXAMPLE.reduce((sum, e) => sum + e.amount, 0);
    return { total, each: total / PEOPLE.length, payments: simplifyDebts(balances) };
  }, []);
}

const FEATURES: { icon: Parameters<typeof Icon>[0]['name']; title: string; text: string }[] = [
  {
    icon: 'swap',
    title: 'Fewest payments',
    text: 'Everyone’s debts are combined, so the group settles in as few transfers as possible.',
  },
  {
    icon: 'pie',
    title: 'Split it your way',
    text: 'Equally, by exact amounts, by percentage or by shares. Paise always add up.',
  },
  {
    icon: 'share',
    title: 'Settle up with UPI',
    text: 'Open your UPI app with the amount filled in, or scan a QR code from your computer.',
  },
  {
    icon: 'cloud',
    title: 'Works on patchy networks',
    text: 'New expenses are kept on your device and sent as soon as you’re back online.',
  },
  {
    icon: 'person',
    title: 'No sign-up to start',
    text: 'Create a group in seconds. Save your account later to use it on other devices.',
  },
  {
    icon: 'globe',
    title: 'Any currency',
    text: 'Rupees, dollars, euros, yen and many more: each group keeps its own currency.',
  },
];

export function Landing() {
  const example = useExample();
  const playStore = import.meta.env.VITE_PLAY_STORE_URL;

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-copy">
          <h1>Shared costs, sorted in a minute.</h1>
          <p className="lead">
            Trips, flatmates, office lunches. Add what each person paid and Expense Splitter works
            out who owes whom, in the fewest payments.
          </p>
          <div className="row wrap">
            <Link href="/groups/new" className="btn">
              <Icon name="plus" size={18} /> Create a group
            </Link>
            <Link href="/join" className="btn secondary">
              I have an invite code
            </Link>
          </div>
          <p className="small muted">Free. No sign-up needed to start.</p>
        </div>

        <figure className="demo" aria-label="Example: a weekend trip split four ways">
          <div className="bill">
            <span className="bill-label">Weekend getaway</span>
            <span className="bill-amount">{inr(example.total)}</span>
            <hr className="perforation" />
            <div className="bill-foot">
              <span className="avatar-stack">
                {PEOPLE.map((p) => (
                  <Avatar key={p.id} name={p.name} seed={p.id} size="sm" />
                ))}
              </span>
              <strong>{inr(example.each)} each</strong>
            </div>
          </div>

          <div className="demo-list">
            {EXAMPLE.map((e) => (
              <div key={e.id} className="list-row static">
                <CategoryTile category={e.category} />
                <div className="grow">
                  <div className="row-title ellipsis">{e.description}</div>
                  <div className="row-sub">{nameOf(e.paidBy)} paid</div>
                </div>
                <span className="row-end amount">{inr(e.amount)}</span>
              </div>
            ))}
          </div>

          <figcaption className="demo-result">
            <span className="demo-result-title">
              {example.payments.length} payments and everyone is square
            </span>
            {example.payments.map((d) => (
              <span key={`${d.fromMemberId}-${d.toMemberId}`} className="demo-payment">
                <Avatar name={nameOf(d.fromMemberId)} seed={d.fromMemberId} size="sm" />
                <span className="grow">
                  {nameOf(d.fromMemberId)} pays {nameOf(d.toMemberId)}
                </span>
                <strong className="amount">{inr(d.amountPaise)}</strong>
              </span>
            ))}
          </figcaption>
        </figure>
      </section>

      <section className="landing-section" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="steps">
          <li>
            <strong>Create a group</strong>
            <span>Name it and add people. They can join later with an invite link.</span>
          </li>
          <li>
            <strong>Add expenses</strong>
            <span>Who paid, how much, and who it was for. Split equally or your way.</span>
          </li>
          <li>
            <strong>Settle up</strong>
            <span>See who pays whom, pay with UPI or cash, and mark it done.</span>
          </li>
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="features">
        <h2 id="features">Made for real groups</h2>
        <div className="features">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <span className="feature-icon" aria-hidden="true">
                <Icon name={f.icon} />
              </span>
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h2>Start your first group</h2>
        <p className="muted">
          It works right here in the browser{playStore ? ' and on Android' : ''}.
        </p>
        <div className="row wrap">
          <Link href="/groups/new" className="btn">
            Create a group
          </Link>
          {playStore ? (
            <a className="btn secondary" href={playStore} rel="noopener noreferrer">
              Get the Android app
            </a>
          ) : (
            <Link href="/join" className="btn secondary">
              Join with a code
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
