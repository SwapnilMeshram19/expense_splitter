import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';

export default function RootLayout() {
  const { success, error } = useMigrations(db, migrations);

  if (error) {
    // Never auto-delete the DB here: it may hold unsynced expenses.
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Could not update local data: {error.message}</Text>
      </View>
    );
  }

  if (!success) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Stack screenOptions={{ headerTitle: 'Expense Splitter' }} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#b00020', textAlign: 'center' },
});