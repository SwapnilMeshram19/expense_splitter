import { router } from 'expo-router';
import { Alert } from 'react-native';

import { appContext } from '@/db/appContext';
import { removeSampleGroup } from '@/db/repositories/sampleGroup';
import { deleteLocalReceipt } from '@/features/receipts/receiptFiles';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';

/** Ask, then delete the example group from this phone and go Home. */
export function confirmRemoveSample(groupId: string): void {
  Alert.alert('Delete the example group?', 'It was only on this phone. Your own groups aren’t affected.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () => {
        const result = removeSampleGroup(appContext, groupId);
        if (!result.ok) return;
        // Photos someone attached while trying it out.
        for (const id of result.value.receiptIds) {
          try {
            deleteLocalReceipt(id);
          } catch {
            // Already gone: nothing to clean up.
          }
        }
        router.dismissTo('/');
      },
    },
  ]);
}

/** Top of the example group's screen: what it is, and the way out. */
export function SampleBanner({ groupId }: { groupId: string }) {
  return (
    <Banner
      tone="info"
      icon="sparkle"
      title="This is an example group"
      body="Tap an expense to see how it’s split, add one, or try Settle up. It stays on your phone and isn’t shared."
    >
      <Button label="Start your own group" icon="add" size="sm" variant="soft" onPress={() => router.push('/groups/new')} />
      <Button label="Delete example" icon="delete" size="sm" variant="danger" onPress={() => confirmRemoveSample(groupId)} />
    </Banner>
  );
}
