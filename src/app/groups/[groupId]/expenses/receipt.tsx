import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { createExpense } from '@/db/repositories/expenses';
import { getGroup } from '@/db/repositories/groups';
import { activeMembersQuery, findSelfMemberId } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { MAX_DESCRIPTION_LENGTH } from '@/domain/expenseValidation';
import { formatPaise, sanitizeAmountInput } from '@/domain/money';
import { describeExpenseError } from '@/features/expenses/messages';
import { MAX_ITEM_NAME_LENGTH } from '@/features/receipt/parseReceipt';
import {
  analyzeReceiptDraft,
  blankItem,
  clearReceiptDraft,
  getReceiptDraft,
  MAX_RECEIPT_ITEMS,
  saveReceiptDraft,
  type DraftItem,
  type ReceiptDraft,
} from '@/features/receipt/receiptDraft';
import { LinkButton, PrimaryButton } from '@/features/upi/buttons';
import { todayIsoDate } from '@/lib/dates';
import { Chip } from '@/ui/Chip';
import { useTheme } from '@/ui/theme';

interface Member {
  id: string;
  name: string;
}
type Setup = { ok: true; me: string; members: Member[] } | { ok: false; message: string };
type Ready = Extract<Setup, { ok: true }>;

function loadSetup(groupId: string): Setup {
  if (!getGroup(db, groupId)) return { ok: false, message: 'This group no longer exists.' };
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return { ok: false, message: 'You’re not a member of this group.' };
  const members = activeMembersQuery(db, groupId)
    .all()
    .map((m) => ({ id: m.id, name: m.id === me ? 'You' : m.displayName }))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me)); // "You" first
  return { ok: true, me, members };
}

export default function ReceiptScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const [setup] = useState(() => loadSetup(groupId));
  const [initial] = useState(() => {
    const draft = getReceiptDraft(appContext);
    return draft && draft.groupId === groupId ? draft : null;
  });

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Bill' }} />
        <Text style={{ color: theme.muted }}>{setup.message}</Text>
      </View>
    );
  }
  if (!initial) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Bill' }} />
        <Text style={{ color: theme.muted }}>There’s no scanned bill to review.</Text>
        <LinkButton
          label="Scan a bill"
          onPress={() => router.replace({ pathname: '/groups/[groupId]/expenses/scan', params: { groupId } })}
        />
      </View>
    );
  }
  return <ReceiptForm groupId={groupId} setup={setup} initial={initial} />;
}

