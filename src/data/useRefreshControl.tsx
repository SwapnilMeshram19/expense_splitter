/**
 * Android: pull-to-refresh for list screens, plus a refetch when the screen comes into view (if
 * the last one is older than 30 s). Undefined before the account exists: nothing to fetch yet.
 *
 * The spinner tracks only the refresh the person started; background refetches never show it.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { useTheme } from '@/ui/theme';

import { dataStore, PENDING_USER } from './index';
import { refreshIfStale, refreshNow } from './native';

export function useRefreshControl(): ReactElement<RefreshControlProps> | undefined {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshIfStale();
    }, []),
  );

  const user = dataStore().getUserId();
  if (!user || user === PENDING_USER) return undefined;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshNow(); // never throws: problems show up in the data status instead
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
