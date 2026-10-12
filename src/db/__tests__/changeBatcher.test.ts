import { createChangeBatcher } from '../hooks/changeBatcher';

function setup() {
  const queued: (() => void)[] = [];
  const batcher = createChangeBatcher(100, { setTimeout: (fn) => queued.push(fn) });
  const notify = jest.fn();
  batcher.subscribe(notify);
  const tick = () => queued.splice(0).forEach((fn) => fn());
  return { batcher, notify, queued, tick };
}

describe('change batcher', () => {
  it('turns a burst of row events into one notification', () => {
    const { batcher, notify, queued, tick } = setup();
    for (let i = 0; i < 500; i++) batcher.record(i % 2 ? 'expenses' : 'expense_shares');
    expect(queued).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    expect(batcher.snapshot(['expenses'])).toBe('0'); // nothing published yet

    tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(batcher.snapshot(['expenses', 'expense_shares', 'groups'])).toBe('250:250:0');
  });

  it('schedules again after a flush', () => {
    const { batcher, notify, queued, tick } = setup();
    batcher.record('groups');
    tick();
    batcher.record('groups');
    expect(queued).toHaveLength(1);
    tick();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(batcher.snapshot(['groups'])).toBe('2');
  });

  it('flushes on demand and stops notifying after unsubscribe', () => {
    const queued: (() => void)[] = [];
    const batcher = createChangeBatcher(100, { setTimeout: (fn) => queued.push(fn) });
    const notify = jest.fn();
    const unsubscribe = batcher.subscribe(notify);
    batcher.record('settings');
    batcher.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    queued.splice(0).forEach((fn) => fn()); // the timer firing later publishes nothing new
    expect(notify).toHaveBeenCalledTimes(1);

    unsubscribe();
    batcher.record('settings');
    batcher.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(batcher.snapshot(['settings'])).toBe('2');
  });
});
