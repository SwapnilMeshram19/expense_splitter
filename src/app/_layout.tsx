import { MaterialSymbols_400Regular } from '@expo-google-fonts/material-symbols/400Regular';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';
import { startAuth } from '@/features/auth/authStore';
import { startRegionPreference } from '@/features/region/deviceLocales';
import { startReceiptQueue } from '@/features/receipts/receiptStorage';
import { startSyncScheduler } from '@/sync/scheduler';
import { applyNativeColorScheme, useTheme } from '@/ui/theme';
import { loadThemePreference, subscribeThemePreference, useThemePreference } from '@/ui/themePreference';

export default function RootLayout() {
  const theme = useTheme();
  const preference = useThemePreference();
  const { success, error } = useMigrations(db, migrations);
  // Start loading the Android icon font while migrations run, so icons don't pop in later.
  useFonts({ MaterialSymbols_400Regular });

  // Order matters: the saved theme first (it gates the first real render), then auth links the
  // account to local data before the scheduler's first push.
  useEffect(() => {
    if (!success) return;
    applyNativeColorScheme(loadThemePreference(appContext).mode);
    const unsubscribe = subscribeThemePreference((pref) => applyNativeColorScheme(pref.mode));
    // Home currency and rupee grouping, before the first screen formats any amount.
    const stopRegion = startRegionPreference();
    startAuth();
    // Receipt photos follow their expenses: upload/clean up after each successful sync.
    const stopReceipts = startReceiptQueue();
    startSyncScheduler();
    return () => {
      unsubscribe();
      stopRegion();
      stopReceipts();
    };
  }, [success]);

  // The window background shows during transitions and behind the keyboard: keep it on-theme.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background);
  }, [theme.background]);

  const statusBar = <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />;

  if (error) {
    // Never auto-delete the DB here: it may hold unsynced expenses.
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        {statusBar}
        <Text style={{ color: theme.negative, textAlign: 'center' }}>
          Could not update local data: {error.message}
        </Text>
      </View>
    );
  }

  if (!success || !preference.loaded) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        {statusBar}
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardProvider>
      {statusBar}
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerTitleStyle: { fontFamily: theme.fontFamily, fontWeight: '600', fontSize: 18 },
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
        <Stack.Screen name="pick-group" options={{ title: 'Add expense to', presentation: 'modal' }} />
      </Stack>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
