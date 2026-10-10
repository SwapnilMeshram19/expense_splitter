import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { currencyInfo, currencyPrefix, type CurrencyCode } from '@/domain/currency';

import { AppText } from './AppText';
import { currencyOptions } from './currencyFilter';
import { Input } from './Field';
import { Icon } from './Icon';
import { useTheme } from './theme';

interface CurrencyPickerProps {
  /** Spoken/visible name of the choice, e.g. "Group currency". */
  label: string;
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
  /** Shown at the top of the list (group currency, recently used). */
  pinned?: readonly CurrencyCode[];
  /** 'field': full-width form row. 'pill': compact button beside an amount. */
  variant?: 'field' | 'pill';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Single choice of a currency, from a searchable bottom sheet. */
export function CurrencyPicker({
  label,
  value,
  onChange,
  pinned = [],
  variant = 'field',
  disabled = false,
  style,
}: CurrencyPickerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const info = currencyInfo(value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={`${label}: ${info.name}${disabled ? '' : '. Change'}`}
        style={({ pressed }) => [
          variant === 'field' ? styles.field : styles.pill,
          {
            backgroundColor: variant === 'field' ? theme.surface : theme.primarySoft,
            borderColor: variant === 'field' ? theme.border : theme.primarySoft,
            opacity: disabled ? 0.6 : pressed ? 0.7 : 1,
          },
          style,
        ]}
      >
        {variant === 'field' ? (
          <>
            <View style={[styles.badge, { backgroundColor: theme.surfaceAlt }]}>
              <AppText variant="label" style={styles.bold} numberOfLines={1}>
                {currencyPrefix(value)}
              </AppText>
            </View>
            <AppText style={styles.grow} numberOfLines={1}>
              {value} · {info.name}
            </AppText>
            {disabled ? (
              <Icon name="lock" color={theme.muted} size={18} />
            ) : (
              <Icon name="chevronDown" color={theme.muted} size={20} />
            )}
          </>
        ) : (
          <>
            <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
              {value}
            </AppText>
            <Icon name="chevronDown" color={theme.onPrimarySoft} size={16} />
          </>
        )}
      </Pressable>
      {open ? (
        <CurrencySheet
          title={label}
          value={value}
          pinned={pinned}
          onPick={(code) => {
            onChange(code);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function CurrencySheet({
  title,
  value,
  pinned,
  onPick,
  onClose,
}: {
  title: string;
  value: CurrencyCode;
  pinned: readonly CurrencyCode[];
  onPick: (code: CurrencyCode) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const shown = currencyOptions(query, [value, ...pinned]);

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.backdropWrap}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, paddingBottom: insets.bottom + 12 },
          ]}
          accessibilityViewIsModal
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.sheetHeader}>
            <AppText variant="heading" accessibilityRole="header" style={styles.grow}>
              {title}
            </AppText>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <Icon name="close" color={theme.muted} />
            </Pressable>
          </View>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search: USD, dirham, baht…"
            accessibilityLabel="Search currencies"
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.search}
          />
          <View style={styles.list}>
            <FlashList
              data={shown}
              keyExtractor={(c) => c.code}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <AppText color={theme.muted} style={styles.empty}>
                  No currency matches “{query.trim()}”.
                </AppText>
              }
              renderItem={({ item }) => {
                const selected = item.code === value;
                return (
                  <Pressable
                    onPress={() => onPick(item.code)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${item.name}, ${item.code}`}
                    style={({ pressed }) => [
                      styles.row,
                      selected && { backgroundColor: theme.primarySoft },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <AppText variant="label" style={[styles.code, styles.bold]}>
                      {item.code}
                    </AppText>
                    <AppText
                      style={[styles.grow, selected && styles.bold]}
                      color={selected ? theme.onPrimarySoft : theme.text}
                      numberOfLines={1}
                    >
                      {item.name}
                    </AppText>
                    <AppText variant="caption" color={theme.muted}>
                      {item.symbol}
                    </AppText>
                    {selected ? <Icon name="check" color={theme.onPrimarySoft} size={20} /> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 52,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    minHeight: 32,
  },
  badge: {
    minWidth: 36,
    paddingHorizontal: 6,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  code: { width: 44 },
  backdropWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '85%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  search: { marginBottom: 8 },
  // FlashList needs a bounded height inside the sheet.
  list: { height: 420, maxHeight: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  empty: { padding: 16, textAlign: 'center' },
});
