import { StyleSheet, View } from 'react-native';

import type { ExpenseCategory } from '@/db/schema';
import { CATEGORY_NAMES } from '@/features/expenses/categoryNames';

import { AVATAR_SWATCHES } from './avatarColors';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';

/** Icon and swatch per category. Swatch indexes point into AVATAR_SWATCHES (all ≥ 4.5:1). */
export const CATEGORY_STYLE: Record<ExpenseCategory, { icon: IconName; swatch: number; label: string }> = {
  general: { icon: 'catGeneral', swatch: 4, label: CATEGORY_NAMES.general },
  food: { icon: 'catFood', swatch: 6, label: CATEGORY_NAMES.food },
  groceries: { icon: 'catGroceries', swatch: 7, label: CATEGORY_NAMES.groceries },
  travel: { icon: 'catTravel', swatch: 3, label: CATEGORY_NAMES.travel },
  transport: { icon: 'catTransport', swatch: 0, label: CATEGORY_NAMES.transport },
  stay: { icon: 'catStay', swatch: 5, label: CATEGORY_NAMES.stay },
  shopping: { icon: 'catShopping', swatch: 1, label: CATEGORY_NAMES.shopping },
  utilities: { icon: 'catUtilities', swatch: 2, label: CATEGORY_NAMES.utilities },
  entertainment: { icon: 'catEntertainment', swatch: 6, label: CATEGORY_NAMES.entertainment },
  other: { icon: 'catOther', swatch: 4, label: CATEGORY_NAMES.other },
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
