import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, type ButtonVariant } from '@/ui/Button';

import { shareTextElsewhere, shareTextOnWhatsApp, useWhatsAppAvailable } from './shareText';

/**
 * "WhatsApp" + "More" (share sheet). Without WhatsApp: one "Share" button.
 * The text is built on tap, so it's always current and costs nothing until used.
 */
export function ShareButtons({
  getText,
  label = 'WhatsApp',
  accessibilityLabel = 'Share on WhatsApp',
  variant = 'soft',
  style,
}: {
  getText: () => string;
  label?: string;
  accessibilityLabel?: string;
  variant?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const whatsapp = useWhatsAppAvailable();

  if (!whatsapp) {
    return (
      <View style={[styles.row, style]}>
        <Button
          label="Share"
          icon="share"
          variant={variant}
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
        variant={variant}
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
});
