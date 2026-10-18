import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { isSampleGroup } from '@/db/repositories/sampleIds';
import {
  deleteGroup,
  getGroup,
  isCurrencyLocked,
  renameGroup,
  setGroupCurrency,
  setSimplifyDebts,
} from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import {
  activeMembersQuery,
  addMember,
  findSelfMemberId,
  removeMember,
  renameMember,
} from '@/db/repositories/members';
import { MAX_NAME_LENGTH } from '@/db/repositories/names';
import type { Group } from '@/db/schema';
import { getDeviceUserId } from '@/db/session';
import { computeBalances } from '@/domain/balances';
import { formatMoney, type CurrencyCode } from '@/domain/currency';
import {
  describeGroupCurrencyError,
  describeGroupDeleteError,
  describeGroupUpdateError,
  describeMemberError,
} from '@/features/groups/messages';
import { getRegionPreference } from '@/features/region/regionPreference';
import { methodTitle, parsePayMethods } from '@/domain/payMethods';
import { isValidVpa } from '@/domain/upi';
import { BudgetEditor } from '@/features/groups/BudgetEditor';
import { isGroupLost } from '@/db/repositories/access';
import { LostAccessBanner } from '@/features/groups/LostAccessBanner';
import { confirmRemoveSample } from '@/features/groups/SampleBanner';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CurrencyPicker } from '@/ui/CurrencyPicker';
import { FieldLabel, Input } from '@/ui/Field';
import { Icon, type IconName } from '@/ui/Icon';
import { ListRow, listCardStyle } from '@/ui/ListRow';
import { useTheme } from '@/ui/theme';

const TABLES = ['groups', 'members', 'expenses', 'expense_payers', 'expense_shares', 'settlements'];

interface MemberRow {
  id: string;
  displayName: string;
  balance: number;
  /** "UPI · PayPal", or null when nothing is added. */
  payWith: string | null;
}

function payWithSummary(m: { upiVpa: string | null; payMethods: string | null }): string | null {
  const parts = [...(isValidVpa(m.upiVpa) ? ['UPI'] : []), ...parsePayMethods(m.payMethods).map(methodTitle)];
  return parts.length > 0 ? parts.join(' · ') : null;
}

function loadSettingsView(groupId: string) {
  const group = getGroup(db, groupId);
  if (!group) return null;
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  const ledger = loadGroupLedger(db, groupId);
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);
  const members: MemberRow[] = activeMembersQuery(db, groupId)
    .all()
    .map((m) => ({
      id: m.id,
      displayName: m.displayName,
      balance: balances.get(m.id) ?? 0,
      payWith: payWithSummary(m),
    }));
  return {
    group,
    me,
    members,
    lost: isGroupLost(db, groupId),
    currencyLocked: isCurrencyLocked(db, groupId),
    sample: isSampleGroup(db, groupId),
  };
}

function confirmDeleteGroup(group: Group, actorMemberId: string | null) {
  Alert.alert(
    `Delete “${group.name}”?`,
    'It’s removed for everyone in the group.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const result = deleteGroup(appContext, { groupId: group.id, actorMemberId });
          if (result.ok) router.dismissTo('/');
          else Alert.alert('Can’t delete yet', describeGroupDeleteError(result.error));
        },
      },
    ],
  );
}

export default function GroupSettingsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const compute = useCallback(() => loadSettingsView(groupId), [groupId]);
  const view = useLiveData(TABLES, compute);

  if (!view) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Group settings' }} />
        <AppText color={theme.muted}>This group no longer exists.</AppText>
      </View>
    );
  }

  if (view.lost) {
    return (
      <View style={styles.padded}>
        <Stack.Screen options={{ title: 'Group settings' }} />
        <LostAccessBanner groupId={groupId} groupName={view.group.name} />
      </View>
    );
  }

  if (!view.me) {
    return (
      <View style={styles.padded}>
        <Stack.Screen options={{ title: 'Group settings' }} />
        <Card style={styles.card}>
          <AppText variant="heading">You’re not in “{view.group.name}”</AppText>
          <AppText color={theme.muted}>So you can’t change it. You can delete it from this phone.</AppText>
          <Button label="Delete group" icon="delete" variant="danger" onPress={() => confirmDeleteGroup(view.group, null)} />
        </Card>
      </View>
    );
  }

  return (
    <SettingsForm
      group={view.group}
      me={view.me}
      members={view.members}
      currencyLocked={view.currencyLocked}
      sample={view.sample}
    />
  );
}

function balanceLabel(balance: number, currency: CurrencyCode): string {
  if (balance > 0) return `gets back ${formatMoney(balance, currency)}`;
  if (balance < 0) return `owes ${formatMoney(-balance, currency)}`;
  return 'settled';
}

