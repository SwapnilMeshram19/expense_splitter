import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { appContext } from '@/db/appContext';
import { getMyPayDetails, myGroupCount, saveMyPayDetails } from '@/db/repositories/memberPayDetails';
import { getDeviceUserId } from '@/db/session';
import { describePayDetailsError } from '@/features/payments/messages';
import { PayDetailsEditor } from '@/features/payments/PayDetailsEditor';

/** Account → Payment details: yours, copied into every group you're in. */
export default function MyPaymentDetailsScreen() {
  const [initial] = useState(() => getMyPayDetails(appContext));
  const [groups] = useState(() => myGroupCount(appContext, getDeviceUserId()));

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
        onSave={(vpaText, methods) => {
          const result = saveMyPayDetails(appContext, { deviceUserId: getDeviceUserId(), vpaInput: vpaText, methods });
          if (!result.ok) return describePayDetailsError(result.error, 'You');
          router.back();
          if (result.value.updatedGroups > 0) {
            Alert.alert('Saved', `Updated in ${result.value.updatedGroups} group${result.value.updatedGroups === 1 ? '' : 's'}.`);
          }
          return null;
        }}
      />
    </>
  );
}
