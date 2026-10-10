import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

/**
 * App icon set: one name per meaning, mapped to SF Symbols on iOS and Material Symbols on Android
 * (expo-symbols renders the Android ones from the Material Symbols font, loaded on first use).
 * Screens use these names only, so swapping the icon source later touches this file alone.
 */
const ICONS = {
  home: { ios: 'house', android: 'home' },
  activity: { ios: 'clock', android: 'schedule' },
  add: { ios: 'plus', android: 'add' },
  settle: { ios: 'arrow.left.arrow.right', android: 'swap_horiz' },
  account: { ios: 'person', android: 'person' },
  cloudDone: { ios: 'checkmark.icloud', android: 'cloud_done' },
  cloudOff: { ios: 'icloud.slash', android: 'cloud_off' },
  cloudSync: { ios: 'arrow.triangle.2.circlepath.icloud', android: 'cloud_sync' },
  syncProblem: { ios: 'exclamationmark.icloud', android: 'sync_problem' },
  more: { ios: 'ellipsis', android: 'more_vert' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right' },
  chevronDown: { ios: 'chevron.down', android: 'expand_more' },
  groupAdd: { ios: 'person.badge.plus', android: 'group_add' },
  groups: { ios: 'person.3', android: 'groups' },
  settings: { ios: 'gearshape', android: 'settings' },
  receipt: { ios: 'doc.text', android: 'receipt_long' },
  arrowForward: { ios: 'arrow.right', android: 'arrow_forward' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  login: { ios: 'person.crop.circle.badge.plus', android: 'login' },
  shield: { ios: 'shield', android: 'shield' },
  help: { ios: 'questionmark.circle', android: 'help' },
  card: { ios: 'creditcard', android: 'credit_card' },
  info: { ios: 'info.circle', android: 'info' },
  pending: { ios: 'clock.badge.exclamationmark', android: 'pending' },
  check: { ios: 'checkmark', android: 'check' },
  close: { ios: 'xmark', android: 'close' },
  paid: { ios: 'arrow.up.right', android: 'north_east' },
  received: { ios: 'arrow.down.left', android: 'south_west' },
  back: { ios: 'chevron.left', android: 'arrow_back' },
  personAdd: { ios: 'person.badge.plus', android: 'person_add' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  edit: { ios: 'pencil', android: 'edit' },
  delete: { ios: 'trash', android: 'delete' },
  qr: { ios: 'qrcode', android: 'qr_code' },
  share: { ios: 'square.and.arrow.up', android: 'share' },
  copy: { ios: 'doc.on.doc', android: 'content_copy' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning' },
  lock: { ios: 'lock', android: 'lock' },
  calendar: { ios: 'calendar', android: 'calendar_today' },
  rupee: { ios: 'indianrupeesign', android: 'currency_rupee' },
  // Expense categories
  catGeneral: { ios: 'doc.text', android: 'receipt_long' },
  catFood: { ios: 'fork.knife', android: 'restaurant' },
  catGroceries: { ios: 'cart', android: 'shopping_cart' },
  catTravel: { ios: 'airplane', android: 'flight' },
  catTransport: { ios: 'car', android: 'directions_car' },
  catStay: { ios: 'bed.double', android: 'hotel' },
  catShopping: { ios: 'bag', android: 'shopping_bag' },
  catUtilities: { ios: 'bolt', android: 'bolt' },
  catEntertainment: { ios: 'film', android: 'movie' },
  catOther: { ios: 'square.grid.2x2', android: 'category' },
} as const satisfies Record<string, Extract<SymbolViewProps['name'], object>>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  color: ColorValue;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** Decorative by default: give the surrounding button an accessibilityLabel instead. */
export function Icon({ name, color, size = 22, style }: IconProps) {
  return (
    <SymbolView
      name={ICONS[name]}
      tintColor={color}
      size={size}
      style={style}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}
