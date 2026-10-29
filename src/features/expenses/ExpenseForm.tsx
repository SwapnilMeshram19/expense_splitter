import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import {
  currencyInfo,
  currencyPrefix,
  formatMoney,
  isOverAmountDigits,
  maxAmountLabel,
  readableAmount,
  sanitizeMoneyInput,
  type CurrencyCode,
} from '@/domain/currency';
import { MAX_DESCRIPTION_LENGTH } from '@/domain/expenseValidation';
import { formatRate, sanitizeRateInput } from '@/domain/fx';
import { MAX_NOTE_LENGTH } from '@/domain/note';
import { describeSchedule, type Frequency } from '@/domain/recurrence';
import { suggestRate, type SuggestedRate } from '@/features/fx/rateCache';
import { useRateTable } from '@/features/fx/useRateTable';
import { ReceiptField } from '@/features/receipts/ReceiptField';
import { useRegionPreference } from '@/features/region/regionPreference';
import { formatIsoDate, fromIsoDate, toLocalIsoDate } from '@/lib/dates';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CategoryTile } from '@/ui/CategoryTile';
import { CurrencyPicker } from '@/ui/CurrencyPicker';
import { HeroAmountInput } from '@/ui/HeroAmountInput';
import { Icon } from '@/ui/Icon';
import { MemberPicker } from '@/ui/MemberPicker';
import { Segmented } from '@/ui/Segmented';
import { TextInput } from '@/ui/Text';
import { useTheme, type Theme } from '@/ui/theme';

import { categoryDisplayName } from './categoryNames';
import { CategoryPickerSheet } from './CategoryPickerSheet';
import { guessCategory } from './guessCategory';
import {
  analyzeForm,
  effectiveRateText,
  sanitizeSplitInput,
  withCurrency,
  type DraftParts,
  type ExpenseFormState,
  type FormMember,
  type SplitMode,
} from './formState';

interface ExpenseFormProps {
  members: FormMember[];
  initialState: ExpenseFormState;
  submitLabel: string;
  /** Custom category names already used in the group, offered as one-tap suggestions. */
  categorySuggestions?: readonly string[];
  /** Balances, payers and shares are always in this currency. */
  groupCurrency: CurrencyCode;
  /** Foreign currencies used before in this group, offered first in the picker. */
  recentCurrencies?: readonly CurrencyCode[];
  /** For the receipt photo's storage path. */
  groupId: string;
  /** The expense being edited, or null when adding one. */
  expenseId: string | null;
  /**
   * 'off': no repeat controls (editing one expense). 'optional': a new expense may repeat.
   * 'rule': editing a recurring rule (always repeats; no receipt, group currency only).
   */
  repeatMode?: 'off' | 'optional' | 'rule';
  /** Rule mode: an occurrence exists, so the frequency and start date can't change. */
  scheduleLocked?: boolean;
  /** Save the draft. Return an error message to show, or null on success. */
  /** Resolves to an error message, or null once saved (the screen then closes). */
  onSubmit: (draft: DraftParts) => Promise<string | null> | string | null;
}

const SPLIT_MODES: readonly { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Amounts' },
  { value: 'percentage', label: '%' },
  { value: 'shares', label: 'Shares' },
];

const VALUE_KEYS = { exact: 'exactAmounts', percentage: 'percentages', shares: 'shares' } as const;

const REPEAT_OPTIONS: readonly { value: 'none' | Frequency; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];
const RULE_FREQUENCIES = REPEAT_OPTIONS.slice(1);

/** Space kept between the focused input and the keyboard toolbar. */
const KEYBOARD_BOTTOM_OFFSET = 62;

