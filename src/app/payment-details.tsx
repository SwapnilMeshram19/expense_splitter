import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { appContext } from '@/db/appContext';
import { describePayDetailsError } from '@/features/payments/messages';
import { getMyPayDetails, myGroupCount, saveMyPayDetails } from '@/features/payments/myPayDetails';
import { PayDetailsEditor } from '@/features/payments/PayDetailsEditor';

/** Account → Payment details: yours, copied into every group you're in. */
export default function MyPaymentDetailsScreen() {
  const [initial] = useState(() => getMyPayDetails(appContext));
  const [groups] = useState(() => myGroupCount());

  return (
    <>
      <Stack.Screen options={{ title: 'Payment details' }} />
      <PayDetailsEditor
        initialVpa={initial?.vpa ?? null}
        initialMethods={initial?.methods ?? []}
        intro="How friends can pay you back."
        footnote={
          groups === 0
            ? 'Added to groups you create or join.'
            : `Visible to members of your ${groups === 1 ? 'group' : `${groups} groups`}, and added to new ones.`
        }
        saveLabel={groups > 1 ? `Save for all ${groups} groups` : 'Save'}
        onSave={async (vpaText, methods) => {
          const result = await saveMyPayDetails(appContext, { vpaInput: vpaText, methods });
          if (!result.ok) return describePayDetailsError(result.error, 'You');
          router.back();
          const { updatedGroups, failedGroups } = result.value;
          if (failedGroups > 0) {
            Alert.alert('Saved on this phone', `${failedGroups} group${failedGroups === 1 ? '' : 's'} couldn’t be updated. Try again when you’re online.`);
          } else if (updatedGroups > 0) {
            Alert.alert('Saved', `Updated in ${updatedGroups} group${updatedGroups === 1 ? '' : 's'}.`);
          }
          return null;
        }}
      />
    </>
  );
}
