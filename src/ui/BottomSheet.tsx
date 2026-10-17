import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';
import { useTheme } from './theme';

/**
 * `raised`: pin the sheet under the status bar instead of the bottom edge, for while a text field
 * in it has focus. A Modal is its own Android window, where keyboard events and resizing are not
 * reliable, so instead of measuring the keyboard the sheet simply moves to where it can't be
 * covered.
 *
 * Bottom sheet on React Native's Modal: no extra native dependency, and the slide animation runs
 * natively, so it stays smooth on low-end phones. Tap outside or press Back to close.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  raised = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  raised?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.root, raised && styles.rootRaised]}>
        <Pressable
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, borderColor: theme.border, paddingBottom: insets.bottom + 16 },
            raised && [styles.sheetRaised, { marginTop: insets.top + 8 }],
          ]}
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          {title ? (
            <AppText variant="heading" accessibilityRole="header" style={styles.title}>
              {title}
            </AppText>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  rootRaised: { justifyContent: 'flex-start' },
  sheetRaised: { marginHorizontal: 8, borderRadius: 24, paddingBottom: 16 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 14,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  title: { marginTop: 4 },
});
