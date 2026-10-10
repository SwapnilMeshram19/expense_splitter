import { useState, type ReactElement } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { useTheme } from '@/ui/theme';

import { syncNow, useSyncStatus } from './syncService';

/**
 * Pull-to-refresh that runs a sync, for FlashList / ScrollView `refreshControl`.
 * Undefined when signed out: everything is local then, so there is nothing to refresh.
 *
 * The spinner tracks only the sync the user started here; background syncs never make it
 * appear on their own.
 */
export function useSyncRefreshControl(): ReactElement<RefreshControlProps> | undefined {
  const theme = useTheme();
  const sync = useSyncStatus();
  const [refreshing, setRefreshing] = useState(false);

  if (sync.state === 'signedOut') return undefined;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await syncNow(); // never throws: problems show up in the sync status instead
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      colors={[theme.primary]}
      tintColor={theme.primary}
      progressBackgroundColor={theme.surface}
    />
  );
}
