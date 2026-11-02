import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { currentUserId, dataStore } from '@/data';
import { useData } from '@/data/hooks';
import { useRefreshControl } from '@/data/useRefreshControl';
import { formatMoney } from '@/domain/currency';
import { markId, unitStep, unitWord } from '@/domain/household';
import { saveMark } from '@/features/household/actions';
import { QtyStepper } from '@/features/household/QtyStepper';
import { loadHouseholdList, type ServiceToday } from '@/features/household/view';
import { formatDayLine, todayIsoDate } from '@/lib/dates';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { HeaderIconButton } from '@/ui/HeaderIconButton';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

/**
 * Home services of a group: today's milk, maid, newspaper… with one-tap changes, and this month
 * so far. Days are as usual unless someone changes them, so most mornings need no tap at all.
 */
export default function HouseholdScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const today = todayIsoDate();
  const view = useData(
    () => loadHouseholdList(dataStore().group(groupId), currentUserId(), today),
    [groupId, today],
  );
  const refreshControl = useRefreshControl();
  const [saving, setSaving] = useState<string | null>(null);

  const openService = (serviceId: string) =>
    router.push({
      pathname: '/groups/[groupId]/household/[serviceId]',
      params: { groupId, serviceId },
    });
  const addService = () =>
    router.push({ pathname: '/groups/[groupId]/household/edit', params: { groupId } });

  const setToday = async (item: ServiceToday, qty: number) => {
    setSaving(item.service.id);
    const error = await saveMark(groupId, item.service.id, today, qty === item.usual ? null : qty);
    setSaving(null);
    if (error) Alert.alert('Couldn’t save', error);
  };

  if (!view) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Home services' }} />
        <AppText color={theme.muted}>This group isn’t available.</AppText>
      </View>
    );
  }
  const canEdit = view.me !== null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Home services',
          headerRight: canEdit
            ? () => <HeaderIconButton icon="add" label="Add a service" onPress={addService} />
            : undefined,
        }}
      />
      <ScrollView contentContainerStyle={styles.container} refreshControl={refreshControl}>
        {view.items.length === 0 ? (
          <Card style={styles.empty}>
            <Icon name="home" color={theme.muted} size={28} />
            <AppText variant="heading" style={styles.center}>
              Milk, maid, newspaper…
            </AppText>
            <AppText color={theme.muted} style={styles.centerText}>
              Every day counts as usual. Only mark the days that change, and post the month’s bill
              to the group.
            </AppText>
            {canEdit ? <Button label="Add a service" icon="add" onPress={addService} /> : null}
          </Card>
        ) : (
          <>
            <AppText variant="label" color={theme.muted} accessibilityRole="header">
              {formatDayLine(new Date())}
            </AppText>
            {view.items.map((item) => (
              <ServiceCard
                key={item.service.id}
                item={item}
                currency={view.currency}
                canEdit={canEdit}
                busy={saving === item.service.id}
                queued={dataStore().pendingStatus(markId(item.service.id, today)) === 'queued'}
                onOpen={() => openService(item.service.id)}
                onSet={(qty) => setToday(item, qty)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}

function ServiceCard({
  item,
  currency,
  canEdit,
  busy,
  queued,
  onOpen,
  onSet,
}: {
  item: ServiceToday;
  currency: string;
  canEdit: boolean;
  busy: boolean;
  queued: boolean;
  onOpen: () => void;
  onSet: (qty: number) => Promise<void>;
}) {
  const theme = useTheme();
  const { service } = item;
  const monthly = service.kind === 'monthly';
  const showControls = canEdit && item.active && (!monthly || item.scheduled);

  // Taps on − / + settle for a moment before saving: "2.5 L" is one save, not three.
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const changeQty = (next: number) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (next === item.qty) setDraft(null);
      // The store shows the change at once; the draft goes when the save settles (or fails).
      else void onSet(next).finally(() => setDraft(null));
    }, 700);
  };

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${service.name}, ${item.status}, this month ${formatMoney(item.monthAmount, currency)}. Open calendar`}
        style={({ pressed }) => [styles.top, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={styles.grow}>
          <AppText variant="heading" numberOfLines={1}>
            {service.name}
          </AppText>
          <AppText
            variant="label"
            color={item.qty === item.usual ? theme.muted : theme.warning}
            numberOfLines={1}
          >
            {item.status}
            {queued ? ' · not sent yet' : ''}
          </AppText>
        </View>
        <View style={styles.right}>
          <AppText variant="amount">{formatMoney(item.monthAmount, currency)}</AppText>
          <AppText variant="caption" color={item.billChanged ? theme.warning : theme.muted}>
            {item.billChanged ? 'Bill changed' : 'This month'}
          </AppText>
        </View>
        <Icon name="chevronRight" color={theme.muted} size={20} />
      </Pressable>

      {showControls ? (
        <View style={[styles.controls, { borderTopColor: theme.border }]}>
          {monthly ? (
            <View style={styles.chips}>
              <Chip
                label="Came"
                selected={item.qty > 0}
                onPress={() => void (item.qty === 0 && !busy && onSet(item.usual))}
              />
              <Chip
                label="Absent"
                selected={item.qty === 0}
                onPress={() => void (item.qty > 0 && !busy && onSet(0))}
              />
            </View>
          ) : (
            <QtyStepper
              value={draft ?? item.qty}
              step={unitStep(service.unit)}
              unit={unitWord(service.unit)}
              onChange={changeQty}
              label={`${service.name} today`}
            />
          )}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
  },
  centerText: { textAlign: 'center' },
  empty: { alignItems: 'center', gap: 10, padding: 20 },
  card: { padding: 0, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  grow: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chips: { flexDirection: 'row', gap: 8 },
});
