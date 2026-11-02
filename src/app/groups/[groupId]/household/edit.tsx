import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { dataStore } from '@/data';
import { runCommand } from '@/data/hooks';
import { currencyPrefix, sanitizeMoneyInput } from '@/domain/currency';
import {
  MAX_SERVICE_NAME_LENGTH,
  monthOf,
  monthStart,
  SERVICE_UNITS,
  unitStep,
  unitWord,
  type ServiceUnit,
} from '@/domain/household';
import { nameIn } from '@/features/household/actions';
import { describeHouseholdError } from '@/features/household/messages';
import { QtyStepper } from '@/features/household/QtyStepper';
import {
  initialForm,
  priceChanged,
  TEMPLATES,
  toFields,
  type PriceFrom,
  type ServiceFormState,
} from '@/features/household/serviceForm';
import { newId } from '@/lib/newId';
import { formatIsoDate, fromIsoDate, toLocalIsoDate, todayIsoDate } from '@/lib/dates';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { AmountInput, FieldLabel, Input } from '@/ui/Field';
import { HeaderIconButton } from '@/ui/HeaderIconButton';
import { Icon } from '@/ui/Icon';
import { Segmented } from '@/ui/Segmented';
import { useTheme } from '@/ui/theme';

const KINDS = [
  { value: 'per_unit', label: 'Per unit' },
  { value: 'monthly', label: 'Monthly fee' },
] as const;
const UNIT_LABELS: Record<ServiceUnit, string> = {
  L: 'Litre',
  kg: 'Kg',
  packet: 'Packet',
  can: 'Can',
  paper: 'Paper',
  item: 'Item',
};
// Monday first, as on the calendar; bit = Date#getDay().
const DAYS = [
  { bit: 1, short: 'M', name: 'Monday' },
  { bit: 2, short: 'T', name: 'Tuesday' },
  { bit: 3, short: 'W', name: 'Wednesday' },
  { bit: 4, short: 'T', name: 'Thursday' },
  { bit: 5, short: 'F', name: 'Friday' },
  { bit: 6, short: 'S', name: 'Saturday' },
  { bit: 0, short: 'S', name: 'Sunday' },
];
const PRICE_FROM: { value: PriceFrom; label: string }[] = [
  { value: 'month', label: '1st of this month' },
  { value: 'today', label: 'Today' },
  { value: 'start', label: 'All days' },
];