function ReceiptForm({ groupId, setup, initial }: { groupId: string; setup: Ready; initial: ReceiptDraft }) {
  const theme = useTheme();
  const allIds = setup.members.map((m) => m.id);

  // Drop people removed from the group since the scan.
  const [draft, setDraft] = useState<ReceiptDraft>(() => {
    const active = new Set(allIds);
    return { ...initial, items: initial.items.map((i) => ({ ...i, memberIds: i.memberIds.filter((id) => active.has(id)) })) };
  });
  const [payerId, setPayerId] = useState(setup.me);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);

  // Debounced: every write to `settings` wakes live queries elsewhere (the groups list).
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!finished.current) saveReceiptDraft(appContext, draft);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft]);

  const analysis = analyzeReceiptDraft(draft);
  const nameOf = (id: string) => setup.members.find((m) => m.id === id)?.name ?? 'Someone';

  const edit = (change: (d: ReceiptDraft) => ReceiptDraft) => {
    setDraft(change);
    setError(null);
  };
  const editItem = (id: string, change: (i: DraftItem) => DraftItem) =>
    edit((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? change(i) : i)) }));
  const toggleMember = (id: string, memberId: string) =>
    editItem(id, (i) => ({
      ...i,
      memberIds: i.memberIds.includes(memberId) ? i.memberIds.filter((m) => m !== memberId) : [...i.memberIds, memberId],
    }));
  const toggleEveryone = (id: string) =>
    editItem(id, (i) => ({ ...i, memberIds: i.memberIds.length === allIds.length ? [] : [...allIds] }));
  const removeItem = (id: string) => {
    const replacement = blankItem(appContext.newId());
    edit((d) => {
      const items = d.items.filter((i) => i.id !== id);
      return { ...d, items: items.length > 0 ? items : [replacement] };
    });
  };
  const addItem = () => {
    const item = blankItem(appContext.newId());
    edit((d) => ({ ...d, items: [...d.items, item] }));
  };
  const assignUnassignedToEveryone = () =>
    edit((d) => ({ ...d, items: d.items.map((i) => (i.memberIds.length === 0 ? { ...i, memberIds: [...allIds] } : i)) }));

  const save = () => {
    if (finished.current) return;
    if (!analysis.splitInput || analysis.totalPaise === null) {
      setError(analysis.problems[0] ?? 'Check the bill.');
      return;
    }
    const total = analysis.totalPaise;
    const result = createExpense(appContext, {
      groupId,
      description: draft.description,
      amountPaise: total,
      category: 'general',
      expenseDate: todayIsoDate(),
      payers: [{ memberId: payerId, amountPaise: total }],
      splitInput: analysis.splitInput,
      actorMemberId: setup.me,
    });
    if (!result.ok) {
      setError(describeExpenseError(result.error, nameOf));
      return;
    }
    finished.current = true;
    clearReceiptDraft(appContext);
    router.back();
  };

  const discard = () =>
    Alert.alert('Discard this bill?', 'The scanned items will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          finished.current = true;
          clearReceiptDraft(appContext);
          router.back();
        },
      },
    ]);

  const diff = analysis.differencePaise;
  let totalHint: { text: string; warn: boolean } | null = null;
  if (diff !== null) {
    if (diff === 0) totalHint = { text: 'Items add up to the bill total.', warn: false };
    else if (diff > 0 && analysis.differenceExplained)
      totalHint = {
        text: `Includes ${formatPaise(diff)} tax and charges, shared in proportion to what each person had.`,
        warn: false,
      };
    else if (diff > 0)
      totalHint = {
        text: `The total is ${formatPaise(diff)} more than the items. It’s shared in proportion, like tax. If an item is missing, add it.`,
        warn: true,
      };
    else
      totalHint = {
        text: `The total is ${formatPaise(-diff)} less than the items (a discount). It’s shared in proportion.`,
        warn: false,
      };
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Split the bill' }} />
      <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: theme.muted }]}>Description</Text>
        <TextInput
          value={draft.description}
          onChangeText={(description) => edit((d) => ({ ...d, description }))}
          maxLength={MAX_DESCRIPTION_LENGTH}
          style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
        />

        <Text style={[styles.label, { color: theme.muted }]}>Items · tap who had each one</Text>
        {draft.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            members={setup.members}
            onName={(name) => editItem(item.id, (i) => ({ ...i, name }))}
            onAmount={(text) => editItem(item.id, (i) => ({ ...i, amountText: sanitizeAmountInput(text, i.amountText) }))}
            onToggle={(memberId) => toggleMember(item.id, memberId)}
            onEveryone={() => toggleEveryone(item.id)}
            onRemove={() => removeItem(item.id)}
          />
        ))}
        <View style={styles.row}>
          {draft.items.length < MAX_RECEIPT_ITEMS ? <LinkButton label="+ Add item" onPress={addItem} /> : null}
          {analysis.unassignedCount > 0 ? (
            <LinkButton label="Everyone shares the rest" onPress={assignUnassignedToEveryone} />
          ) : null}
        </View>

        <Text style={[styles.label, { color: theme.muted }]}>Bill total</Text>
        <View style={[styles.amountRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Text style={[styles.rupee, { color: theme.muted }]}>₹</Text>
          <TextInput
            value={draft.totalText}
            onChangeText={(text) => edit((d) => ({ ...d, totalText: sanitizeAmountInput(text, d.totalText) }))}
            placeholder="0"
            placeholderTextColor={theme.muted}
            keyboardType="decimal-pad"
            style={[styles.amountInput, { color: theme.text }]}
          />
        </View>
        <Text style={{ color: theme.muted }}>Items add up to {formatPaise(analysis.itemsSubtotalPaise)}.</Text>
        {totalHint ? <Text style={{ color: totalHint.warn ? theme.warning : theme.muted }}>{totalHint.text}</Text> : null}

        <Text style={[styles.label, { color: theme.muted }]}>Paid by</Text>
        <View style={styles.chips}>
          {setup.members.map((m) => (
            <Chip key={m.id} label={m.name} selected={payerId === m.id} onPress={() => setPayerId(m.id)} />
          ))}
        </View>

        {analysis.preview.size > 0 ? (
          <>
            <Text style={[styles.label, { color: theme.muted }]}>Each person’s share</Text>
            {setup.members
              .filter((m) => analysis.preview.has(m.id))
              .map((m) => (
                <View key={m.id} style={styles.previewRow}>
                  <Text style={{ color: theme.text }}>{m.name}</Text>
                  <Text style={{ color: theme.text, fontWeight: '600' }}>{formatPaise(analysis.preview.get(m.id)!)}</Text>
                </View>
              ))}
          </>
        ) : null}

        {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}
        <PrimaryButton
          label={analysis.totalPaise !== null ? `Save ${formatPaise(analysis.totalPaise)}` : 'Save'}
          onPress={save}
        />
        <LinkButton label="Discard this bill" onPress={discard} color={theme.negative} />
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

function ItemRow({
  item,
  members,
  onName,
  onAmount,
  onToggle,
  onEveryone,
  onRemove,
}: {
  item: DraftItem;
  members: Member[];
  onName: (name: string) => void;
  onAmount: (text: string) => void;
  onToggle: (memberId: string) => void;
  onEveryone: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const everyone = item.memberIds.length === members.length;
  const unassigned = item.memberIds.length === 0 && (item.name.trim() !== '' || item.amountText.trim() !== '');

  return (
    <View style={[styles.item, { borderColor: unassigned ? theme.warning : theme.border }]}>
      <View style={styles.itemTop}>
        <TextInput
          value={item.name}
          onChangeText={onName}
          placeholder="Item"
          placeholderTextColor={theme.muted}
          maxLength={MAX_ITEM_NAME_LENGTH}
          style={[styles.itemName, { color: theme.text }]}
        />
        {item.quantity !== null && item.quantity > 1 ? (
          <Text style={{ color: theme.muted }}>×{item.quantity}</Text>
        ) : null}
        <Text style={{ color: theme.muted }}>₹</Text>
        <TextInput
          value={item.amountText}
          onChangeText={onAmount}
          placeholder="0"
          placeholderTextColor={theme.muted}
          keyboardType="decimal-pad"
          style={[styles.itemAmount, { color: theme.text, borderColor: theme.border }]}
        />
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name || 'item'}`}
        >
          <Text style={{ color: theme.muted, fontSize: 18 }}>✕</Text>
        </Pressable>
      </View>
      <View style={styles.chips}>
        <Chip label="Everyone" selected={everyone} onPress={onEveryone} />
        {members.map((m) => (
          <Chip key={m.id} label={m.name} selected={item.memberIds.includes(m.id)} onPress={() => onToggle(m.id)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  item: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemName: { flex: 1, fontSize: 16, paddingVertical: 4 },
  itemAmount: { width: 96, fontSize: 16, borderBottomWidth: 1, paddingVertical: 4, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  row: { flexDirection: 'row', gap: 20, flexWrap: 'wrap' },
  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  rupee: { fontSize: 28, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 32, fontWeight: '600', paddingVertical: 8 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
});