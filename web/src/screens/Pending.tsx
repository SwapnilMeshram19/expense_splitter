import { Link } from 'wouter';

import { dataStore } from '@/data';
import { useData } from '@/data/hooks';
import { pendingReason, pendingTitle } from '@/features/data/describePending';

import { useScreenOpen } from '../ui/hooks';
import { Card, Message } from '../ui/kit';

/** Changes waiting to send or refused by the server: never dropped silently, the person decides. */
export function PendingScreen() {
  useScreenOpen('Not saved yet');
  const ops = useData(() => dataStore().pendingOps());

  if (ops.length === 0) {
    return (
      <Message title="Everything is saved">
        <Link href="/" className="btn">
          Go to my groups
        </Link>
      </Message>
    );
  }

  return (
    <>
      <h1>Not saved yet</h1>
      <Card flush>
        {ops.map((op) => {
          const group = dataStore().group(op.groupId);
          return (
            <div key={op.requestId} className="list-row static">
              <div className="grow">
                <div className="ellipsis">
                  <strong>{pendingTitle(op.cmd, group?.group.currency ?? 'INR')}</strong>
                </div>
                <div className="small muted">
                  {group ? `${group.group.name} · ` : ''}
                  {pendingReason(op)}
                </div>
              </div>
              {op.status === 'failed' ? (
                <div className="row">
                  <button
                    type="button"
                    className="btn small secondary"
                    onClick={() => dataStore().retryOp(op.requestId)}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() =>
                      window.confirm('Discard this change? It won’t be saved.') &&
                      dataStore().discardOp(op.requestId)
                    }
                  >
                    Discard
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>
    </>
  );
}
