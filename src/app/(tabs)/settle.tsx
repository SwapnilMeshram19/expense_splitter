import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { groupMembersQuery } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { formatMoney } from '@/domain/currency';
import { useApprox } from '@/features/fx/useApprox';
import { loadOverview, OVERVIEW_TABLES, type MyTransfer } from '@/features/overview/loadOverview';
import { getPendingUpiPayment } from '@/features/upi/pendingUpiPayment';
import { useRegionPreference } from '@/features/region/regionPreference';
import { PendingUpiBanner } from '@/features/upi/PendingUpiBanner';
import { useSyncRefreshControl } from '@/sync/useSyncRefreshControl';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { TabHeader } from '@/ui/TabHeader';
import { useTheme } from '@/ui/theme';

const load = () => loadOverview(db, getDeviceUserId());

interface PendingContext {
  groupId: string;
  names: Map<string, string>;
}

export default function SettleTab() {
  const theme = useTheme();
  const overview = useLiveData(OVERVIEW_TABLES, load);
  const refreshControl = useSyncRefreshControl();
  const [pending, setPending] = useState<PendingContext | null>(null);
  const { homeCurrency } = useRegionPreference();
  const approx = useApprox(overview.transfers.some((t) => t.currency !== homeCurrency));

  // The pending UPI payment lives in settings, which useLiveData doesn't watch: re-read on focus
  // (same approach as the group screen's banner, which this renders).
  useFocusEffect(
    useCallback(() => {
      const p = getPendingUpiPayment(appContext);
      setPending(
        p
          ? {
              groupId: p.groupId,
              names: new Map(groupMembersQuery(db, p.groupId).all().map((m) => [m.id, m.displayName])),
            }
          : null,
      );
    }, []),
  );

  const toPay = overview.transfers.filter((t) => t.direction === 'pay');
  const toReceive = overview.transfers.filter((t) => t.direction === 'receive');
  const pendingGroup = pending ? overview.groups.find((g) => g.group.id === pending.groupId) : undefined;

  return (
    <View style={styles.container}>
      <TabHeader title="Settle up" />
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        {pending && pendingGroup?.canEdit ? (
          <PendingUpiBanner
            groupId={pending.groupId}
            nameOf={(id) => pending.names.get(id) ?? 'Someone'}
          />
        ) : null}

        {overview.transfers.length === 0 ? (
          <Card style={styles.emptyCard}>
            <AppText variant="heading">You’re all settled up</AppText>
            <AppText color={theme.muted}>
              {overview.groups.length === 0
                ? 'Create or join a group to start splitting expenses.'
                : 'Nobody owes anything in your groups right now.'}
            </AppText>
          </Card>
        ) : null}

        {toPay.length > 0 ? (
          <Section
            title="You owe"
            totals={overview.totals.filter((x) => x.iOwe > 0).map((x) => formatMoney(x.iOwe, x.currency))}
            color={theme.negative}
          >
            {toPay.map((t) => (
              <PayCard key={key(t)} transfer={t} approx={approx(t.amountPaise, t.currency)} />
            ))}
          </Section>
        ) : null}

        {toReceive.length > 0 ? (
          <Section
            title="Owed to you"
            totals={overview.totals
              .filter((x) => x.owedToMe > 0)
              .map((x) => formatMoney(x.owedToMe, x.currency))}
            color={theme.positive}
          >
            <Card style={styles.listCard}>
              {toReceive.map((t, index) => (
                <ReceiveRow
                  key={key(t)}
                  transfer={t}
                  approx={approx(t.amountPaise, t.currency)}
                  last={index === toReceive.length - 1}
                />
              ))}
            </Card>
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

const key = (t: MyTransfer) => `${t.groupId}:${t.direction}:${t.counterpartyId}`;

function Section({
  title,
  totals,
  color,
  children,
}: {
  title: string;
  /** One formatted total per currency; never added across currencies. */
  totals: string[];
  color: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader} accessible accessibilityRole="header">
        <AppText variant="heading" style={styles.grow}>
          {title}
        </AppText>
        <View style={styles.totals}>
          {totals.map((text) => (
            <AppText key={text} variant="amount" color={color}>
              {text}
            </AppText>
          ))}
        </View>
      </View>
      {children}
    </View>
  );
}

/** UPI moves rupees only: other currencies are settled however people pay, then recorded. */
const canUseUpi = (t: MyTransfer) => t.currency === 'INR';

function PayCard({ transfer: t, approx }: { transfer: MyTransfer; approx: string | null }) {
  const theme = useTheme();
  const amount = formatMoney(t.amountPaise, t.currency);
  const record = () =>
    router.push({
      pathname: '/groups/[groupId]/settle',
      params: { groupId: t.groupId, from: t.meId, to: t.counterpartyId, amount: String(t.amountPaise) },
    });
  return (
    <Card style={styles.payCard}>
      <View style={styles.personRow}>
        <Avatar seed={t.counterpartyId} name={t.counterpartyName} />
        <View style={styles.grow}>
          <AppText variant="amount" style={styles.name} numberOfLines={1}>
            {t.counterpartyName}
          </AppText>
          <AppText variant="caption" color={theme.muted} numberOfLines={1}>
            {t.groupName}
          </AppText>
        </View>
        <View style={styles.amountCol}>
          <AppText variant="heading" color={theme.negative}>
            {amount}
          </AppText>
          {approx ? (
            <AppText variant="caption" color={theme.muted}>
              {approx}
            </AppText>
          ) : null}
        </View>
      </View>
      {t.canEdit && canUseUpi(t) ? (
        <View style={styles.actions}>
          <Button
            label="Pay with UPI"
            icon="arrowForward"
            style={styles.grow}
            accessibilityLabel={`Pay ${t.counterpartyName} ${amount} with UPI`}
            onPress={() =>
              router.push({
                pathname: '/groups/[groupId]/pay',
                params: { groupId: t.groupId, to: t.counterpartyId, amount: String(t.amountPaise) },
              })
            }
          />
          <Button
            label="Record cash"
            variant="secondary"
            accessibilityLabel={`Record a cash payment to ${t.counterpartyName}`}
            onPress={record}
          />
        </View>
      ) : t.canEdit ? (
        <Button
          label="Record payment"
          variant="secondary"
          accessibilityLabel={`Record a payment of ${amount} to ${t.counterpartyName}`}
          onPress={record}
        />
      ) : (
        <AppText variant="caption" color={theme.warning}>
          Read-only: this group is no longer shared with you.
        </AppText>
      )}
    </Card>
  );
}

function ReceiveRow({
  transfer: t,
  approx,
  last,
}: {
  transfer: MyTransfer;
  approx: string | null;
  last: boolean;
}) {
  const theme = useTheme();
  const amount = formatMoney(t.amountPaise, t.currency);
  const upi = canUseUpi(t);
  return (
    <View style={[styles.receiveRow, !last && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Avatar seed={t.counterpartyId} name={t.counterpartyName} />
      <View style={styles.grow}>
        <AppText variant="amount" style={styles.name} numberOfLines={1}>
          {t.counterpartyName}
        </AppText>
        <AppText variant="caption" color={theme.muted} numberOfLines={1}>
          {t.groupName}
        </AppText>
      </View>
      <View style={styles.receiveRight}>
        <AppText variant="amount" color={theme.positive}>
          {amount}
        </AppText>
        {approx ? (
          <AppText variant="caption" color={theme.muted}>
            {approx}
          </AppText>
        ) : null}
        {t.canEdit ? (
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={
              upi
                ? `Request ${amount} from ${t.counterpartyName}`
                : `Record ${amount} received from ${t.counterpartyName}`
            }
            onPress={() =>
              upi
                ? router.push({
                    pathname: '/groups/[groupId]/request',
                    params: { groupId: t.groupId, from: t.counterpartyId, amount: String(t.amountPaise) },
                  })
                : router.push({
                    pathname: '/groups/[groupId]/settle',
                    params: {
                      groupId: t.groupId,
                      from: t.counterpartyId,
                      to: t.meId,
                      amount: String(t.amountPaise),
                    },
                  })
            }
          >
            <AppText variant="label" color={theme.onPrimarySoft} style={styles.link}>
              {upi ? 'Request' : 'Record'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 20 },
  emptyCard: { gap: 8 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline' },
  totals: { alignItems: 'flex-end' },
  amountCol: { alignItems: 'flex-end' },
  grow: { flex: 1, minWidth: 0 },
  payCard: { gap: 12, padding: 14, borderRadius: 18 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 8 },
  listCard: { paddingVertical: 4, paddingHorizontal: 14, borderRadius: 18 },
  receiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  receiveRight: { alignItems: 'flex-end', gap: 2 },
  link: { fontWeight: '600' },
});
