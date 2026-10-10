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
      'Its history on this phone will be deleted. Nothing changes for the people still in the group.',
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
      title="You no longer have access to this group"
      body="Someone may have removed you. You can still read what’s saved on this phone, but it can’t be changed. If you’re added back, it updates on the next sync."
    >
      <Button label="Remove from this phone" variant="danger" onPress={confirmForget} />
    </Banner>
  );
}
