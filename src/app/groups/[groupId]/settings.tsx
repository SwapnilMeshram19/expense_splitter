import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
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
import { CurrencyPicker } from '@/ui/CurrencyPicker';
import { useTheme, type Theme } from '@/ui/theme';
import { Text, TextInput } from '@/ui/Text';
import { isGroupLost } from '@/db/repositories/access';
import { LostAccessBanner } from '@/features/groups/LostAccessBanner';

const TABLES = ['groups', 'members', 'expenses', 'expense_payers', 'expense_shares', 'settlements'];

interface MemberRow {
  id: string;
  displayName: string;
  balance: number;
}

function loadSettingsView(groupId: string) {
  const group = getGroup(db, groupId);
  if (!group) return null;
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  const ledger = loadGroupLedger(db, groupId);
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);
  const members: MemberRow[] = activeMembersQuery(db, groupId)
    .all()
    .map((m) => ({ id: m.id, displayName: m.displayName, balance: balances.get(m.id) ?? 0 }));
  return {
    group,
    me,
    members,
    lost: isGroupLost(db, groupId),
    currencyLocked: isCurrencyLocked(db, groupId),
  };
}

function confirmDeleteGroup(group: Group, actorMemberId: string | null) {
  Alert.alert(
    `Delete “${group.name}”?`,
    'The group and its history will be removed from your list.',
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
        <Text style={{ color: theme.muted }}>This group no longer exists.</Text>
      </View>
    );
  }
    if (view.lost) {
    return (
      <View style={[styles.center, { padding: 16 }]}>
        <Stack.Screen options={{ title: 'Group settings' }} />
        <LostAccessBanner groupId={groupId} groupName={view.group.name} />
      </View>
    );
  }

  if (!view.me) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Group settings' }} />
        <Text style={[styles.notMember, { color: theme.text }]}>
          You’re not a member of “{view.group.name}”, so you can’t change it.
        </Text>
        <Text style={[styles.notMember, { color: theme.muted }]}>
          This usually means it was created before you set up your name, for example while testing.
        </Text>
        <Pressable onPress={() => confirmDeleteGroup(view.group, null)} style={styles.dangerButton}>
          <Text style={{ color: theme.negative, fontWeight: '600' }}>Delete group</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SettingsForm
      group={view.group}
      me={view.me}
      members={view.members}
      currencyLocked={view.currencyLocked}
    />
  );
}

function balanceLabel(balance: number, currency: CurrencyCode): string {
  if (balance > 0) return `is owed ${formatMoney(balance, currency)}`;
  if (balance < 0) return `owes ${formatMoney(-balance, currency)}`;
  return 'settled';
}

