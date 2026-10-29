import { Link } from 'wouter';

import { dataStore } from '@/data';
import { useData, useDataStatus } from '@/data/hooks';
import { formatMoney, formatMoneyList } from '@/domain/currency';
import { describeMyBalance } from '@/features/balances/describe';
import { loadOverview } from '@/features/overview/loadOverview';

import { hasAccount, useAuth } from '../platform/auth';
import { refreshNow } from '../platform/data';
import { useScreenOpen } from '../ui/hooks';
import { Avatar, Icon, Spinner } from '../ui/kit';

/** First visit: what the product does, shown as the thing itself (a split bill). */
function Welcome() {
  return (
    <div className="narrow">
      <div className="bill" aria-hidden="true">
        <span className="bill-label">Dinner at the beach shack</span>
        <span className="bill-amount">₹2,400</span>
        <hr className="perforation" />
        <div className="bill-foot">
          <span>You, Rahul, Priya, Anu</span>
          <strong>₹600 each</strong>
        </div>
      </div>
      <h1>Split group expenses and settle up with UPI</h1>
      <p className="muted">
        Add what everyone paid, split it equally or your way, and see who owes whom in the fewest
        payments. No sign-up needed to start.
      </p>
      <div className="actions">
        <Link href="/groups/new" className="btn">
          Create a group
        </Link>
        <Link href="/join" className="btn secondary">
          Join with a code
        </Link>
      </div>
    </div>
  );
}

export function HomeScreen() {
  useScreenOpen('');
  const auth = useAuth();
  const status = useDataStatus();
  const overview = useData(() => loadOverview(dataStore().groups(), dataStore().planningUserId()));

  if (auth.status === 'loading') return <Spinner />;
  if (overview.groups.length === 0) {
    if (hasAccount(auth) && !status.loadedFromServer && status.refreshing) {
      return <Spinner label="Loading your groups…" />;
    }
    return <Welcome />;
  }

  const owedToMe = formatMoneyList(
    overview.totals.map((t) => ({ currency: t.currency, minor: t.owedToMe })),
  );
  const iOwe = formatMoneyList(
    overview.totals.map((t) => ({ currency: t.currency, minor: t.iOwe })),
  );
  const firstCurrency = overview.totals[0]?.currency ?? overview.groups[0]!.group.currency;

  return (
    <>
      <div className="bill">
        {overview.totals.length === 0 ? (
          <>
            <span className="bill-label">Across all your groups</span>
            <span className="bill-amount">All settled up</span>
          </>
        ) : (
          <>
            <span className="bill-label">You are owed</span>
            <span className="bill-amount">{owedToMe || formatMoney(0, firstCurrency)}</span>
          </>
        )}
        <hr className="perforation" />
        <div className="bill-foot">
          <span>
            {overview.groups.length} {overview.groups.length === 1 ? 'group' : 'groups'}
          </span>
          {iOwe ? <strong>You owe {iOwe}</strong> : null}
        </div>
      </div>

      <div className="page-head">
        <h2 className="grow">Your groups</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Refresh"
          disabled={status.refreshing}
          onClick={() => void refreshNow()}
        >
          <Icon name="refresh" />
        </button>
        <Link href="/groups/new" className="btn small">
          <Icon name="plus" size={16} /> New group
        </Link>
      </div>

      <div className="group-grid">
        {overview.groups.map((g) => {
          const balance = describeMyBalance(g.myBalance, g.group.currency);
          const pending = dataStore().pendingStatus(g.group.id);
          return (
            <Link key={g.group.id} href={`/groups/${g.group.id}`} className="group-tile">
              <Avatar name={g.group.name} seed={g.group.id} size="lg" />
              <div className="grow">
                <div className="row-title ellipsis">{g.group.name}</div>
                <div className="row-sub">
                  {g.activeMemberCount} {g.activeMemberCount === 1 ? 'person' : 'people'}{' '}
                  {pending ? (
                    <span className="chip">
                      {pending === 'failed' ? 'Not saved' : 'Not sent yet'}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className={`row-end ${balance.tone}`}>
                <div>{balance.lead}</div>
                {balance.amount ? <div className="amount">{balance.amount}</div> : null}
              </div>
            </Link>
          );
        })}
      </div>

      <Link href="/join" className="btn ghost">
        Join a group with a code
      </Link>
    </>
  );
}
