import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { useTheme } from './theme';

export const APP_NAME = 'Expense Splitter';

// Same artwork as the launcher icon (rendered from one source), on its rounded ocean tile.
const LOGO = require('../../assets/images/logo-mark.png');

/** Logo tile + app name for the Home header. */
export function BrandMark() {
  const theme = useTheme();
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={APP_NAME}>
      <Image source={LOGO} style={styles.logo} contentFit="contain" accessible={false} />
      <AppText style={styles.word} color={theme.text} numberOfLines={1}>
        {APP_NAME}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 10 },
  word: { flexShrink: 1, fontSize: 21, fontWeight: '700', letterSpacing: -0.3, lineHeight: 28 },
});
