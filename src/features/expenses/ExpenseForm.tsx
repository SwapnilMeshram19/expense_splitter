import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/db/schema';
import { MAX_DESCRIPTION_LENGTH } from '@/domain/expenseValidation';
import { formatPaise, sanitizeAmountInput } from '@/domain/money';
import { formatIsoDate, fromIsoDate, toLocalIsoDate } from '@/lib/dates';
import { useTheme, type Theme } from '@/ui/theme';

import {
  analyzeForm,
  sanitizeSplitInput,
  type DraftParts,
  type ExpenseFormState,
  type FormMember,
  type SplitMode,
} from './formState';

interface ExpenseFormProps {
  members: FormMember[];
  initialState: ExpenseFormState;
  submitLabel: string;
  /** Save the draft. Return an error message to show, or null on success. */
  onSubmit: (draft: DraftParts) => string | null;
}

const SPLIT_MODES: { mode: SplitMode; label: string }[] = [
  { mode: 'equal', label: 'Equally' },
  { mode: 'exact', label: 'Amounts' },
  { mode: 'percentage', label: '%' },
  { mode: 'shares', label: 'Shares' },
];

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  general: 'General',
  food: 'Food',
  groceries: 'Groceries',
  travel: 'Travel',
  transport: 'Transport',
  stay: 'Stay',
  shopping: 'Shopping',
  utilities: 'Utilities',
  entertainment: 'Fun',
  other: 'Other',
};

const VALUE_KEYS = { exact: 'exactAmounts', percentage: 'percentages', shares: 'shares' } as const;

/** Space kept between the focused input and the keyboard toolbar. */
const KEYBOARD_BOTTOM_OFFSET = 62;