export function ExpenseForm({
  members,
  initialState,
  submitLabel,
  categorySuggestions = [],
  groupCurrency,
  recentCurrencies = [],
  groupId,
  expenseId,
  repeatMode = 'off',
  scheduleLocked = false,
  onSubmit,
}: ExpenseFormProps) {
  const theme = useTheme();
  const { homeCurrency } = useRegionPreference();
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [showIosDate, setShowIosDate] = useState(false);
  const [showIosEnd, setShowIosEnd] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);
  // The last keypress was refused for going past the per-amount cap: say so instead of ignoring it.
  const [amountAtCap, setAmountAtCap] = useState(false);
  // New expenses follow the description ("Swiggy" → Food) until the user picks a category.
  const [categoryTouched, setCategoryTouched] = useState(
    expenseId !== null || isRuleMode(repeatMode, initialState),
  );
  const isRule = repeatMode === 'rule';

  const isForeign = state.currency !== groupCurrency;
  const rateTable = useRateTable(isForeign);
  const suggestion = isForeign ? suggestRate(rateTable, state.currency, groupCurrency) : null;
  const suggestedRate = suggestion?.rate ?? null;

  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const analysis = useMemo(
    () => analyzeForm(state, memberIds, groupCurrency, suggestedRate),
    [state, memberIds, groupCurrency, suggestedRate],
  );
  const entryCurrency = analysis.entryCurrency;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';

  const update = (patch: Partial<ExpenseFormState>) => {
    setState((s) => ({ ...s, ...patch }));
    setError(null);
  };

  const setSplitValue = (mode: Exclude<SplitMode, 'equal'>, memberId: string, text: string) => {
    const key = VALUE_KEYS[mode];
    setState((s) => {
      const previous = s[key][memberId] ?? '';
      return {
        ...s,
        [key]: { ...s[key], [memberId]: sanitizeSplitInput(mode, text, previous, s.currency) },
      };
    });
    setError(null);
  };

  const setPayerAmount = (memberId: string, text: string) => {
    setState((s) => {
      const previous = s.payerAmounts[memberId] ?? '';
      return {
        ...s,
        payerAmounts: {
          ...s.payerAmounts,
          [memberId]: sanitizeMoneyInput(text, previous, s.currency),
        },
      };
    });
    setError(null);
  };

  const setAllIncluded = (included: boolean) => {
    setState((s) => ({ ...s, equalMemberIds: included ? [...memberIds] : [] }));
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

  const pickEndDate = () => {
    const start = state.repeatEndDate ?? state.expenseDate;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: fromIsoDate(start),
        mode: 'date',
        minimumDate: fromIsoDate(state.expenseDate),
        onValueChange: (_event, date) => {
          if (date) update({ repeatEndDate: toLocalIsoDate(date) });
        },
      });
    } else {
      setShowIosEnd((v) => !v);
    }
  };

  const pickDate = () => {
    if (scheduleLocked) return;
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

  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    if (!analysis.draft) {
      setError(analysis.problems[0] ?? 'Check the form.');
      return;
    }
    setSaving(true);
    try {
      const message = await onSubmit(analysis.draft);
      if (message) setError(message);
    } finally {
      setSaving(false);
    }
  };

  const setCurrency = (currency: CurrencyCode) => {
    setState((s) => withCurrency(s, currency));
    setError(null);
    setAmountAtCap(false);
  };

  const formatPreview = (minor: number | undefined) =>
    minor === undefined
      ? ''
      : `${analysis.previewIsEstimate ? '≈ ' : ''}${formatMoney(minor, entryCurrency)}`;

  const smallInput = [
    styles.smallInput,
    { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
  ];

  return (
    <>
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---- Amount ---- */}
        <View style={styles.amountBlock}>
          <View style={styles.amountLabelRow}>
            <AppText variant="label" color={theme.muted}>
              Amount
            </AppText>
            {isRule ? null : (
              <CurrencyPicker
                label="Bill currency"
                value={state.currency}
                onChange={setCurrency}
                pinned={[groupCurrency, ...recentCurrencies, homeCurrency]}
                variant="pill"
              />
            )}
          </View>
          <HeroAmountInput
            prefix={currencyPrefix(entryCurrency)}
            value={state.amountText}
            onChangeText={(text) => {
              setAmountAtCap(isOverAmountDigits(text, entryCurrency));
              update({ amountText: sanitizeMoneyInput(text, state.amountText, entryCurrency) });
            }}
            keyboardType={currencyInfo(entryCurrency).digits === 0 ? 'number-pad' : 'decimal-pad'}
            accessibilityLabel={`Amount in ${currencyInfo(entryCurrency).name}`}
            autoFocus={state.description === '' && state.amountText === ''}
          />
          <AmountHint
            atCap={amountAtCap}
            readable={readableAmount(state.amountText, entryCurrency)}
            limit={maxAmountLabel(entryCurrency)}
            theme={theme}
          />
        </View>

        {isForeign ? (
          <RateCard
            state={state}
            groupCurrency={groupCurrency}
            suggestion={suggestion}
            convertedTotal={analysis.convertedTotal}
            onChangeRate={(text) =>
              update({
                rateText: sanitizeRateInput(text, effectiveRateText(state, suggestedRate)),
                rateEdited: true,
              })
            }
            onUseSuggested={() => update({ rateText: '', rateEdited: false })}
            theme={theme}
          />
        ) : null}

        {/* ---- Description + date ---- */}
        <Card style={styles.fieldsCard}>
          <View style={[styles.field, styles.fieldDivider, { borderBottomColor: theme.border }]}>
            <AppText variant="caption" color={theme.muted}>
              Description
            </AppText>
            <TextInput
              value={state.description}
              onChangeText={(description) => {
                const guess = categoryTouched ? null : guessCategory(description);
                update(guess ? { description, category: guess } : { description });
              }}
              placeholder="What was it for?"
              maxLength={MAX_DESCRIPTION_LENGTH}
              accessibilityLabel="Description"
              style={styles.descriptionInput}
            />
          </View>
          <Pressable
            onPress={pickDate}
            disabled={scheduleLocked}
            accessibilityRole="button"
            accessibilityLabel={`${state.repeat === 'none' ? 'Date' : 'First date'}, ${formatIsoDate(state.expenseDate)}${scheduleLocked ? '' : '. Change'}`}
            style={[styles.field, styles.dateField]}
          >
            <View style={styles.grow}>
              <AppText variant="caption" color={theme.muted}>
                {state.repeat === 'none' ? 'Date' : 'First date'}
              </AppText>
              <AppText style={styles.medium}>{formatIsoDate(state.expenseDate)}</AppText>
            </View>
            <Icon name={scheduleLocked ? 'lock' : 'calendar'} color={theme.muted} size={20} />
          </Pressable>
          <Pressable
            onPress={() => setPickingCategory(true)}
            accessibilityRole="button"
            accessibilityLabel={`Category, ${categoryDisplayName(state.category, state.categoryLabel.trim())}. Change`}
            style={[styles.field, styles.dateField, styles.fieldDividerTop, { borderTopColor: theme.border }]}
          >
            <CategoryTile category={state.category} size={32} />
            <View style={styles.grow}>
              <AppText variant="caption" color={theme.muted}>
                Category{!categoryTouched && state.category !== 'general' ? ' · suggested' : ''}
              </AppText>
              <AppText style={styles.medium} numberOfLines={1}>
                {categoryDisplayName(state.category, state.categoryLabel.trim())}
              </AppText>
            </View>
            <Icon name="chevronRight" color={theme.muted} size={20} />
          </Pressable>
        </Card>
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

        {/* ---- Repeat ---- */}
        {repeatMode !== 'off' ? (
          <View style={styles.repeatBlock}>
            <SectionTitle>Repeat</SectionTitle>
            {scheduleLocked ? null : (
              <Segmented
                options={isRule ? RULE_FREQUENCIES : REPEAT_OPTIONS}
                value={state.repeat}
                onChange={(repeat) => update({ repeat })}
                accessibilityLabel="Repeat"
              />
            )}
            {state.repeat !== 'none' ? (
              <>
                <AppText variant="caption" color={theme.muted}>
                  {describeSchedule(state.repeat, state.expenseDate)}
                  {scheduleLocked ? ' · schedule is fixed' : ''}. Added automatically.
                </AppText>
                <View style={styles.endRow}>
                  <Pressable
                    onPress={pickEndDate}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={styles.grow}
                  >
                    <AppText variant="label">
                      Ends:{' '}
                      <AppText variant="label" style={styles.bold}>
                        {state.repeatEndDate ? formatIsoDate(state.repeatEndDate) : 'Never'}
                      </AppText>
                    </AppText>
                  </Pressable>
                  {state.repeatEndDate ? (
                    <Pressable
                      onPress={() => update({ repeatEndDate: null })}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
                        No end date
                      </AppText>
                    </Pressable>
                  ) : null}
                </View>
                {Platform.OS === 'ios' && showIosEnd ? (
                  <DateTimePicker
                    value={fromIsoDate(state.repeatEndDate ?? state.expenseDate)}
                    mode="date"
                    display="inline"
                    minimumDate={fromIsoDate(state.expenseDate)}
                    onValueChange={(_event, date) => {
                      if (date) update({ repeatEndDate: toLocalIsoDate(date) });
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {/* ---- Paid by ---- */}
        <SectionTitle>Paid by</SectionTitle>
        {state.payerMode === 'single' ? (
          <MemberPicker
            label="Paid by"
            members={members}
            value={state.singlePayerId}
            onChange={(singlePayerId) => update({ singlePayerId })}
          />
        ) : (
          <Card style={styles.membersCard}>
            {members.map((m, index) => (
              <View
                key={m.id}
                style={[
                  styles.memberRow,
                  index < members.length - 1 && [
                    styles.rowDivider,
                    { borderBottomColor: theme.border },
                  ],
                ]}
              >
                <Avatar seed={m.id} name={m.name} size={32} />
                <AppText style={styles.grow} numberOfLines={1}>
                  {m.name}
                </AppText>
                <TextInput
                  value={state.payerAmounts[m.id] ?? ''}
                  onChangeText={(text) => setPayerAmount(m.id, text)}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Amount paid by ${m.name}`}
                  style={smallInput}
                />
              </View>
            ))}
          </Card>
        )}
        {state.payerMode === 'multiple' && analysis.payerHint ? (
          <Hint text={analysis.payerHint} theme={theme} />
        ) : null}
        <Pressable
          onPress={() =>
            update({ payerMode: state.payerMode === 'single' ? 'multiple' : 'single' })
          }
          style={styles.linkButton}
          accessibilityRole="button"
          hitSlop={8}
        >
          <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
            {state.payerMode === 'single' ? 'Multiple people paid' : 'One person paid'}
          </AppText>
        </Pressable>

        {/* ---- Split ---- */}
        <View style={styles.sectionRow}>
          <SectionTitle>Split</SectionTitle>
          {state.splitMode === 'equal' && members.length > 2 ? (
            <Pressable
              onPress={() => setAllIncluded(state.equalMemberIds.length !== members.length)}
              accessibilityRole="button"
              hitSlop={8}
              style={styles.allToggle}
            >
              <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
                {state.equalMemberIds.length === members.length ? 'Select none' : 'Select all'}
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <Segmented
          options={SPLIT_MODES}
          value={state.splitMode}
          onChange={(splitMode) => update({ splitMode })}
          accessibilityLabel="Split method"
        />

        <Card style={styles.membersCard}>
          {members.map((m, index) => {
            const mode = state.splitMode;
            const included = state.equalMemberIds.includes(m.id);
            const divider = index < members.length - 1 && [
              styles.rowDivider,
              { borderBottomColor: theme.border },
            ];
            const preview = (
              <AppText variant="label" style={[styles.preview, styles.bold]} numberOfLines={1}>
                {formatPreview(analysis.preview.get(m.id))}
              </AppText>
            );

            if (mode === 'equal') {
              return (
                <Pressable
                  key={m.id}
                  onPress={() => toggleEqualMember(m.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: included }}
                  accessibilityLabel={`Include ${m.name}`}
                  style={[styles.memberRow, divider]}
                >
                  <View
                    style={[
                      styles.check,
                      included
                        ? { backgroundColor: theme.primary, borderColor: theme.primary }
                        : { borderColor: theme.muted },
                    ]}
                  >
                    {included ? <Icon name="check" color={theme.onPrimary} size={16} /> : null}
                  </View>
                  <Avatar seed={m.id} name={m.name} size={32} />
                  <AppText
                    style={styles.grow}
                    color={included ? theme.text : theme.muted}
                    numberOfLines={1}
                  >
                    {m.name}
                  </AppText>
                  {preview}
                </Pressable>
              );
            }
            return (
              <View key={m.id} style={[styles.memberRow, divider]}>
                <Avatar seed={m.id} name={m.name} size={32} />
                <AppText style={styles.grow} numberOfLines={1}>
                  {m.name}
                </AppText>
                <TextInput
                  value={state[VALUE_KEYS[mode]][m.id] ?? ''}
                  onChangeText={(text) => setSplitValue(mode, m.id, text)}
                  placeholder="0"
                  keyboardType={mode === 'shares' ? 'number-pad' : 'decimal-pad'}
                  accessibilityLabel={`${mode === 'shares' ? 'Shares' : mode === 'percentage' ? 'Percent' : 'Amount'} for ${m.name}`}
                  style={[smallInput, styles.splitInput]}
                />
                {preview}
              </View>
            );
          })}
        </Card>
        {analysis.splitHint ? <Hint text={analysis.splitHint} theme={theme} /> : null}

        {/* ---- Note + receipt (both shared with the group) ---- */}
        <SectionTitle>{isRule ? 'Note' : 'Note & receipt'}</SectionTitle>
        <Card style={styles.noteCard}>
          <TextInput
            value={state.note}
            onChangeText={(note) => update({ note })}
            placeholder="Add a note (optional)"
            multiline
            maxLength={MAX_NOTE_LENGTH}
            textAlignVertical="top"
            accessibilityLabel="Note"
            style={styles.noteInput}
          />
          {state.note.length > MAX_NOTE_LENGTH - 50 ? (
            <AppText variant="caption" color={theme.muted} style={styles.counter}>
              {state.note.length}/{MAX_NOTE_LENGTH}
            </AppText>
          ) : null}
          {isRule ? null : <View style={[styles.noteDivider, { backgroundColor: theme.border }]} />}
          {isRule ? null : (
            <ReceiptField
              groupId={groupId}
              expenseId={expenseId}
              receiptId={state.receiptId}
              staged={state.stagedReceipt}
              onStaged={(stagedReceipt) => update({ stagedReceipt })}
              onRemove={() => update({ stagedReceipt: null, receiptId: null })}
            />
          )}
        </Card>

        {error ? (
          <AppText
            variant="label"
            color={theme.negative}
            accessibilityLiveRegion="polite"
            style={styles.error}
          >
            {error}
          </AppText>
        ) : null}

        {/* In the scroll content, not pinned: a pinned bar would sit on top of the keyboard toolbar
            on small screens, and the form is short enough that Save is one scroll away. */}
        <Button
          label={submitLabel}
          size="lg"
          onPress={() => void submit()}
          busy={saving}
          style={styles.submit}
          accessibilityLabel={
            state.singlePayerId && state.payerMode === 'single'
              ? `${submitLabel}, paid by ${nameOf(state.singlePayerId)}`
              : submitLabel
          }
        />
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
      <CategoryPickerSheet
        visible={pickingCategory}
        value={{ category: state.category, label: state.categoryLabel }}
        suggestions={categorySuggestions}
        onPick={({ category, label }) => {
          setCategoryTouched(true);
          setPickingCategory(false);
          update({ category, categoryLabel: label });
        }}
        onClose={() => setPickingCategory(false)}
      />
    </>
  );
}

/** Editing a recurring rule: its category was chosen when it was set up, don't override it. */
function isRuleMode(repeatMode: ExpenseFormProps['repeatMode'], state: ExpenseFormState): boolean {
  return repeatMode === 'rule' && state.description !== '';
}

const SOURCE_LABEL: Record<SuggestedRate['sources'][number], string> = {
  frankfurter: 'Frankfurter',
  'exchangerate-api': 'ExchangeRate-API',
};

/** Foreign bill: the rate (prefilled from today's table, editable for card markup) and the result. */
function RateCard({
  state,
  groupCurrency,
  suggestion,
  convertedTotal,
  onChangeRate,
  onUseSuggested,
  theme,
}: {
  state: ExpenseFormState;
  groupCurrency: CurrencyCode;
  suggestion: SuggestedRate | null;
  convertedTotal: number | null;
  onChangeRate: (text: string) => void;
  onUseSuggested: () => void;
  theme: Theme;
}) {
  const value = effectiveRateText(state, suggestion?.rate ?? null);
  const differsFromToday =
    state.rateEdited && suggestion !== null && suggestion.rate !== state.rateText;
  const needsAttribution = suggestion?.sources.includes('exchangerate-api') ?? false;

  let caption: string;
  if (!state.rateEdited && suggestion) {
    const sources = suggestion.sources.map((s) => SOURCE_LABEL[s]).join(' + ');
    caption = `Rate of ${formatIsoDate(suggestion.asOf)} (${sources}). Edit to match your card.`;
  } else if (state.rateEdited) {
    caption = 'Locked with this expense.';
  } else {
    caption = 'No rate yet. Enter it from your card statement.';
  }

  return (
    <Card style={styles.rateCard}>
      <View style={styles.rateRow}>
        <Icon name="currency" color={theme.muted} size={20} />
        <AppText style={styles.medium}>1 {state.currency} =</AppText>
        <TextInput
          value={value}
          onChangeText={onChangeRate}
          placeholder="Rate"
          keyboardType="decimal-pad"
          accessibilityLabel={`Exchange rate: ${groupCurrency} for 1 ${state.currency}`}
          style={[
            styles.rateInput,
            { backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}
        />
        <AppText style={styles.medium}>{groupCurrency}</AppText>
      </View>
      <AppText variant="caption" color={theme.muted}>
        {caption}
      </AppText>
      {differsFromToday ? (
        <Pressable
          onPress={onUseSuggested}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.linkButton}
        >
          <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
            Use today’s rate ({formatRate(suggestion.rate)})
          </AppText>
        </Pressable>
      ) : null}
      {convertedTotal !== null ? (
        <AppText variant="label" style={styles.bold} accessibilityLiveRegion="polite">
          = {formatMoney(convertedTotal, groupCurrency, { forceDecimals: true })}
        </AppText>
      ) : null}
      {needsAttribution && !state.rateEdited ? (
        <Pressable
          onPress={() => void Linking.openURL('https://www.exchangerate-api.com')}
          accessibilityRole="link"
          hitSlop={8}
        >
          <AppText variant="caption" color={theme.onPrimarySoft}>
            Rates By Exchange Rate API
          </AppText>
        </Pressable>
      ) : null}
    </Card>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <AppText variant="label" accessibilityRole="header" style={styles.section}>
      {children}
    </AppText>
  );
}

function Hint({ text, theme }: { text: string; theme: Theme }) {
  return (
    <View style={styles.hint}>
      <Icon name="info" color={theme.warning} size={16} />
      <AppText variant="caption" color={theme.warning} style={styles.grow}>
        {text}
      </AppText>
    </View>
  );
}

/**
 * One line under the big amount: the limit when a keypress went past it, otherwise the typed
 * digits grouped ("₹1,00,00,000") once there are enough zeros to miscount. Fixed height, so the
 * form doesn't jump while typing.
 */
function AmountHint({
  atCap,
  readable,
  limit,
  theme,
}: {
  atCap: boolean;
  readable: string | null;
  limit: string;
  theme: Theme;
}) {
  const text = atCap ? `Up to ${limit} in one expense` : readable;
  return (
    <AppText
      variant="caption"
      color={atCap ? theme.warning : theme.muted}
      style={styles.amountHint}
      accessibilityLiveRegion={atCap ? 'polite' : 'none'}
      numberOfLines={1}
    >
      {text ?? ' '}
    </AppText>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 8, gap: 12, paddingBottom: 48 },
  grow: { flex: 1, minWidth: 0 },
  medium: { fontWeight: '500' },
  bold: { fontWeight: '600' },
  amountBlock: { alignItems: 'center', paddingVertical: 8 },
  amountLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amountHint: { minHeight: 16, textAlign: 'center' },
  rateCard: { gap: 8, padding: 14, borderRadius: 18 },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rateInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'right',
  },
  fieldsCard: { padding: 0, borderRadius: 18 },
  field: { paddingHorizontal: 14, paddingVertical: 10 },
  fieldDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  descriptionInput: { fontSize: 16, paddingVertical: 4, paddingHorizontal: 0 },
  dateField: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  fieldDividerTop: { borderTopWidth: StyleSheet.hairlineWidth },
  section: { fontWeight: '600', marginTop: 6 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  allToggle: { minHeight: 32, justifyContent: 'flex-end' },
  membersCard: { paddingVertical: 4, paddingHorizontal: 14, borderRadius: 18 },
  noteCard: { gap: 10, padding: 14, borderRadius: 18 },
  repeatBlock: { gap: 8 },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  noteInput: { minHeight: 64, fontSize: 16, paddingVertical: 4 },
  counter: { alignSelf: 'flex-end' },
  noteDivider: { height: StyleSheet.hairlineWidth },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallInput: {
    width: 96,
    textAlign: 'right',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  splitInput: { width: 76 },
  preview: { width: 92, textAlign: 'right' },
  hint: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  linkButton: { paddingVertical: 4, alignSelf: 'flex-start' },
  error: { marginTop: 4 },
  submit: { marginTop: 12 },
});