function SettingsForm({
  group,
  me,
  members,
  currencyLocked,
}: {
  group: Group;
  me: string;
  members: MemberRow[];
  /** The group has expenses or payments (deleted ones too): its currency can't change. */
  currencyLocked: boolean;
}) {
  const theme = useTheme();
  const { currency } = group;
  const [groupName, setGroupName] = useState(group.name);
  const [newMemberName, setNewMemberName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const input = inputStyle(theme);
  const nameChanged = groupName.trim() !== group.name;

  const saveGroupName = () => {
    const result = renameGroup(appContext, { groupId: group.id, name: groupName, actorMemberId: me });
    setError(result.ok ? null : describeGroupUpdateError(result.error));
  };

  const toggleSimplify = (value: boolean) => {
    const result = setSimplifyDebts(appContext, { groupId: group.id, simplifyDebts: value, actorMemberId: me });
    if (!result.ok) setError(describeGroupUpdateError(result.error));
  };

  const changeCurrency = (next: CurrencyCode) => {
    const result = setGroupCurrency(appContext, { groupId: group.id, currency: next, actorMemberId: me });
    setError(result.ok ? null : describeGroupCurrencyError(result.error));
  };

  const add = () => {
    const result = addMember(appContext, { groupId: group.id, displayName: newMemberName, actorMemberId: me });
    if (!result.ok) {
      setError(describeMemberError(result.error, currency));
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
      setError(describeMemberError(result.error, currency));
      return;
    }
    setEditingId(null);
    setError(null);
  };

  const confirmRemove = (member: MemberRow) => {
    if (member.balance !== 0) {
      Alert.alert(
        `Can’t remove ${member.displayName} yet`,
        `${member.displayName} ${balanceLabel(member.balance, currency)}. Record the payments first, then remove them.`,
      );
      return;
    }
    Alert.alert(
      `Remove ${member.displayName}?`,
      'They won’t appear in new expenses. Past expenses keep their name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const result = removeMember(appContext, { memberId: member.id, actorMemberId: me });
            if (!result.ok) Alert.alert('Could not remove', describeMemberError(result.error, currency));
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Group settings' }} />
      <KeyboardAwareScrollView
        bottomOffset={62}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
         <Pressable
          onPress={() => router.push({ pathname: '/groups/[groupId]/invite', params: { groupId: group.id } })}
          style={[styles.row, styles.linkRow, { borderColor: theme.border }]}
          accessibilityRole="button"
        >
          <Text style={[styles.flex, { color: theme.text, fontSize: 16 }]}>Invite people</Text>
          <Text style={{ color: theme.muted }}>Share a link ›</Text>
        </Pressable>

        <Text style={[styles.label, { color: theme.muted }]}>Group name</Text>
        <View style={styles.row}>
          <TextInput
            value={groupName}
            onChangeText={(text) => {
              setGroupName(text);
              setError(null);
            }}
            maxLength={MAX_NAME_LENGTH}
            style={[input, styles.flex]}
          />
          {nameChanged ? (
            <Pressable onPress={saveGroupName} style={styles.inlineButton}>
              <Text style={{ color: theme.primary, fontWeight: '600' }}>Save</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.label, { color: theme.muted }]}>Currency</Text>
        <CurrencyPicker
          label="Group currency"
          value={currency}
          onChange={changeCurrency}
          disabled={currencyLocked}
        />
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          {currencyLocked
            ? 'Balances are kept in this currency, so it can’t change once there are expenses or payments. Bills in other currencies are converted when you add them.'
            : 'Every balance in the group is kept in this currency. You can change it until the first expense or payment.'}
        </Text>

        <View style={[styles.row, styles.switchRow]}>
          <View style={styles.flex}>
            <Text style={{ color: theme.text, fontSize: 16 }}>Simplify debts</Text>
            <Text style={{ color: theme.muted, fontSize: 13 }}>
              Suggest the fewest payments to settle everyone, even between people who didn’t share
              an expense. Balances stay the same either way.
            </Text>
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

        <Text style={[styles.label, { color: theme.muted }]}>People</Text>
        {members.map((member) => {
          const isMe = member.id === me;
          if (editingId === member.id) {
            return (
              <View key={member.id} style={styles.row}>
                <TextInput
                  value={editName}
                  onChangeText={(text) => {
                    setEditName(text);
                    setError(null);
                  }}
                  maxLength={MAX_NAME_LENGTH}
                  style={[input, styles.flex]}
                  autoFocus
                />
                <Pressable onPress={saveRename} style={styles.inlineButton}>
                  <Text style={{ color: theme.primary, fontWeight: '600' }}>Save</Text>
                </Pressable>
                <Pressable onPress={() => setEditingId(null)} style={styles.inlineButton}>
                  <Text style={{ color: theme.muted }}>Cancel</Text>
                </Pressable>
              </View>
            );
          }
          return (
            <View key={member.id} style={[styles.row, styles.memberRow, { borderBottomColor: theme.border }]}>
              <View style={styles.flex}>
                <Text style={{ color: theme.text, fontSize: 16 }}>
                  {member.displayName}
                  {isMe ? ' (you)' : ''}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 13 }}>
                  {balanceLabel(member.balance, currency)}
                </Text>
              </View>
              <Pressable onPress={() => startRename(member)} style={styles.inlineButton} hitSlop={6}>
                <Text style={{ color: theme.primary }}>Rename</Text>
              </Pressable>
              {!isMe ? (
                <Pressable onPress={() => confirmRemove(member)} style={styles.inlineButton} hitSlop={6}>
                  <Text style={{ color: theme.negative }}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        <View style={styles.row}>
          <TextInput
            value={newMemberName}
            onChangeText={(text) => {
              setNewMemberName(text);
              setError(null);
            }}
            placeholder="Add a person"
            placeholderTextColor={theme.muted}
            maxLength={MAX_NAME_LENGTH}
            style={[input, styles.flex]}
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <Pressable onPress={add} style={styles.inlineButton}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>Add</Text>
          </Pressable>
        </View>

        {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}

        <Pressable onPress={() => confirmDeleteGroup(group, me)} style={styles.dangerButton}>
          <Text style={{ color: theme.negative, fontWeight: '600' }}>Delete group</Text>
        </Pressable>
        <Text style={{ color: theme.muted, fontSize: 13 }}>
          Only possible when everyone is settled up.
        </Text>
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const inputStyle = (theme: Theme) => [
  styles.input,
  { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
];

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  notMember: { textAlign: 'center', fontSize: 15 },
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, minHeight: 48, paddingVertical: 10, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  linkRow: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, minHeight: 52, justifyContent: 'center' },
  switchRow: { marginTop: 12, gap: 16 },
  memberRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  inlineButton: { paddingHorizontal: 6, paddingVertical: 8 },
  dangerButton: { marginTop: 24, paddingVertical: 12, alignItems: 'center' },
});