import { useCallback } from 'react';
import { Linking, StyleSheet, Switch, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { useLiveData } from '@/db/hooks/useLiveData';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { useTheme } from '@/ui/theme';

import {
  refreshWeeklyReminder,
  requestPermission,
  syncPushRegistration,
  usePermissionState,
} from './notifications';
import { getNotificationPrefs, setNotificationPrefs, type NotificationPrefs } from './prefs';

const ROWS: readonly {
  key: keyof NotificationPrefs;
  title: string;
  detail: string;
  push: boolean;
}[] = [
  {
    key: 'expenses',
    title: 'New expenses',
    detail: 'Expenses you’re part of',
    push: true,
  },
  {
    key: 'payments',
    title: 'Payments',
    detail: 'Payments to or from you',
    push: true,
  },
  {
    key: 'budget',
    title: 'Budget alerts',
    detail: 'At 80% and when over',
    push: true,
  },
  {
    key: 'weekly',
    title: 'Weekly reminder',
    detail: 'Sunday evening, if anything is unsettled',
    push: false,
  },
];

const TABLES = ['settings'] as const;
const loadPrefs = () => getNotificationPrefs(appContext);

/** Account tab: which notifications this phone gets. */
export function NotificationsCard({ signedIn }: { signedIn: boolean }) {
  const theme = useTheme();
  const prefs = useLiveData(TABLES, loadPrefs);
  const permission = usePermissionState();

  const apply = useCallback(() => {
    void syncPushRegistration();
    void refreshWeeklyReminder();
  }, []);

  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    setNotificationPrefs(appContext, { [key]: value });
    // Turning something on is the moment to ask Android, not before.
    if (value && permission === 'undetermined') await requestPermission();
    apply();
  };

  if (permission === 'unavailable') {
    return (
      <Card style={styles.card}>
        <AppText variant="heading" accessibilityRole="header">
          Notifications
        </AppText>
        <AppText color={theme.muted}>Update the app to get notifications.</AppText>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <AppText variant="heading" accessibilityRole="header">
        Notifications
      </AppText>

      {permission === 'denied' ? (
        <View style={[styles.notice, { backgroundColor: theme.warningSoft }]}>
          <AppText variant="label" color={theme.warning}>
            Turned off in your phone’s settings.
          </AppText>
          <Button
            label="Open settings"
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        </View>
      ) : permission === 'undetermined' ? (
        <Button
          label="Turn on notifications"
          icon="notifications"
          variant="soft"
          onPress={() => void requestPermission().then((granted) => granted && apply())}
        />
      ) : null}

      {ROWS.map((row) => {
        const disabled = row.push && !signedIn;
        return (
          <View key={row.key} style={styles.row}>
            <View style={styles.grow}>
              <AppText variant="body" style={styles.medium}>
                {row.title}
              </AppText>
              <AppText variant="caption" color={theme.muted}>
                {disabled ? 'Sign in to get these' : row.detail}
              </AppText>
            </View>
            <Switch
              value={prefs[row.key] && !disabled}
              disabled={disabled || permission === 'denied'}
              onValueChange={(value) => void toggle(row.key, value)}
              trackColor={{ true: theme.primary, false: theme.surfaceAlt }}
              thumbColor={theme.surface}
              accessibilityLabel={row.title}
              accessibilityHint={row.detail}
            />
          </View>
        );
      })}

      <AppText variant="caption" color={theme.muted}>
        Never includes notes or receipts.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  notice: { borderRadius: 12, padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  grow: { flex: 1, minWidth: 0 },
  medium: { fontWeight: '500' },
});
