import { useFonts } from 'expo-font';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Platform, StyleSheet, Text, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { MaterialSymbols_400Regular } from '@expo-google-fonts/material-symbols/400Regular';

/**
 * App icon set: one name per meaning. iOS draws SF Symbols (expo-symbols); Android draws
 * Material Symbols from the font, by codepoint.
 *
 * Android is drawn here rather than through expo-symbols because its Text keeps Android's
 * default font padding, which sat the glyph a few pixels low next to labels. Here the glyph box
 * is exactly `size` × `size` and centred. Codepoints come from the font's map (comment = name).
 */
const ICONS = {
  home: { ios: 'house', android: 0xe88a }, // home
  activity: { ios: 'clock', android: 0xe8b5 }, // schedule
  add: { ios: 'plus', android: 0xe145 }, // add
  settle: { ios: 'arrow.left.arrow.right', android: 0xe8d4 }, // swap_horiz
  account: { ios: 'person', android: 0xe7fd }, // person
  cloudDone: { ios: 'checkmark.icloud', android: 0xe2bf }, // cloud_done
  cloudOff: { ios: 'icloud.slash', android: 0xe2c1 }, // cloud_off
  cloudSync: { ios: 'arrow.triangle.2.circlepath.icloud', android: 0xeb5a }, // cloud_sync
  syncProblem: { ios: 'exclamationmark.icloud', android: 0xe629 }, // sync_problem
  more: { ios: 'ellipsis', android: 0xe5d4 }, // more_vert
  chevronRight: { ios: 'chevron.right', android: 0xe5cc }, // chevron_right
  chevronDown: { ios: 'chevron.down', android: 0xe5cf }, // expand_more
  groupAdd: { ios: 'person.badge.plus', android: 0xe7f0 }, // group_add
  groups: { ios: 'person.3', android: 0xf233 }, // groups
  settings: { ios: 'gearshape', android: 0xe8b8 }, // settings
  receipt: { ios: 'doc.text', android: 0xef6e }, // receipt_long
  arrowForward: { ios: 'arrow.right', android: 0xe5c8 }, // arrow_forward
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 0xe9ba }, // logout
  login: { ios: 'person.crop.circle.badge.plus', android: 0xea77 }, // login
  shield: { ios: 'shield', android: 0xe9e0 }, // shield
  help: { ios: 'questionmark.circle', android: 0xe887 }, // help
  card: { ios: 'creditcard', android: 0xe870 }, // credit_card
  info: { ios: 'info.circle', android: 0xe88e }, // info
  pending: { ios: 'clock.badge.exclamationmark', android: 0xef64 }, // pending
  check: { ios: 'checkmark', android: 0xe5ca }, // check
  close: { ios: 'xmark', android: 0xe5cd }, // close
  paid: { ios: 'arrow.up.right', android: 0xf1e1 }, // north_east
  received: { ios: 'arrow.down.left', android: 0xf1e5 }, // south_west
  back: { ios: 'chevron.left', android: 0xe5c4 }, // arrow_back
  personAdd: { ios: 'person.badge.plus', android: 0xe7fe }, // person_add
  history: { ios: 'clock.arrow.circlepath', android: 0xe889 }, // history
  edit: { ios: 'pencil', android: 0xe3c9 }, // edit
  delete: { ios: 'trash', android: 0xe872 }, // delete
  qr: { ios: 'qrcode', android: 0xef6b }, // qr_code
  share: { ios: 'square.and.arrow.up', android: 0xe80d }, // share
  copy: { ios: 'doc.on.doc', android: 0xe14d }, // content_copy
  warning: { ios: 'exclamationmark.triangle', android: 0xe002 }, // warning
  lock: { ios: 'lock', android: 0xe897 }, // lock
  calendar: { ios: 'calendar', android: 0xe935 }, // calendar_today
  rupee: { ios: 'indianrupeesign', android: 0xeaf7 }, // currency_rupee
  currency: { ios: 'dollarsign.arrow.circlepath', android: 0xeb70 }, // currency_exchange
  camera: { ios: 'camera', android: 0xe3b0 }, // photo_camera
  photo: { ios: 'photo', android: 0xe251 }, // image
  photoLibrary: { ios: 'photo.on.rectangle', android: 0xe413 }, // photo_library
  note: { ios: 'note.text', android: 0xe26c }, // notes
  cloudUpload: { ios: 'icloud.and.arrow.up', android: 0xe2c3 }, // cloud_upload
  download: { ios: 'arrow.down.circle', android: 0xe171 }, // download
  // Expense categories
  catGeneral: { ios: 'doc.text', android: 0xef6e }, // receipt_long
  catFood: { ios: 'fork.knife', android: 0xe56c }, // restaurant
  catGroceries: { ios: 'cart', android: 0xe8cc }, // shopping_cart
  catTravel: { ios: 'airplane', android: 0xe539 }, // flight
  catTransport: { ios: 'car', android: 0xe531 }, // directions_car
  catStay: { ios: 'bed.double', android: 0xe53a }, // hotel
  catShopping: { ios: 'bag', android: 0xf1cc }, // shopping_bag
  catUtilities: { ios: 'bolt', android: 0xea0b }, // bolt
  catEntertainment: { ios: 'film', android: 0xe02c }, // movie
  catOther: { ios: 'square.grid.2x2', android: 0xe574 }, // category
} as const satisfies Record<string, { ios: SFSymbol; android: number }>;

export type IconName = keyof typeof ICONS;

const ANDROID_FONT = 'MaterialSymbols_400Regular';

interface IconProps {
  name: IconName;
  color: ColorValue;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** Decorative by default: give the surrounding button an accessibilityLabel instead. */
export function Icon({ name, color, size = 22, style }: IconProps) {
  if (Platform.OS === 'android') return <AndroidIcon name={name} color={color} size={size} style={style} />;
  return (
    <SymbolView
      name={ICONS[name].ios}
      tintColor={color}
      size={size}
      style={style}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}

function AndroidIcon({ name, color, size, style }: Required<Omit<IconProps, 'style'>> & { style?: StyleProp<ViewStyle> }) {
  // Loaded once (expo-font caches it); until then an empty box keeps the layout steady.
  const [loaded] = useFonts({ [ANDROID_FONT]: MaterialSymbols_400Regular });
  return (
    <View style={[{ width: size, height: size }, styles.box, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      {loaded ? (
        <Text
          allowFontScaling={false}
          style={[
            styles.glyph,
            { color, fontSize: size, lineHeight: size, width: size, height: size, fontFamily: ANDROID_FONT },
          ]}
        >
          {String.fromCharCode(ICONS[name].android)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  glyph: { includeFontPadding: false, textAlign: 'center', textAlignVertical: 'center' },
});
