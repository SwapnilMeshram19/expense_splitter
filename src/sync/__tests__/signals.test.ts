import { getTheme } from '@/ui/palette';

import { planChannels, remoteSyncDelay, REMOTE_DELAY_MS, REMOTE_MIN_GAP_MS } from '../signalPlan';
import type { SyncStatus } from '../syncService';
import { describeSyncState } from '../syncState';

describe('planChannels', () => {
  it('opens new groups and closes ones that are gone', () => {
    expect(planChannels(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
  });

  it('closes everything when nothing is wanted (background, signed out, offline)', () => {
    expect(planChannels(new Set(['a', 'b']).keys(), [])).toEqual({ add: [], remove: ['a', 'b'] });
  });

  it('does nothing when already in place', () => {
    expect(planChannels(['a'], ['a'])).toEqual({ add: [], remove: [] });
  });
});

describe('remoteSyncDelay', () => {
  it('waits briefly for the first signal, then keeps a minimum gap', () => {
    expect(remoteSyncDelay(10_000, null)).toBe(REMOTE_DELAY_MS);
    expect(remoteSyncDelay(10_000, 9_000)).toBe(9_000 + REMOTE_MIN_GAP_MS - 10_000);
    expect(remoteSyncDelay(60_000, 9_000)).toBe(REMOTE_DELAY_MS);
  });
});

describe('describeSyncState', () => {
  const theme = getTheme('light', 'ocean');
  const base: SyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    message: null,
    errorCode: null,
    issueCount: 0,
    pendingCount: 0,
  };
  const view = (patch: Partial<SyncStatus>) => describeSyncState({ ...base, ...patch }, theme);

  it('says nothing when signed out', () => {
    expect(view({ state: 'signedOut' })).toBeNull();
  });

  it('stays quiet for normal states', () => {
    expect(view({ lastSyncedAt: Date.now() })?.attention).toBe(false);
    expect(view({ state: 'syncing' })?.attention).toBe(false);
    // A change about to be sent while online is normal, not something to look at.
    expect(view({ pendingCount: 2, lastSyncedAt: Date.now() })?.attention).toBe(false);
    expect(view({ errorCode: 'OFFLINE', state: 'error' })?.attention).toBe(false);
  });

  it('asks for attention for conflicts, errors and changes stuck offline', () => {
    expect(view({ issueCount: 1 })).toEqual(
      expect.objectContaining({ icon: 'syncProblem', attention: true, label: '1 change needs your attention' }),
    );
    expect(view({ state: 'error', errorCode: 'SERVER', message: 'Sync is having trouble.' })).toEqual(
      expect.objectContaining({ attention: true, label: 'Sync is having trouble.' }),
    );
    expect(view({ state: 'error', errorCode: 'OFFLINE', pendingCount: 3 })).toEqual(
      expect.objectContaining({ icon: 'cloudOff', attention: true, label: 'Offline · 3 changes saved on this phone' }),
    );
  });

  it('puts conflicts first, even when offline', () => {
    expect(view({ issueCount: 2, errorCode: 'OFFLINE', pendingCount: 1 })?.icon).toBe('syncProblem');
  });
});
