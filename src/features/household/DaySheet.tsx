import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { formatQtyWithUnit, unitStep, unitWord, usualQty, type DayState } from '@/domain/household';
import type { HouseholdService } from '@/domain/model';
import { fromIsoDate, formatDayLine } from '@/lib/dates';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { useTheme } from '@/ui/theme';
import { AppText } from '@/ui/AppText';

import { saveMark } from './actions';
import { QtyStepper } from './QtyStepper';

export interface DaySheetTarget {
  date: string;
  qty: number;
  state: DayState;
}

/**
 * Change one day. Monthly services: came / absent. Per unit: usual, none, or any amount.
 * Saves on tap and closes; offline it is queued like a new expense.
 */
export function DaySheet(props: {
  groupId: string;
  service: HouseholdService;
  target: DaySheetTarget | null;
  onClose: () => void;
}) {
  // Keyed by day: each opening starts from that day's value.
  return props.target ? (
    <DaySheetBody key={props.target.date} {...props} target={props.target} />
  ) : null;
}

function DaySheetBody({
  groupId,
  service,
  target,
  onClose,
}: {
  groupId: string;
  service: HouseholdService;
  target: DaySheetTarget;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [qty, setQty] = useState(target.qty);
  const [busy, setBusy] = useState(false);
  const usual = usualQty(service, target.date);
  const title = formatDayLine(fromIsoDate(target.date));

  const save = async (value: number | null) => {
    setBusy(true);
    const error = await saveMark(groupId, service.id, target.date, value);
    setBusy(false);
    if (error) Alert.alert('Couldn’t save that day', error);
    else onClose();
  };

  return (
    <BottomSheet visible onClose={onClose} title={title}>
      {service.kind === 'monthly' ? (
        <View style={styles.row}>
          <Chip label="Came" selected={target.state !== 'absent'} onPress={() => void save(null)} />
          <Chip label="Absent" selected={target.state === 'absent'} onPress={() => void save(0)} />
        </View>
      ) : (
        <>
          <View style={styles.row}>
            <Chip
              label={
                usual > 0 ? `Usual (${formatQtyWithUnit(usual, service.unit)})` : 'Usual (none)'
              }
              selected={target.state === 'usual' || (target.state === 'off' && target.qty === 0)}
              onPress={() => void save(null)}
            />
            {usual > 0 ? (
              <Chip
                label="None"
                selected={target.state === 'absent'}
                onPress={() => void save(0)}
              />
            ) : null}
          </View>
          <View style={[styles.custom, { borderTopColor: theme.border }]}>
            <AppText variant="label" color={theme.muted}>
              Or a different amount
            </AppText>
            <View style={styles.customRow}>
              <QtyStepper
                value={qty}
                step={unitStep(service.unit)}
                unit={unitWord(service.unit)}
                onChange={setQty}
                label={`${service.name} on ${title}`}
              />
              <Button
                label="Save"
                size="sm"
                busy={busy}
                disabled={qty === target.qty}
                onPress={() => void save(qty)}
              />
            </View>
          </View>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  custom: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 8 },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
});
