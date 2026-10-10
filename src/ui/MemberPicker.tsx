import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { Chip } from './Chip';
import { Input } from './Field';
import { Icon } from './Icon';
import { CHIP_LIMIT, filterMembers, SEARCH_THRESHOLD, type PickerMember } from './memberFilter';
import { useTheme } from './theme';

interface MemberPickerProps {
  /** Spoken/visible name of the choice, e.g. "Paid by". */
  label: string;
  members: readonly PickerMember[];
  value: string;
  onChange: (memberId: string) => void;
}

/**
 * Single choice of a group member. Small groups get chips; bigger groups get a field that opens
 * a bottom sheet (with search from SEARCH_THRESHOLD people), so a 20-person trip doesn't turn
 * into a long sideways scroll of chips.
 */
export function MemberPicker({ label, members, value, onChange }: MemberPickerProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = members.find((m) => m.id === value);

  if (members.length <= CHIP_LIMIT) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {members.map((m) => (
          <Chip key={m.id} label={m.name} selected={m.id === value} onPress={() => onChange(m.id)} />
        ))}
      </ScrollView>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.name ?? 'nobody'}. Change`}
        style={({ pressed }) => [
          styles.field,
          { backgroundColor: theme.surface, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        {selected ? <Avatar seed={selected.id} name={selected.name} size={32} /> : null}
        <AppText style={styles.grow} numberOfLines={1}>
          {selected?.name ?? 'Choose'}
        </AppText>
        <Icon name="chevronDown" color={theme.muted} size={20} />
      </Pressable>
      {open ? (
        <MemberSheet
          title={label}
          members={members}
          value={value}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function MemberSheet({
  title,
  members,
  value,
  onPick,
  onClose,
}: {
  title: string;
  members: readonly PickerMember[];
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const shown = filterMembers(members, query);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View
          style={[styles.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + 12 }]}
          accessibilityViewIsModal
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.sheetHeader}>
            <AppText variant="heading" accessibilityRole="header" style={styles.grow}>
              {title}
            </AppText>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
              <Icon name="close" color={theme.muted} />
            </Pressable>
          </View>
          {members.length > SEARCH_THRESHOLD ? (
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search people"
              accessibilityLabel="Search people"
              autoCorrect={false}
              style={styles.search}
            />
          ) : null}
          <View style={styles.list}>
            <FlashList
              data={shown}
              keyExtractor={(m) => m.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <AppText color={theme.muted} style={styles.empty}>
                  No one called “{query.trim()}”.
                </AppText>
              }
              renderItem={({ item }) => {
                const isSelected = item.id === value;
                return (
                  <Pressable
                    onPress={() => onPick(item.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    style={({ pressed }) => [
                      styles.row,
                      isSelected && { backgroundColor: theme.primarySoft },
                      { opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Avatar seed={item.id} name={item.name} size={36} />
                    <AppText
                      style={[styles.grow, isSelected && styles.bold]}
                      color={isSelected ? theme.onPrimarySoft : theme.text}
                      numberOfLines={1}
                    >
                      {item.name}
                    </AppText>
                    {isSelected ? <Icon name="check" color={theme.onPrimarySoft} size={20} /> : null}
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
  chips: { gap: 8, paddingVertical: 2 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 52,
  },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  backdropWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 8, maxHeight: '80%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  search: { marginBottom: 8 },
  // FlashList needs a bounded height inside the sheet.
  list: { height: 360, maxHeight: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 8, borderRadius: 14 },
  empty: { padding: 16, textAlign: 'center' },
});
