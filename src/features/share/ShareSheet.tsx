import { useCallback, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/AppText';
import { BottomSheet } from '@/ui/BottomSheet';
import { Icon, type IconName } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

import { copyText } from './copyText';
import { shareTextElsewhere, shareTextOnWhatsApp, useWhatsAppAvailable } from './shareText';
import { clampShareText } from './whatsapp';

/** Extra row under the share targets ("Invite people", "Export PDF"…). */
export interface ShareSheetAction {
  icon: IconName;
  label: string;
  onPress: () => void;
}

export interface ShareRequest {
  /** Sheet title, e.g. "Share balances". */
  title: string;
  /** Built when the sheet opens, so the preview is exactly what gets sent. */
  getText: () => string;
  actions?: readonly ShareSheetAction[];
}

/**
 * One share UI for the whole app: a preview of the message, then WhatsApp / Other apps / Copy.
 *
 *   const share = useShareSheet();
 *   <Button onPress={() => share.open({ title: 'Share balances', getText })} />
 *   {share.element}
 */
export function useShareSheet(): { open: (request: ShareRequest) => void; element: ReactNode } {
  const [state, setState] = useState<{ request: ShareRequest; text: string } | null>(null);
  const open = useCallback((request: ShareRequest) => setState({ request, text: request.getText() }), []);
  const close = useCallback(() => setState(null), []);
  const element = (
    <ShareSheetView
      visible={state !== null}
      title={state?.request.title ?? ''}
      text={state?.text ?? ''}
      actions={state?.request.actions ?? []}
      onClose={close}
    />
  );
  return { open, element };
}

function ShareSheetView({
  visible,
  title,
  text,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  text: string;
  actions: readonly ShareSheetAction[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const whatsapp = useWhatsAppAvailable();

  // Close first: the share sheet / WhatsApp opening over a still-visible modal looks broken, and
  // iOS refuses to present the system sheet until the modal has finished sliding away.
  const then = (fn: () => void) => () => {
    onClose();
    setTimeout(fn, Platform.OS === 'ios' ? 350 : 0);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={[styles.preview, { backgroundColor: theme.surfaceAlt }]}>
        <AppText variant="label" color={theme.muted} numberOfLines={6}>
          {text.replace(/\*/g, '')}
        </AppText>
      </View>

      <View style={styles.targets}>
        {whatsapp ? (
          <Target
            icon="chat"
            label="WhatsApp"
            bg={theme.whatsappSoft}
            fg={theme.onWhatsappSoft}
            onPress={then(() => void shareTextOnWhatsApp(text))}
          />
        ) : null}
        <Target
          icon="share"
          label="Other apps"
          bg={theme.primarySoft}
          fg={theme.onPrimarySoft}
          onPress={then(() => void shareTextElsewhere(text, title))}
        />
        <Target
          icon="copy"
          label="Copy"
          bg={theme.surfaceAlt}
          fg={theme.text}
          onPress={then(() => void copyText(clampShareText(text)))}
        />
      </View>

      {actions.length > 0 ? (
        <View style={[styles.actions, { borderTopColor: theme.border }]}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={then(a.onPress)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.actionRow, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Icon name={a.icon} color={theme.text} size={20} />
              <AppText style={styles.grow}>{a.label}</AppText>
              <Icon name="chevronRight" color={theme.muted} size={18} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </BottomSheet>
  );
}

function Target({
  icon,
  label,
  bg,
  fg,
  onPress,
}: {
  icon: IconName;
  label: string;
  bg: string;
  fg: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === 'Copy' ? 'Copy text' : `Share on ${label}`}
      style={({ pressed }) => [styles.target, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.targetIcon, { backgroundColor: bg }]}>
        <Icon name={icon} color={fg} size={24} />
      </View>
      <AppText variant="label" color={theme.text} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  preview: { borderRadius: 14, padding: 12 },
  targets: { flexDirection: 'row', justifyContent: 'space-around' },
  target: { alignItems: 'center', gap: 6, minWidth: 80, paddingVertical: 4 },
  targetIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  grow: { flex: 1, minWidth: 0 },
});
