import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Floating tab bar: a rounded pill above the bottom edge, content scrolls underneath it. */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_GAP = 12;

/** Distance from the screen bottom to the bar's bottom edge. */
export function useTabBarBottom(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, 8) + TAB_BAR_GAP / 2;
}

/** Bottom padding for a tab screen's scroll content, so the last row clears the bar. */
export function useTabBarSpace(): number {
  return useTabBarBottom() + TAB_BAR_HEIGHT + 24;
}
