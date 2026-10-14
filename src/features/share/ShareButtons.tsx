import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/ui/Button';

import { shareTextElsewhere, shareTextOnWhatsApp, useWhatsAppAvailable } from './shareText';

/**
 * Inline share: "WhatsApp" (brand-green) + "More" (system share sheet), equal widths so the pair
 * lines up with every other two-button row. Without WhatsApp: one full-width "Share" button.
 * The text is built on tap, so it's always current and costs nothing until used.
 */
export function ShareButtons({
  getText,
  label = 'WhatsApp',
  accessibilityLabel = 'Share on WhatsApp',
  style,
}: {
  getText: () => string;
  label?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const whatsapp = useWhatsAppAvailable();

  if (!whatsapp) {
    return (
      <View style={[styles.row, style]}>
        <Button
          label="Share"
          icon="share"
          variant="soft"
          onPress={() => void shareTextElsewhere(getText())}
          style={styles.grow}
        />
      </View>
    );
  }

  return (
    <View style={[styles.row, style]}>
      <Button
        label={label}
        icon="chat"
        variant="whatsapp"
        onPress={() => void shareTextOnWhatsApp(getText())}
        accessibilityLabel={accessibilityLabel}
        style={styles.grow}
      />
      <Button
        label="More"
        icon="share"
        variant="secondary"
        onPress={() => void shareTextElsewhere(getText())}
        accessibilityLabel="Share with another app"
        style={styles.grow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
});
