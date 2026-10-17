import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { ExpenseCategory } from '@/db/schema';
import { categoryLabelKey, MAX_CATEGORY_LABEL_LENGTH } from '@/domain/categoryLabel';
import { AppText } from '@/ui/AppText';
import { BottomSheet } from '@/ui/BottomSheet';
import { CATEGORY_STYLE, CategoryTile } from '@/ui/CategoryTile';
import { Icon } from '@/ui/Icon';
import { TextInput } from '@/ui/Text';
import { useTheme } from '@/ui/theme';

import { categoryOptions } from './categoryOptions';

export interface CategoryChoice {
  category: ExpenseCategory;
  /** Custom name with category 'other'; '' otherwise. */
  label: string;
}

/**
 * Every category on one screen: search box (also creates a custom one), the built-ins as a grid,
 * then the group's own names. Replaces the sideways-scrolling chip row, where "Custom" sat at the
 * far end and most people never found it.
 */
export function CategoryPickerSheet({
  visible,
  value,
  suggestions,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: CategoryChoice;
  suggestions: readonly string[];
  onPick: (choice: CategoryChoice) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const options = categoryOptions(query, suggestions);
  const selectedCustomKey = value.category === 'other' ? categoryLabelKey(value.label.trim()) : null;

  const close = () => {
    setQuery('');
    onClose();
  };
  const pick = (choice: CategoryChoice) => {
    setQuery('');
    onPick(choice);
  };

  const nothing = options.builtIns.length === 0 && options.customs.length === 0 && !options.create;

  return (
    <BottomSheet visible={visible} onClose={close} title="Category">
      <View style={[styles.search, { backgroundColor: theme.surfaceAlt }]}>
        <Icon name="search" color={theme.muted} size={20} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search or add, e.g. Petrol, Rent"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          maxLength={MAX_CATEGORY_LABEL_LENGTH + 10}
          onSubmitEditing={() => {
            if (options.create) pick({ category: 'other', label: options.create });
          }}
          accessibilityLabel="Search or add a category"
          style={styles.searchInput}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
            <Icon name="close" color={theme.muted} size={18} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {options.create ? (
          <Pressable
            onPress={() => pick({ category: 'other', label: options.create! })}
            accessibilityRole="button"
            style={[styles.createRow, { backgroundColor: theme.primarySoft }]}
          >
            <Icon name="add" color={theme.onPrimarySoft} size={20} />
            <AppText color={theme.onPrimarySoft} style={styles.bold} numberOfLines={1}>
              Add “{options.create}”
            </AppText>
          </Pressable>
        ) : null}
        {options.tooLong ? (
          <AppText variant="caption" color={theme.negative}>
            Keep it under {MAX_CATEGORY_LABEL_LENGTH} characters.
          </AppText>
        ) : null}

        {options.builtIns.length > 0 ? (
          <View style={styles.grid}>
            {options.builtIns.map((category) => {
              const selected = value.category === category;
              return (
                <Pressable
                  key={category}
                  onPress={() => pick({ category, label: '' })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={CATEGORY_STYLE[category].label}
                  style={styles.cell}
                >
                  <View
                    style={[
                      styles.tileRing,
                      { borderColor: selected ? theme.primary : 'transparent' },
                    ]}
                  >
                    <CategoryTile category={category} size={48} />
                  </View>
                  <AppText
                    variant="caption"
                    numberOfLines={1}
                    color={selected ? theme.onPrimarySoft : theme.text}
                    style={[styles.cellLabel, selected && styles.bold]}
                  >
                    {CATEGORY_STYLE[category].label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {options.customs.length > 0 ? (
          <>
            <AppText variant="label" color={theme.muted} style={styles.sectionTitle}>
              Used in this group
            </AppText>
            <View style={styles.chips}>
              {options.customs.map((label) => {
                const selected = selectedCustomKey === categoryLabelKey(label);
                return (
                  <Pressable
                    key={label}
                    onPress={() => pick({ category: 'other', label })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    style={[
                      styles.chip,
                      {
                        borderColor: selected ? theme.primary : theme.border,
                        backgroundColor: selected ? theme.primarySoft : theme.surface,
                      },
                    ]}
                  >
                    <Icon name="catOther" color={selected ? theme.onPrimarySoft : theme.muted} size={16} />
                    <AppText variant="label" color={selected ? theme.onPrimarySoft : theme.text} numberOfLines={1}>
                      {label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {nothing ? (
          <AppText variant="label" color={theme.muted} style={styles.empty}>
            No match.
          </AppText>
        ) : null}

        <AppText variant="caption" color={theme.muted}>
          Names you add are shared with the group.
        </AppText>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 12, minHeight: 46 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 10 },
  scroll: { maxHeight: 420 },
  content: { gap: 12, paddingBottom: 4 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingHorizontal: 14, minHeight: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  cell: { width: '25%', alignItems: 'center', gap: 4 },
  tileRing: { borderWidth: 2, borderRadius: 20, padding: 2 },
  cellLabel: { textAlign: 'center', paddingHorizontal: 2 },
  sectionTitle: { fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, minHeight: 38, maxWidth: '100%' },
  empty: { textAlign: 'center', paddingVertical: 8 },
  bold: { fontWeight: '600' },
});
