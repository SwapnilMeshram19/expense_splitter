import { router } from 'expo-router';
import { Alert } from 'react-native';

import { appContext } from '@/db/appContext';
import { forgetGroupLocally } from '@/sync/lostGroups';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';

export function LostAccessBanner({ groupId, groupName }: { groupId: string; groupName: string }) {
  const confirmForget = () =>
    Alert.alert(
      `Remove “${groupName}” from this phone?`,
      'Deletes it from this phone only.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const result = forgetGroupLocally(appContext, groupId);
            if (result.ok) router.dismissTo('/');
            else Alert.alert('Not removed', 'You have access to this group again.');
          },
        },
      ],
    );

  return (
    <Banner
      tone="warning"
      icon="lock"
      title="You no longer have access"
      body="Read-only. If you’re added back, it updates automatically."
    >
      <Button label="Remove from this phone" variant="danger" onPress={confirmForget} />
    </Banner>
  );
}
