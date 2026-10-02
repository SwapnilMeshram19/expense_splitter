import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import { AccountButton } from '@/features/auth/AccountButton';
import { startAuth } from '@/features/auth/authStore';
import { useTheme } from '@/ui/theme';

const renderAccountButton = () => <AccountButton />;

export default function RootLayout() {
  const theme = useTheme();
  const { success, error } = useMigrations(db, migrations);

  // Auth binds the account to local data, so it starts only after migrations.
  useEffect(() => {
    if (success) startAuth();
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
        <Stack.Screen name="index" options={{ headerRight: renderAccountButton }} />
      </Stack>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});