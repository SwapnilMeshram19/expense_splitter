import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { currentUserId, dataStore } from '@/data';
import { runCommand, useData } from '@/data/hooks';
import { useRefreshControl } from '@/data/useRefreshControl';
import { formatMoney } from '@/domain/currency';
import { billDescription, monthLabel, monthOf } from '@/domain/household';
import { DaySheet, type DaySheetTarget } from '@/features/household/DaySheet';
import { nameIn } from '@/features/household/actions';
import { describeHouseholdError } from '@/features/household/messages';
import { MonthCalendar } from '@/features/household/MonthCalendar';
import { billUpTo, defaultBillPeople, loadServiceMonth } from '@/features/household/view';
import { ShareButtons } from '@/features/share/ShareButtons';
import { newId } from '@/lib/newId';
import { formatIsoDate, todayIsoDate } from '@/lib/dates';
import { AppText } from '@/ui/AppText';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';
import { HeaderIconButton } from '@/ui/HeaderIconButton';
import { useTheme } from '@/ui/theme';

/** One service: its month on a calendar (tap a day to change it) and the month's bill. */
export default function ServiceScreen() {
  const { groupId, serviceId } = useLocalSearchParams<{ groupId: string; serviceId: string }>();
  const theme = useTheme();
  const today = todayIsoDate();
  const [month, setMonth] = useState(monthOf(today));
  const [day, setDay] = useState<DaySheetTarget | null>(null);
  const [posting, setPosting] = useState(false);
  const refreshControl = useRefreshControl();
  const view = useData(
    () => loadServiceMonth(dataStore().group(groupId), serviceId, month, currentUserId(), today),
    [groupId, serviceId, month, today],
  );

  if (!view) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Home service' }} />
        <AppText color={theme.muted}>This service no longer exists.</AppText>
      </View>
    );
  }

  const { service, bill, currency, posted } = view;
  const money = (minor: number) => formatMoney(minor, currency);
  const canEdit = view.me !== null;
  const billText = () =>
    [
      `${billDescription(service.name, month)}: ${bill ? money(bill.amountPaise) : ''}`,
      ...view.billText,
    ].join('\n');

  return (
    <>
      <Stack.Screen
        options={{
          title: service.name,
          headerRight: canEdit
            ? () => (
                <HeaderIconButton
                  icon="edit"
                  label="Edit service"
                  onPress={() =>
                    router.push({
                      pathname: '/groups/[groupId]/household/edit',
                      params: { groupId, serviceId: service.id },
                    })
                  }
                />
              )
            : undefined,
        }}
      />
      <ScrollView contentContainerStyle={styles.container} refreshControl={refreshControl}>
        <Card style={styles.card}>
          <View style={styles.monthRow}>
            <HeaderIconButton
              icon="back"
              label="Previous month"
              onPress={() => view.prevMonth && setMonth(view.prevMonth)}
              color={view.prevMonth ? theme.text : theme.border}
            />
            <AppText variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite">
              {monthLabel(month)}
            </AppText>
            <HeaderIconButton
              icon="chevronRight"
              label="Next month"
              onPress={() => view.nextMonth && setMonth(view.nextMonth)}
              color={view.nextMonth ? theme.text : theme.border}
            />
          </View>
          <MonthCalendar
            days={view.days}
            leadingBlanks={view.leadingBlanks}
            showQty={service.kind === 'per_unit'}
            onPressDay={
              canEdit ? (d) => setDay({ date: d.date, qty: d.qty, state: d.state }) : undefined
            }
          />
          <AppText variant="caption" color={theme.muted}>
            {canEdit ? 'Tap a day to change it. ' : ''}
            {service.kind === 'monthly' ? '× = absent.' : '× = none, numbers = a different amount.'}
          </AppText>
        </Card>

        {bill ? (
          <Card style={styles.card}>
            <View style={styles.billHead}>
              <View style={styles.grow}>
                <AppText variant="label" color={theme.muted}>
                  {bill.complete ? 'Bill' : `Bill till ${formatIsoDate(bill.upTo)}`}
                </AppText>
                <AppText variant="title">{money(bill.amountPaise)}</AppText>
              </View>
            </View>
            {view.billText.map((line) => (
              <AppText key={line} variant="label" color={theme.muted}>
                {line}
              </AppText>
            ))}

            {posted ? (
              <AppText variant="label" color={view.billChanged ? theme.warning : theme.positive}>
                {view.billChanged
                  ? `Posted to the group as ${money(posted.amountPaise)}. The days changed since.`
                  : 'Posted to the group.'}
              </AppText>
            ) : null}

            <View style={styles.actions}>
              {view.canPost ? (
                <Button
                  label={posted ? 'Update the posted bill' : 'Post to the group'}
                  icon={posted ? 'cloudSync' : 'send'}
                  onPress={() => setPosting(true)}
                  style={styles.grow}
                />
              ) : null}
              {posted ? (
                <Button
                  label="Open expense"
                  variant="secondary"
                  onPress={() =>
                    router.push({
                      pathname: '/groups/[groupId]/expenses/[expenseId]',
                      params: { groupId, expenseId: posted.id },
                    })
                  }
                  style={styles.grow}
                />
              ) : null}
            </View>
            {bill.amountPaise > 0 ? (
              <ShareButtons accessibilityLabel="Send the bill on WhatsApp" getText={billText} />
            ) : null}
          </Card>
        ) : (
          <AppText color={theme.muted} style={styles.plan}>
            Mark days ahead, like “no milk” while you travel. The bill shows once the month starts.
          </AppText>
        )}
      </ScrollView>

      <DaySheet groupId={groupId} service={service} target={day} onClose={() => setDay(null)} />
      {posting && bill ? (
        <PostBillSheet
          groupId={groupId}
          serviceId={service.id}
          month={month}
          upTo={billUpTo(month, today)}
          amount={money(bill.amountPaise)}
          onClose={() => setPosting(false)}
        />
      ) : null}
    </>
  );
}