export function ExpenseForm({ members, initialState, submitLabel, onSubmit }: ExpenseFormProps) {
  const theme = useTheme();
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [showIosDate, setShowIosDate] = useState(false);

  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const analysis = useMemo(() => analyzeForm(state, memberIds), [state, memberIds]);

  const update = (patch: Partial<ExpenseFormState>) => {
    setState((s) => ({ ...s, ...patch }));
    setError(null);
  };

  const setSplitValue = (mode: Exclude<SplitMode, 'equal'>, memberId: string, text: string) => {
    const key = VALUE_KEYS[mode];
    setState((s) => {
      const previous = s[key][memberId] ?? '';
      return { ...s, [key]: { ...s[key], [memberId]: sanitizeSplitInput(mode, text, previous) } };
    });
    setError(null);
  };

  const setPayerAmount = (memberId: string, text: string) => {
    setState((s) => {
      const previous = s.payerAmounts[memberId] ?? '';
      return {
        ...s,
        payerAmounts: { ...s.payerAmounts, [memberId]: sanitizeAmountInput(text, previous) },
      };
    });
    setError(null);
  };

  const toggleEqualMember = (memberId: string) => {
    setState((s) => ({
      ...s,
      equalMemberIds: s.equalMemberIds.includes(memberId)
        ? s.equalMemberIds.filter((id) => id !== memberId)
        : [...s.equalMemberIds, memberId],
    }));
    setError(null);
  };

  const pickDate = () => {
    if (Platform.OS === 'android') {
      // onValueChange fires only when the user confirms; cancelling just closes the dialog.
      DateTimePickerAndroid.open({
        value: fromIsoDate(state.expenseDate),
        mode: 'date',
        onValueChange: (_event, date) => {
          if (date) update({ expenseDate: toLocalIsoDate(date) });
        },
      });
    } else {
      setShowIosDate((v) => !v);
    }
  };

  const submit = () => {
    if (!analysis.draft) {
      setError(analysis.problems[0] ?? 'Check the form.');
      return;
    }
    const message = onSubmit(analysis.draft);
    if (message) setError(message);
  };

  const formatPreview = (paise: number | undefined) =>
    paise === undefined ? '' : `${analysis.previewIsEstimate ? '≈ ' : ''}${formatPaise(paise)}`;

  const input = inputStyle(theme);

  return (
    <>
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={state.description}
          onChangeText={(description) => update({ description })}
          placeholder="What was it for?"
          placeholderTextColor={theme.muted}
          maxLength={MAX_DESCRIPTION_LENGTH}
          style={[input, styles.description]}
          autoFocus={state.description === ''}
        />

        <View style={[styles.amountRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Text style={[styles.rupee, { color: theme.muted }]}>₹</Text>
          <TextInput
            value={state.amountText}
            onChangeText={(text) => update({ amountText: sanitizeAmountInput(text, state.amountText) })}
            placeholder="0"
            placeholderTextColor={theme.muted}
            keyboardType="decimal-pad"
            style={[styles.amountInput, { color: theme.text }]}
          />
        </View>

        <Pressable onPress={pickDate} style={styles.dateRow} accessibilityRole="button">
          <Text style={{ color: theme.muted }}>Date</Text>
          <Text style={{ color: theme.primary, fontWeight: '600' }}>
            {formatIsoDate(state.expenseDate)}
          </Text>
        </Pressable>
        {Platform.OS === 'ios' && showIosDate ? (
          <DateTimePicker
            value={fromIsoDate(state.expenseDate)}
            mode="date"
            display="inline"
            onValueChange={(_event, date) => {
              if (date) update({ expenseDate: toLocalIsoDate(date) });
            }}
          />
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {EXPENSE_CATEGORIES.map((category) => (
            <Chip
              key={category}
              label={CATEGORY_LABELS[category]}
              selected={state.category === category}
              onPress={() => update({ category })}
              theme={theme}
            />
          ))}
        </ScrollView>

        {/* ---- Paid by ---- */}
        <SectionTitle theme={theme}>Paid by</SectionTitle>
        {state.payerMode === 'single' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {members.map((m) => (
              <Chip
                key={m.id}
                label={m.name}
                selected={state.singlePayerId === m.id}
                onPress={() => update({ singlePayerId: m.id })}
                theme={theme}
              />
            ))}
          </ScrollView>
        ) : (
          members.map((m) => (
            <View key={m.id} style={styles.memberRow}>
              <Text style={[styles.memberName, { color: theme.text }]}>{m.name}</Text>
              <TextInput
                value={state.payerAmounts[m.id] ?? ''}
                onChangeText={(text) => setPayerAmount(m.id, text)}
                placeholder="0"
                placeholderTextColor={theme.muted}
                keyboardType="decimal-pad"
                style={[input, styles.smallInput]}
              />
            </View>
          ))
        )}
        {state.payerMode === 'multiple' && analysis.payerHint ? (
          <Text style={{ color: theme.warning }}>{analysis.payerHint}</Text>
        ) : null}
        <Pressable
          onPress={() => update({ payerMode: state.payerMode === 'single' ? 'multiple' : 'single' })}
          style={styles.linkButton}
        >
          <Text style={{ color: theme.primary, fontWeight: '600' }}>
            {state.payerMode === 'single' ? 'Multiple people paid' : 'One person paid'}
          </Text>
        </Pressable>

        {/* ---- Split ---- */}
        <SectionTitle theme={theme}>Split</SectionTitle>
        <View style={[styles.tabs, { borderColor: theme.border }]}>
          {SPLIT_MODES.map(({ mode, label }) => {
            const selected = state.splitMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => update({ splitMode: mode })}
                style={[styles.tab, selected && { backgroundColor: theme.primary }]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Text style={{ color: selected ? theme.onPrimary : theme.text, fontWeight: '600' }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {members.map((m) => {
          const mode = state.splitMode;
          return (
            <View key={m.id} style={styles.memberRow}>
              {mode === 'equal' ? (
                <Pressable
                  onPress={() => toggleEqualMember(m.id)}
                  style={styles.checkRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: state.equalMemberIds.includes(m.id) }}
                >
                  <Text style={{ color: theme.primary, fontSize: 20 }}>
                    {state.equalMemberIds.includes(m.id) ? '☑' : '☐'}
                  </Text>
                  <Text style={[styles.memberName, { color: theme.text }]}>{m.name}</Text>
                </Pressable>
              ) : (
                <>
                  <Text style={[styles.memberName, { color: theme.text }]}>{m.name}</Text>
                  <TextInput
                    value={state[VALUE_KEYS[mode]][m.id] ?? ''}
                    onChangeText={(text) => setSplitValue(mode, m.id, text)}
                    placeholder="0"
                    placeholderTextColor={theme.muted}
                    keyboardType={mode === 'shares' ? 'number-pad' : 'decimal-pad'}
                    style={[input, styles.smallInput]}
                  />
                </>
              )}
              <Text style={[styles.preview, { color: theme.muted }]} numberOfLines={1}>
                {formatPreview(analysis.preview.get(m.id))}
              </Text>
            </View>
          );
        })}
        {analysis.splitHint ? <Text style={{ color: theme.warning }}>{analysis.splitHint}</Text> : null}

        {error ? <Text style={[styles.error, { color: theme.negative }]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={submit}
          style={({ pressed }) => [
            styles.submit,
            { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.submitText, { color: theme.onPrimary }]}>{submitLabel}</Text>
        </Pressable>
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

function SectionTitle({ theme, children }: { theme: Theme; children: string }) {
  return <Text style={[styles.section, { color: theme.muted }]}>{children}</Text>;
}

function Chip({
  label,
  selected,
  onPress,
  theme,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? theme.primary : 'transparent',
        },
      ]}
    >
      <Text style={{ color: selected ? theme.onPrimary : theme.text }}>{label}</Text>
    </Pressable>
  );
}

const inputStyle = (theme: Theme) => [
  styles.input,
  { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
];

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  description: { fontSize: 18 },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  rupee: { fontSize: 28, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 32, fontWeight: '600', paddingVertical: 8 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  chips: { gap: 8, paddingVertical: 4 },
  chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  section: { fontSize: 13, fontWeight: '600', marginTop: 12, textTransform: 'uppercase' },
  tabs: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  checkRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberName: { flex: 1, fontSize: 16 },
  smallInput: { width: 96, textAlign: 'right' },
  preview: { width: 100, textAlign: 'right', fontSize: 13 },
  linkButton: { paddingVertical: 6 },
  error: { marginTop: 8 },
  submit: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitText: { fontSize: 16, fontWeight: '600' },
});