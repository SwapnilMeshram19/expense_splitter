import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import { AccountButton } from '@/features/auth/AccountButton';
import { startAuth } from '@/features/auth/authStore';
import { startSyncScheduler } from '@/sync/scheduler';
import { SyncIndicator } from '@/sync/SyncIndicator';
import { useTheme } from '@/ui/theme';

function HeaderActions() {
  return (
    <View style={styles.headerActions}>
      <SyncIndicator />
      <AccountButton />
    </View>
  );
}

const renderHeaderActions = () => <HeaderActions />;

export default function RootLayout() {
  const theme = useTheme();
  const { success, error } = useMigrations(db, migrations);

  // Order matters: auth links the account to local data before the scheduler's first push.
  useEffect(() => {
    if (!success) return;
    startAuth();
    startSyncScheduler();
  }, [success]);

  if (error) {
    // Never auto-delete the DB here: it may hold unsynced expenses.
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.negative, textAlign: 'center' }}>
          Could not update local data: {error.message}
        </Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardProvider>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerRight: renderHeaderActions }} />
      </Stack>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});