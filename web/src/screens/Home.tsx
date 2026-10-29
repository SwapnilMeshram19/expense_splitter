import { Link } from 'wouter';

import { dataStore } from '@/data';
import { useData, useDataStatus } from '@/data/hooks';
import { formatMoney, formatMoneyList } from '@/domain/currency';
import { describeMyBalance } from '@/features/balances/describe';
import { loadOverview } from '@/features/overview/loadOverview';

import { hasAccount, useAuth } from '../platform/auth';
import { refreshNow } from '../platform/data';
import { useScreenOpen } from '../ui/hooks';
import { Avatar, Card, Icon, Spinner } from '../ui/kit';

function Welcome() {
  return (
    <Card>
      <h1>Split expenses with friends</h1>
      <p className="muted">
        Groups, equal or custom splits, simplified “who owes whom”, and settle up with UPI. No
        sign-up needed to start.
      </p>
      <div className="row wrap">
        <Link href="/groups/new" className="btn">
          Create a group
        </Link>
        <Link href="/join" className="btn secondary">
          Join with a code
        </Link>
      </div>
    </Card>
  );
}

export function HomeScreen() {
  useScreenOpen('');
  const auth = useAuth();
  const status = useDataStatus();
  const overview = useData(() => loadOverview(dataStore().groups(), dataStore().planningUserId()));

  if (auth.status === 'loading') return <Spinner />;
  if (overview.groups.length === 0) {
    if (hasAccount(auth) && !status.loadedFromServer && status.refreshing)
      return <Spinner label="Loading your groups…" />;
    return <Welcome />;
  }

  const owedToMe = overview.totals.map((t) => ({ currency: t.currency, minor: t.owedToMe }));
  const iOwe = overview.totals.map((t) => ({ currency: t.currency, minor: t.iOwe }));

  return (
    <>
      <div className="hero">
        {overview.totals.length === 0 ? (
          <>
            <span className="label">Overall</span>
            <span className="big">All settled up</span>
          </>
        ) : (
          <>
            <span className="label">You are owed</span>
            <span className="big">
              {formatMoneyList(owedToMe) || formatMoney(0, overview.totals[0]!.currency)}
            </span>
            <span className="label">
              You owe {formatMoneyList(iOwe) || formatMoney(0, overview.totals[0]!.currency)}
            </span>
          </>
        )}
      </div>

      <div className="row">
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
          New group
        </Link>
      </div>

      <Card flush>
        {overview.groups.map((g) => {
          const balance = describeMyBalance(g.myBalance, g.group.currency);
          const pending = dataStore().pendingStatus(g.group.id);
          return (
            <Link key={g.group.id} href={`/groups/${g.group.id}`} className="list-row">
              <Avatar name={g.group.name} />
              <div className="grow">
                <div className="ellipsis">
                  <strong>{g.group.name}</strong>{' '}
                  {pending ? (
                    <span className="chip">
                      {pending === 'failed' ? 'Not saved' : 'Not sent yet'}
                    </span>
                  ) : null}
                </div>
                <div className="small muted">
                  {g.activeMemberCount} {g.activeMemberCount === 1 ? 'person' : 'people'}
                </div>
              </div>
              <div className={`small ${balance.tone}`} style={{ textAlign: 'right' }}>
                <div>{balance.lead}</div>
                {balance.amount ? <div className="amount">{balance.amount}</div> : null}
              </div>
            </Link>
          );
        })}
      </Card>

      <Link href="/join" className="btn ghost block">
        Join a group with a code
      </Link>
    </>
  );
}
