import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { setMemberPayDetails } from '@/db/repositories/memberPayDetails';
import { methodSummary, methodTitle } from '@/domain/payMethods';
import { describePayDetailsError, iconForKind } from '@/features/payments/messages';
import { PayDetailsEditor } from '@/features/payments/PayDetailsEditor';
import { loadMemberUpiSetup } from '@/features/upi/loaders';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon, type IconName } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

/** One person's payment details in one group (placeholders, or yours for just this group). */
export default function MemberPaymentScreen() {
  const { groupId, memberId } = useLocalSearchParams<{ groupId: string; memberId: string }>();
  const theme = useTheme();
  const [setup] = useState(() => loadMemberUpiSetup(groupId, memberId));

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Payment details' }} />
        <AppText color={theme.muted}>{setup.message}</AppText>
      </View>
    );
  }

  const { member } = setup;
  const title = member.isMe ? 'Your payment details' : `${member.name}’s details`;

  if (!setup.canEdit) {
    const none = member.vpa === null && member.methods.length === 0;
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Stack.Screen options={{ title }} />
        <Card style={styles.card}>
          {member.vpa ? <Row icon="upiPay" title="UPI" value={member.vpa} /> : null}
          {member.methods.map((m, i) => (
            <Row key={i} icon={iconForKind(m.kind)} title={methodTitle(m)} value={methodSummary(m)} />
          ))}
          {none ? <AppText color={theme.muted}>Nothing added yet.</AppText> : null}
        </Card>
        <AppText variant="caption" color={theme.muted} style={styles.centerText}>
          Only {member.name} can change these.
        </AppText>
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title }} />
      <PayDetailsEditor
        initialVpa={member.vpa}
        initialMethods={member.methods}
        intro={
          member.isMe
            ? 'Just for this group.'
            : member.isPlaceholder
              ? `Check these with ${member.name}. Once they join, only they can change them.`
              : undefined
        }
        footnote={`Visible to members of “${setup.groupName}”.`}
        saveLabel="Save"
        onSave={(vpaText, methods) => {
          const result = setMemberPayDetails(appContext, {
            memberId: member.id,
            vpaInput: vpaText,
            methods,
            actorMemberId: setup.me,
          });
          if (!result.ok) return describePayDetailsError(result.error, member.name);
          router.back();
          return null;
        }}
        extra={
          member.isMe ? (
            <Button
              label="Edit for all groups"
              icon="wallet"
              variant="secondary"
              onPress={() => router.replace('/payment-details')}
            />
          ) : null
        }
      />
    </>
  );
}

function Row({ icon, title, value }: { icon: IconName; title: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Icon name={icon} color={theme.onPrimarySoft} size={20} />
      <View style={styles.grow}>
        <AppText variant="label" color={theme.muted}>
          {title}
        </AppText>
        <AppText selectable>{value}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 20, gap: 14 },
  card: { gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  centerText: { textAlign: 'center' },
});
