import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { appContext } from '@/db/appContext';
import { formatPaise } from '@/domain/money';
import { useTheme } from '@/ui/theme';

import { getPendingUpiPayment, type PendingUpiPayment } from './pendingUpiPayment';

/** Reminder for a UPI payment that was started but never confirmed (e.g. app killed meanwhile). */
export function PendingUpiBanner({ groupId, nameOf }: { groupId: string; nameOf: (memberId: string) => string }) {
  const theme = useTheme();
  const [pending, setPending] = useState<PendingUpiPayment | null>(null);

  // Settings changes don't trigger useLiveData, so re-read on every focus.
  useFocusEffect(
    useCallback(() => {
      const p = getPendingUpiPayment(appContext);
      setPending(p && p.groupId === groupId ? p : null);
    }, [groupId]),
  );

  if (!pending) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/groups/[groupId]/pay',
          params: { groupId, to: pending.toMemberId, amount: String(pending.amountPaise) },
        })
      }
      style={[styles.banner, { borderColor: theme.warning, backgroundColor: theme.surface }]}
    >
      <Text style={{ color: theme.text }}>
        Did your UPI payment of {formatPaise(pending.amountPaise)} to {nameOf(pending.toMemberId)} go through?
      </Text>
      <Text style={{ color: theme.primary, fontWeight: '600' }}>Confirm</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
});