/** Add a home service, or edit one (?serviceId=…). */
export default function EditServiceScreen() {
  const { groupId, serviceId } = useLocalSearchParams<{ groupId: string; serviceId?: string }>();
  const theme = useTheme();
  const today = todayIsoDate();
  const setup = useMemo(() => {
    const snapshot = dataStore().group(groupId);
    const service = serviceId
      ? (snapshot?.householdServices.find((h) => h.id === serviceId.toLowerCase()) ?? null)
      : null;
    return { snapshot, service, currency: snapshot?.group.currency ?? 'INR' };
  }, [groupId, serviceId]);
  const { service, currency } = setup;
  const [state, setState] = useState<ServiceFormState>(() => initialForm(service, today, currency));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showIosDate, setShowIosDate] = useState(false);
  const update = (patch: Partial<ServiceFormState>) => {
    setState((s) => ({ ...s, ...patch }));
    setError(null);
  };

  if (!setup.snapshot || (serviceId && !service)) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Home service' }} />
        <AppText color={theme.muted}>This service no longer exists.</AppText>
      </View>
    );
  }

  const monthly = state.kind === 'monthly';
  const showPriceFrom = priceChanged(state, service, today, currency);

  const pickStart = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: fromIsoDate(state.startDate),
        mode: 'date',
        onValueChange: (_event, date) => {
          if (date) update({ startDate: toLocalIsoDate(date) });
        },
      });
    } else {
      setShowIosDate((v) => !v);
    }
  };

  const save = async () => {
    const built = toFields(state, service, today, currency);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    setBusy(true);
    const result = service
      ? await runCommand('household.update', {
          groupId,
          serviceId: service.id,
          expectedVersion: service.version,
          ...built.fields,
        })
      : await runCommand('household.create', { groupId, id: newId(), ...built.fields });
    setBusy(false);
    if (!result.ok) {
      setError(describeHouseholdError(result.error, nameIn(groupId), currency));
      return;
    }
    if (service) router.back();
    else
      router.replace({
        pathname: '/groups/[groupId]/household/[serviceId]',
        params: { groupId, serviceId: result.entityId },
      });
  };

  const confirmDelete = () => {
    if (!service) return;
    Alert.alert(
      `Remove ${service.name}?`,
      'Its days are removed. Bills already posted stay in the group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const result = await runCommand('household.delete', {
              groupId,
              serviceId: service.id,
              expectedVersion: service.version,
            });
            if (result.ok)
              router.dismissTo({ pathname: '/groups/[groupId]/household', params: { groupId } });
            else
              Alert.alert(
                'Couldn’t remove it',
                describeHouseholdError(result.error, nameIn(groupId), currency),
              );
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: service ? `Edit ${service.name}` : 'Add a service',
          headerRight: service
            ? () => (
                <HeaderIconButton
                  icon="delete"
                  label="Remove service"
                  onPress={confirmDelete}
                  color={theme.negative}
                />
              )
            : undefined,
        }}
      />
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {!service ? (
          <View style={styles.chips}>
            {TEMPLATES.map((t) => (
              <Chip
                key={t.label}
                label={t.label}
                selected={state.name === t.patch.name}
                onPress={() => update(t.patch)}
              />
            ))}
          </View>
        ) : null}

        <Card style={styles.card}>
          <FieldLabel>Name</FieldLabel>
          <Input
            value={state.name}
            onChangeText={(name) => update({ name })}
            placeholder="Milk, Maid, Newspaper…"
            maxLength={MAX_SERVICE_NAME_LENGTH}
            accessibilityLabel="Name"
          />

          <FieldLabel>Paid</FieldLabel>
          <Segmented
            options={KINDS}
            value={state.kind}
            onChange={(kind) => update({ kind })}
            accessibilityLabel="How it’s paid"
          />

          {!monthly ? (
            <>
              <FieldLabel>Counted in</FieldLabel>
              <View style={styles.chips}>
                {SERVICE_UNITS.map((u) => (
                  <Chip
                    key={u}
                    label={UNIT_LABELS[u]}
                    selected={state.unit === u}
                    onPress={() => {
                      const step = unitStep(u);
                      update({
                        unit: u,
                        defaultQty: Math.max(step, Math.round(state.defaultQty / step) * step),
                      });
                    }}
                  />
                ))}
              </View>
              <FieldLabel>Usually a day</FieldLabel>
              <QtyStepper
                value={state.defaultQty}
                step={unitStep(state.unit)}
                min={unitStep(state.unit)}
                unit={unitWord(state.unit)}
                onChange={(defaultQty) => update({ defaultQty })}
                label="Usual quantity a day"
              />
            </>
          ) : null}

          <FieldLabel>{monthly ? 'Monthly fee' : `Price per ${unitWord(state.unit)}`}</FieldLabel>
          <AmountInput
            value={state.priceText}
            onChangeText={(text) =>
              update({ priceText: sanitizeMoneyInput(text, state.priceText, currency) })
            }
            currency={currency}
            accessibilityLabel={
              monthly
                ? 'Monthly fee'
                : `Price per ${unitWord(state.unit)} in ${currencyPrefix(currency)}`
            }
          />
          {showPriceFrom ? (
            <>
              <AppText variant="label" color={theme.muted}>
                New price applies from
              </AppText>
              <View style={styles.chips}>
                {PRICE_FROM.map((p) => (
                  <Chip
                    key={p.value}
                    label={p.label}
                    selected={state.priceFrom === p.value}
                    onPress={() => update({ priceFrom: p.value })}
                  />
                ))}
              </View>
            </>
          ) : null}

          {monthly ? (
            <>
              <FieldLabel>Paid leaves a month</FieldLabel>
              <QtyStepper
                value={state.paidLeaves * 100}
                step={100}
                max={3100}
                unit={state.paidLeaves === 1 ? 'day' : 'days'}
                onChange={(v) => update({ paidLeaves: v / 100 })}
                label="Paid leaves a month"
              />
              <AppText variant="caption" color={theme.muted}>
                Absences beyond these are cut from the fee, day by day.
              </AppText>
            </>
          ) : null}
        </Card>

        <Card style={styles.card}>
          <FieldLabel>{monthly ? 'Works on' : 'Comes on'}</FieldLabel>
          <View style={styles.days}>
            {DAYS.map((d) => {
              const on = (state.weekdays & (1 << d.bit)) !== 0;
              return (
                <Pressable
                  key={d.name}
                  onPress={() => update({ weekdays: state.weekdays ^ (1 << d.bit) })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={d.name}
                  style={[
                    styles.day,
                    {
                      backgroundColor: on ? theme.primarySoft : theme.surface,
                      borderColor: on ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <AppText variant="label" color={on ? theme.onPrimarySoft : theme.muted}>
                    {d.short}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <FieldLabel>Started on</FieldLabel>
          <View style={styles.chips}>
            <Chip
              label="1st of this month"
              selected={state.startDate === monthStart(monthOf(today))}
              onPress={() => update({ startDate: monthStart(monthOf(today)) })}
            />
            <Chip
              label="Today"
              selected={state.startDate === today}
              onPress={() => update({ startDate: today })}
            />
            <Pressable
              onPress={pickStart}
              accessibilityRole="button"
              accessibilityLabel={`Start date, ${formatIsoDate(state.startDate)}. Change`}
              style={[styles.dateChip, { borderColor: theme.border }]}
            >
              <Icon name="calendar" color={theme.muted} size={18} />
              <AppText variant="label">{formatIsoDate(state.startDate)}</AppText>
            </Pressable>
          </View>
          {Platform.OS === 'ios' && showIosDate ? (
            <DateTimePicker
              value={fromIsoDate(state.startDate)}
              mode="date"
              display="inline"
              onValueChange={(_event, date) => {
                if (date) update({ startDate: toLocalIsoDate(date) });
              }}
            />
          ) : null}

          {service ? (
            <>
              <FieldLabel>Status</FieldLabel>
              <View style={styles.chips}>
                <Chip
                  label="Ongoing"
                  selected={state.endDate === null}
                  onPress={() => update({ endDate: null })}
                />
                <Chip
                  label={
                    state.endDate ? `Stopped ${formatIsoDate(state.endDate)}` : 'Stopped today'
                  }
                  selected={state.endDate !== null}
                  onPress={() => update({ endDate: state.endDate ?? today })}
                />
              </View>
            </>
          ) : null}
        </Card>

        {error ? (
          <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
            {error}
          </AppText>
        ) : null}
        <Button
          label={service ? 'Save' : 'Add service'}
          size="lg"
          busy={busy}
          onPress={() => void save()}
        />
        <AppText variant="caption" color={theme.muted} style={styles.note}>
          Everyone in the group sees and can mark it. Needs internet to save.
        </AppText>
      </KeyboardAwareScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  days: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  day: {
    flex: 1,
    maxWidth: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  note: { textAlign: 'center' },
});