/** Who paid the vendor and who shares the bill (equal split), then post or update. */
function PostBillSheet({
  groupId,
  serviceId,
  month,
  upTo,
  amount,
  onClose,
}: {
  groupId: string;
  serviceId: string;
  month: string;
  upTo: string;
  amount: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const setup = useData(() => {
    const snapshot = dataStore().group(groupId);
    const service = snapshot?.householdServices.find((h) => h.id === serviceId);
    if (!snapshot || !service) return null;
    const postedId = service.bills[month];
    const posted = postedId ? (snapshot.expenses.find((e) => e.id === postedId) ?? null) : null;
    const me =
      snapshot.members.find((m) => m.userId === currentUserId() && m.deletedAt === null)?.id ??
      null;
    return {
      snapshot,
      service,
      posted,
      members: snapshot.members.filter((m) => m.deletedAt === null),
      defaults: defaultBillPeople(snapshot, posted, me),
    };
  }, [groupId, serviceId, month]);
  // Versions as the sheet was opened: a bill someone else posts or edits meanwhile is refused
  // (STALE), never silently overwritten with this person's payer and split.
  const [base] = useState(() => ({
    service: setup?.service.version ?? 0,
    posted: setup?.posted?.version ?? null,
  }));
  const [paidBy, setPaidBy] = useState(setup?.defaults.paidBy ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(setup?.defaults.memberIds ?? []);
  const [busy, setBusy] = useState(false);
  if (!setup) return null;

  const toggle = (id: string) =>
    setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const post = async () => {
    setBusy(true);
    const result = await runCommand('household.postBill', {
      groupId,
      serviceId,
      expectedVersion: base.service,
      month,
      upTo,
      expenseId: newId(),
      expectedExpenseVersion: base.posted,
      paidByMemberId: paidBy,
      memberIds,
    });
    setBusy(false);
    if (result.ok) onClose();
    else
      Alert.alert(
        'Couldn’t post the bill',
        describeHouseholdError(result.error, nameIn(groupId), setup.snapshot.group.currency),
      );
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={setup.posted ? `Update to ${amount}` : `Post ${amount}`}
    >
      <AppText variant="label" color={theme.muted}>
        Paid by
      </AppText>
      <View style={styles.chips}>
        {setup.members.map((m) => (
          <Chip
            key={m.id}
            label={m.displayName}
            selected={paidBy === m.id}
            onPress={() => setPaidBy(m.id)}
          />
        ))}
      </View>
      <AppText variant="label" color={theme.muted}>
        Split equally between
      </AppText>
      <View style={styles.chips}>
        {setup.members.map((m) => (
          <Chip
            key={m.id}
            label={m.displayName}
            selected={memberIds.includes(m.id)}
            onPress={() => toggle(m.id)}
          />
        ))}
      </View>
      <Button
        label={setup.posted ? 'Update expense' : 'Add as expense'}
        size="lg"
        busy={busy}
        disabled={!paidBy || memberIds.length === 0}
        onPress={() => void post()}
      />
      <AppText variant="caption" color={theme.muted}>
        It’s an ordinary expense: balances and settle-up include it. Needs internet.
      </AppText>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { gap: 10 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  billHead: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  plan: { paddingHorizontal: 4 },
});
