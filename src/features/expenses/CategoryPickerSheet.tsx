import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type TextInput as RNTextInput } from 'react-native';

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
 * Every category on one screen: the built-ins as a grid with a "Custom" tile at the end, the
 * group's own names below, and a box on top that searches and creates. Tapping "Custom" turns the
 * box into a name field with an Add button, so creating a category never depends on knowing that
 * the search box can do it.
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
  /** "Custom" tapped: the box is a name field and the grid steps aside. */
  const [naming, setNaming] = useState(false);
  /** While typing, the sheet sits at the top so the keyboard can't cover the box. */
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<RNTextInput>(null);
  const options = categoryOptions(query, suggestions);
  const selectedCustomKey = value.category === 'other' ? categoryLabelKey(value.label.trim()) : null;

  const reset = () => {
    setQuery('');
    setNaming(false);
    setTyping(false);
  };
  const close = () => {
    reset();
    onClose();
  };
  const pick = (choice: CategoryChoice) => {
    reset();
    onPick(choice);
  };
  const startNaming = () => {
    setNaming(true);
    // Next frame: the input is already mounted, focusing raises the keyboard.
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const create = () => {
    if (options.create) pick({ category: 'other', label: options.create });
  };

  const showGrid = !naming && options.builtIns.length > 0;
  const nothing = !naming && options.builtIns.length === 0 && options.customs.length === 0 && !options.create;

  return (
    <BottomSheet visible={visible} onClose={close} title={naming ? 'New category' : 'Category'} raised={typing}>
      <View
        style={[
          styles.search,
          { backgroundColor: theme.surfaceAlt, borderColor: naming ? theme.primary : 'transparent' },
        ]}
      >
        <Icon name={naming ? 'catOther' : 'search'} color={naming ? theme.onPrimarySoft : theme.muted} size={20} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder={naming ? 'Name it, e.g. Petrol, Rent, Maid' : 'Search categories'}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType={naming ? 'done' : 'search'}
          maxLength={MAX_CATEGORY_LABEL_LENGTH + 10}
          onSubmitEditing={create}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          accessibilityLabel={naming ? 'New category name' : 'Search categories'}
          style={styles.searchInput}
        />
        {options.create ? (
          <Pressable
            onPress={create}
            accessibilityRole="button"
            accessibilityLabel={`Add category ${options.create}`}
            style={[styles.addButton, { backgroundColor: theme.primary }]}
          >
            <AppText variant="label" color={theme.onPrimary} style={styles.bold}>
              Add
            </AppText>
          </Pressable>
        ) : query ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear" hitSlop={8}>
            <Icon name="close" color={theme.muted} size={18} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {options.tooLong ? (
          <AppText variant="caption" color={theme.negative}>
            Keep it under {MAX_CATEGORY_LABEL_LENGTH} characters.
          </AppText>
        ) : null}
        {naming ? (
          <AppText variant="caption" color={theme.muted}>
            Shared with the group, and offered next time anyone adds an expense.
          </AppText>
        ) : null}

        {showGrid ? (
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
                  <View style={[styles.tileRing, { borderColor: selected ? theme.primary : 'transparent' }]}>
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
            {query === '' ? (
              <Pressable
                onPress={startNaming}
                accessibilityRole="button"
                accessibilityLabel="Add a custom category"
                style={styles.cell}
              >
                <View style={[styles.tileRing, { borderColor: 'transparent' }]}>
                  <View style={[styles.customTile, { borderColor: theme.primary, backgroundColor: theme.primarySoft }]}>
                    <Icon name="add" color={theme.onPrimarySoft} size={24} />
                  </View>
                </View>
                <AppText variant="caption" color={theme.onPrimarySoft} style={[styles.cellLabel, styles.bold]}>
                  Custom
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {options.customs.length > 0 ? (
          <>
            <AppText variant="label" color={theme.muted} style={styles.sectionTitle}>
              {naming ? 'Or pick one used before' : 'Used in this group'}
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
            No match. Tap Add to create “{query.trim()}”.
          </AppText>
        ) : null}

        {naming ? (
          <Pressable onPress={reset} accessibilityRole="button" hitSlop={8} style={styles.back}>
            <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
              Back to all categories
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingLeft: 12,
    paddingRight: 6,
    minHeight: 48,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 10 },
  addButton: { borderRadius: 10, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  scroll: { maxHeight: 440 },
  content: { gap: 12, paddingBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  cell: { width: '25%', alignItems: 'center', gap: 4 },
  tileRing: { borderWidth: 2, borderRadius: 20, padding: 2 },
  customTile: {
    width: 48,
    height: 48,
    borderRadius: 15,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellLabel: { textAlign: 'center', paddingHorizontal: 2 },
  sectionTitle: { fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    minHeight: 38,
    maxWidth: '100%',
  },
  empty: { textAlign: 'center', paddingVertical: 8 },
  back: { alignSelf: 'center', paddingVertical: 6 },
  bold: { fontWeight: '600' },
});