type ErrorAt = 'group' | 'simplify' | 'people';

function SettingsForm({
  group,
  me,
  members,
  currencyLocked,
  sample,
}: {
  group: Group;
  me: string;
  members: MemberRow[];
  /** The group has expenses or payments (deleted ones too): its currency can't change. */
  currencyLocked: boolean;
  /** Example group: can't be shared; deleting removes it from this phone at once. */
  sample: boolean;
}) {
  const theme = useTheme();
  const { currency } = group;
  const [groupName, setGroupName] = useState(group.name);
  const [newMemberName, setNewMemberName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // Errors show in the card where the action happened, not at the bottom of a long screen.
  const [error, setError] = useState<{ at: ErrorAt; text: string } | null>(null);
  const fail = (at: ErrorAt, text: string) => setError({ at, text });
  const errorFor = (at: ErrorAt) =>
    error?.at === at ? (
      <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
        {error.text}
      </AppText>
    ) : null;

  const nameChanged = groupName.trim() !== group.name && groupName.trim() !== '';
  const open = (pathname: '/groups/[groupId]/invite' | '/groups/[groupId]/recurring') =>
    router.push({ pathname, params: { groupId: group.id } });

  const saveGroupName = () => {
    const result = renameGroup(appContext, { groupId: group.id, name: groupName, actorMemberId: me });
    if (result.ok) setError(null);
    else fail('group', describeGroupUpdateError(result.error));
  };

  const toggleSimplify = (value: boolean) => {
    const result = setSimplifyDebts(appContext, { groupId: group.id, simplifyDebts: value, actorMemberId: me });
    if (!result.ok) fail('simplify', describeGroupUpdateError(result.error));
  };

  const changeCurrency = (next: CurrencyCode) => {
    const result = setGroupCurrency(appContext, { groupId: group.id, currency: next, actorMemberId: me });
    if (result.ok) setError(null);
    else fail('group', describeGroupCurrencyError(result.error));
  };

  const add = () => {
    if (newMemberName.trim() === '') return;
    const result = addMember(appContext, { groupId: group.id, displayName: newMemberName, actorMemberId: me });
    if (!result.ok) {
      fail('people', describeMemberError(result.error, currency));
      return;
    }
    setNewMemberName('');
    setError(null);
  };

  const startRename = (member: MemberRow) => {
    setEditingId(member.id);
    setEditName(member.displayName);
    setError(null);
  };

  const saveRename = () => {
    if (!editingId) return;
    const result = renameMember(appContext, { memberId: editingId, displayName: editName, actorMemberId: me });
    if (!result.ok) {
      fail('people', describeMemberError(result.error, currency));
      return;
    }
    setEditingId(null);
    setError(null);
  };

  const confirmRemove = (member: MemberRow) => {
    if (member.balance !== 0) {
      Alert.alert(
        `Can’t remove ${member.displayName} yet`,
        `${member.displayName} ${balanceLabel(member.balance, currency)}. Settle up first.`,
      );
      return;
    }
    Alert.alert(`Remove ${member.displayName}?`, 'Past expenses keep their name.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const result = removeMember(appContext, { memberId: member.id, actorMemberId: me });
          if (!result.ok) Alert.alert('Could not remove', describeMemberError(result.error, currency));
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Group settings' }} />
      <KeyboardAwareScrollView
        bottomOffset={62}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={listCardStyle}>
          {sample ? null : (
            <ListRow icon="personAdd" title="Invite people" onPress={() => open('/groups/[groupId]/invite')} />
          )}
          <ListRow
            icon="wallet"
            title="Your payment details"
            detail={members.find((m) => m.id === me)?.payWith ?? 'Add'}
            onPress={() =>
              router.push({
                pathname: '/groups/[groupId]/members/[memberId]/payment',
                params: { groupId: group.id, memberId: me },
              })
            }
          />
          <ListRow
            icon="repeat"
            title="Repeating expenses"
            detail="Rent, Wi-Fi…"
            onPress={() => open('/groups/[groupId]/recurring')}
            last
          />
        </Card>

        <Card style={styles.card}>
          <FieldLabel>Group name</FieldLabel>
          <View style={styles.inlineRow}>
            <Input
              value={groupName}
              onChangeText={(text) => {
                setGroupName(text);
                setError(null);
              }}
              maxLength={MAX_NAME_LENGTH}
              accessibilityLabel="Group name"
              returnKeyType="done"
              onSubmitEditing={() => nameChanged && saveGroupName()}
              style={styles.grow}
            />
            {nameChanged ? <Button label="Save" size="md" onPress={saveGroupName} /> : null}
          </View>

          <FieldLabel>Currency</FieldLabel>
          <CurrencyPicker
            label="Group currency"
            value={currency}
            onChange={changeCurrency}
            pinned={[getRegionPreference().homeCurrency]}
            disabled={currencyLocked}
          />
          <AppText variant="caption" color={theme.muted}>
            {currencyLocked ? 'Locked once the group has expenses.' : 'Can change until the first expense.'}
          </AppText>
          {errorFor('group')}
        </Card>

        <Card style={styles.card}>
          <AppText variant="heading" accessibilityRole="header">
            Budget
          </AppText>
          <BudgetEditor key={`${group.budgetPaise}-${group.budgetPeriod}-${group.currency}`} group={group} me={me} />
        </Card>

        <Card style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.grow}>
              <AppText variant="body" style={styles.medium}>
                Simplify debts
              </AppText>
              <AppText variant="caption" color={theme.muted}>
                Fewest payments to settle up.
              </AppText>
            </View>
            <Switch
              value={group.simplifyDebts}
              onValueChange={toggleSimplify}
              accessibilityLabel="Simplify debts"
              trackColor={{ false: theme.surfaceAlt, true: theme.primary }}
              thumbColor={theme.surface}
              ios_backgroundColor={theme.surfaceAlt}
            />
          </View>
          {errorFor('simplify')}
        </Card>

        <Card style={styles.card}>
          <AppText variant="heading" accessibilityRole="header">
            People · {members.length}
          </AppText>
          {members.map((member, index) => {
            const isMe = member.id === me;
            const divider = index < members.length - 1 && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth };
            if (editingId === member.id) {
              return (
                <View key={member.id} style={[styles.memberRow, divider]}>
                  <Input
                    value={editName}
                    onChangeText={(text) => {
                      setEditName(text);
                      setError(null);
                    }}
                    maxLength={MAX_NAME_LENGTH}
                    accessibilityLabel={`New name for ${member.displayName}`}
                    returnKeyType="done"
                    onSubmitEditing={saveRename}
                    style={styles.grow}
                    autoFocus
                  />
                  <IconButton icon="check" label="Save name" color={theme.primary} onPress={saveRename} />
                  <IconButton icon="close" label="Cancel" color={theme.muted} onPress={() => setEditingId(null)} />
                </View>
              );
            }
            return (
              <View key={member.id} style={[styles.memberRow, divider]}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: '/groups/[groupId]/members/[memberId]/payment',
                      params: { groupId: group.id, memberId: member.id },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${member.displayName}, payment details`}
                  style={({ pressed }) => [styles.memberMain, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Avatar seed={member.id} name={member.displayName} size={36} />
                  <View style={styles.grow}>
                    <AppText style={styles.medium} numberOfLines={1}>
                      {member.displayName}
                      {isMe ? ' (you)' : ''}
                    </AppText>
                    <AppText variant="caption" color={theme.muted} numberOfLines={1}>
                      {balanceLabel(member.balance, currency)} · {member.payWith ?? 'add payment details'}
                    </AppText>
                  </View>
                </Pressable>
                <IconButton
                  icon="edit"
                  label={`Rename ${member.displayName}`}
                  color={theme.muted}
                  onPress={() => startRename(member)}
                />
                {!isMe ? (
                  <IconButton
                    icon="personRemove"
                    label={`Remove ${member.displayName}`}
                    color={theme.negative}
                    onPress={() => confirmRemove(member)}
                  />
                ) : (
                  <View style={styles.iconSpacer} />
                )}
              </View>
            );
          })}
          <View style={styles.inlineRow}>
            <Input
              value={newMemberName}
              onChangeText={(text) => {
                setNewMemberName(text);
                setError(null);
              }}
              placeholder="Add a person"
              maxLength={MAX_NAME_LENGTH}
              accessibilityLabel="New person’s name"
              onSubmitEditing={add}
              returnKeyType="done"
              style={styles.grow}
            />
            <Button label="Add" icon="add" variant="soft" onPress={add} disabled={newMemberName.trim() === ''} />
          </View>
          {errorFor('people')}
        </Card>

        <Button
          label={sample ? 'Delete example group' : 'Delete group'}
          icon="delete"
          variant="danger"
          onPress={() => (sample ? confirmRemoveSample(group.id) : confirmDeleteGroup(group, me))}
        />
        <AppText variant="caption" color={theme.muted} style={styles.centerText}>
          Everyone must be settled up first.
        </AppText>
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

/** 44×44 icon-only action inside a row. */
function IconButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: IconName;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} color={color} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  padded: { padding: 20 },
  container: { paddingHorizontal: 20, paddingTop: 8, gap: 14, paddingBottom: 48 },
  card: { gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  medium: { fontWeight: '500' },
  centerText: { textAlign: 'center' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 56, paddingVertical: 4 },
  memberMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  iconSpacer: { width: 44 },
});
