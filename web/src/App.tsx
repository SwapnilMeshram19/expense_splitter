import { lazy, Suspense, useSyncExternalStore } from 'react';
import { Link, Route, Switch } from 'wouter';

import { useDataStatus } from '@/data/hooks';
import { describeDataStatus } from '@/features/data/describePending';

import { useAuth } from './platform/auth';
import { isOnline, subscribeConnection } from './platform/data';
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

function StatusBanners() {
  const online = useOnline();
  const view = describeDataStatus(useDataStatus());
  return (
    <>
      {!online ? (
        <div className="banner warn" role="status">
          <Icon name="cloud" /> You’re offline. New expenses and payments are saved and sent later;
          edits need the internet.
        </div>
      ) : null}
      {view ? (
        <Link href="/pending" className={`banner ${view.tone === 'warning' ? 'warn' : 'info'}`}>
          {view.label}
        </Link>
      ) : null}
    </>
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
            <Route path="/join/:code?">{(p) => <JoinScreen pathCode={p.code} />}</Route>
            <Route path="/account" component={AccountScreen} />
            <Route path="/pending" component={PendingScreen} />
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
        <a href="/privacy/">Privacy</a> ·{' '}
        <a href="mailto:support@ssoftapp.in">support@ssoftapp.in</a>
      </footer>
    </div>
  );
}
