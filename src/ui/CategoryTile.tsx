import { StyleSheet, View } from 'react-native';

import type { ExpenseCategory } from '@/db/schema';

import { AVATAR_SWATCHES } from './avatarColors';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';

/** Icon and swatch per category. Swatch indexes point into AVATAR_SWATCHES (all ≥ 4.5:1). */
export const CATEGORY_STYLE: Record<ExpenseCategory, { icon: IconName; swatch: number; label: string }> = {
  general: { icon: 'catGeneral', swatch: 4, label: 'General' },
  food: { icon: 'catFood', swatch: 6, label: 'Food & drinks' },
  groceries: { icon: 'catGroceries', swatch: 7, label: 'Groceries' },
  travel: { icon: 'catTravel', swatch: 3, label: 'Travel' },
  transport: { icon: 'catTransport', swatch: 0, label: 'Transport' },
  stay: { icon: 'catStay', swatch: 5, label: 'Stay' },
  shopping: { icon: 'catShopping', swatch: 1, label: 'Shopping' },
  utilities: { icon: 'catUtilities', swatch: 2, label: 'Utilities' },
  entertainment: { icon: 'catEntertainment', swatch: 6, label: 'Entertainment' },
  other: { icon: 'catOther', swatch: 4, label: 'Other' },
};

/** Unknown categories (newer app version via sync) render as 'other'. */
export function categoryStyle(category: string) {
  return CATEGORY_STYLE[category as ExpenseCategory] ?? CATEGORY_STYLE.other;
}

export function CategoryTile({ category, size = 42 }: { category: string; size?: number }) {
  const theme = useTheme();
  const style = categoryStyle(category);
  const { bg, fg } = AVATAR_SWATCHES[theme.scheme][style.swatch]!;
  return (
    <View
      style={[styles.tile, { width: size, height: size, borderRadius: size * 0.31, backgroundColor: bg }]}
      accessible={false}
    >
      <Icon name={style.icon} color={fg} size={size * 0.48} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
