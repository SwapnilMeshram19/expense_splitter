import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';

interface BannerProps {
  tone: 'warning' | 'info';
  icon?: IconName;
  title: string;
  body?: string;
  /** Buttons or links under the text. */
  children?: ReactNode;
}

/** Inline notice (lost access, unconfirmed UPI payment, read-only explanations). */
export function Banner({ tone, icon, title, body, children }: BannerProps) {
  const theme = useTheme();
  const bg = tone === 'warning' ? theme.warningSoft : theme.primarySoft;
  const fg = tone === 'warning' ? theme.warning : theme.onPrimarySoft;

  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="summary">
      <View style={styles.row}>
        <Icon name={icon ?? (tone === 'warning' ? 'warning' : 'info')} color={fg} size={20} style={styles.icon} />
        <View style={styles.text}>
          <AppText variant="label" color={fg} style={styles.title}>
            {title}
          </AppText>
          {body ? (
            <AppText variant="caption" color={fg}>
              {body}
            </AppText>
          ) : null}
        </View>
      </View>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 16, padding: 14, gap: 10 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  icon: { marginTop: 1 },
  text: { flex: 1, gap: 2 },
  title: { fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
