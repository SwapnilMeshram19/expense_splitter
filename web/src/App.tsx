import { lazy, Suspense, useSyncExternalStore } from 'react';
import { Link, Route, Switch } from 'wouter';

import { useDataStatus } from '@/data/hooks';
import { describeDataStatus } from '@/features/data/describePending';

import { ensureAccount, useAuth } from './platform/auth';
import { isOnline, isServerUnreachable, refreshNow, subscribeConnection } from './platform/data';
import { GroupScreen } from './screens/Group';
import { HomeScreen } from './screens/Home';
import { JoinScreen } from './screens/Join';
import { Icon, Message, Spinner } from './ui/kit';

// Loaded on first use: an invite link only needs the join screen, a quick look only the group.
const AccountScreen = lazy(() =>
  import('./screens/Account').then((m) => ({ default: m.AccountScreen })),
);
const ExpenseScreen = lazy(() =>
  import('./screens/Expense').then((m) => ({ default: m.ExpenseScreen })),
);
const NewGroupScreen = lazy(() =>
  import('./screens/NewGroup').then((m) => ({ default: m.NewGroupScreen })),
);
const PendingScreen = lazy(() =>
  import('./screens/Pending').then((m) => ({ default: m.PendingScreen })),
);
const SettleScreen = lazy(() =>
  import('./screens/Settle').then((m) => ({ default: m.SettleScreen })),
);

function useOnline(): boolean {
  return useSyncExternalStore(subscribeConnection, isOnline);
}

function useServerUnreachable(): boolean {
  return useSyncExternalStore(subscribeConnection, isServerUnreachable);
}

function TopBar() {
  const auth = useAuth();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Expense Splitter</span>
        </Link>
        <span className="spacer" />
        <Link
          href="/account"
          className="icon-btn"
          aria-label={auth.status === 'signedIn' ? 'Your account' : 'Save your account'}
        >
          <Icon name="person" />
        </Link>
      </div>
    </header>
  );
}

/**
 * Why something isn't saved yet, most specific first:
 * offline > account couldn't be made > server not answering > changes waiting or refused.
 */
function StatusBanners() {
  const online = useOnline();
  const unreachable = useServerUnreachable();
  const auth = useAuth();
  const status = useDataStatus();
  const view = describeDataStatus(status);

  if (!online) {
    return (
      <div className="banner warn" role="status">
        <Icon name="cloud" />
        <span>You’re offline. New expenses and payments wait here and send when you’re back.</span>
      </div>
    );
  }
  if (auth.status === 'offline') {
    return (
      <div className="banner bad" role="alert">
        <Icon name="warning" />
        <span>{auth.notice ?? 'Couldn’t start your account.'}</span>
        <button type="button" className="btn small secondary" onClick={() => void ensureAccount()}>
          Try again
        </button>
      </div>
    );
  }
  if (unreachable) {
    return (
      <div className="banner bad" role="alert">
        <Icon name="warning" />
        <span>Can’t reach the server. Your changes are kept and retried every few seconds.</span>
        <button type="button" className="btn small secondary" onClick={() => void refreshNow()}>
          Retry now
        </button>
      </div>
    );
  }
  if (!view) return null;
  return (
    <Link href="/pending" className={`banner ${view.tone === 'warning' ? 'warn' : 'info'}`}>
      <Icon name={view.tone === 'warning' ? 'warning' : 'cloud'} />
      <span>{view.label}</span>
    </Link>
  );
}

export function App() {
  return (
    <div className="app">
      <TopBar />
      <main className="page">
        <StatusBanners />
        <Suspense fallback={<Spinner />}>
          <Switch>
            <Route path="/" component={HomeScreen} />
            <Route path="/groups/new" component={NewGroupScreen} />
            <Route path="/groups/:groupId/expenses/new">
              {(p) => <ExpenseScreen groupId={p.groupId} expenseId={null} />}
            </Route>
            <Route path="/groups/:groupId/expenses/:expenseId">
              {(p) => <ExpenseScreen groupId={p.groupId} expenseId={p.expenseId} />}
            </Route>
            <Route path="/groups/:groupId/settle">
              {(p) => <SettleScreen groupId={p.groupId} />}
            </Route>
            <Route path="/groups/:groupId">{(p) => <GroupScreen groupId={p.groupId} />}</Route>
            {/* One route for /join and /join/<code>: dropping the code from the address keeps the screen. */}
            <Route path="/join/:code?">
              {(p) => (
                <div className="narrow">
                  <JoinScreen pathCode={p.code} />
                </div>
              )}
            </Route>
            <Route path="/account">
              <div className="narrow">
                <AccountScreen />
              </div>
            </Route>
            <Route path="/pending">
              <div className="narrow">
                <PendingScreen />
              </div>
            </Route>
            <Route>
              <Message title="Page not found">
                <Link href="/" className="btn">
                  Go to my groups
                </Link>
              </Message>
            </Route>
          </Switch>
        </Suspense>
      </main>
      <footer className="footer">
        <a href="/privacy/">Privacy</a>
        <a href="mailto:support@ssoftapp.in">Contact support</a>
      </footer>
    </div>
  );
}
