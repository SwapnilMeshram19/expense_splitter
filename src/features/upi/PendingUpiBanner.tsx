import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { appContext } from '@/db/appContext';
import { formatPaise } from '@/domain/money';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';

import { getPendingUpiPayment, type PendingUpiPayment } from './pendingUpiPayment';

/** Reminder for a UPI payment that was started but never confirmed (e.g. app killed meanwhile). */
export function PendingUpiBanner({ groupId, nameOf }: { groupId: string; nameOf: (memberId: string) => string }) {
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
    <Banner
      tone="warning"
      icon="pending"
      title="Did your UPI payment go through?"
      body={`${formatPaise(pending.amountPaise)} to ${nameOf(pending.toMemberId)}`}
    >
      <Button
        label="Confirm"
        onPress={() =>
          router.push({
            pathname: '/groups/[groupId]/pay',
            params: { groupId, to: pending.toMemberId, amount: String(pending.amountPaise) },
          })
        }
      />
    </Banner>
  );
}
