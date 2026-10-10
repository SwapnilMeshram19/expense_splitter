import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appContext } from '@/db/appContext';
import { getReceiptFile } from '@/db/repositories/receipts';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

import { captureReceipt, describeCaptureError } from './capture';
import { localReceiptUri, type StagedReceipt } from './receiptFiles';
import { describeReceiptLoadError, loadReceipt } from './receiptStorage';
import { formatBytes } from './sizing';

interface ReceiptFieldProps {
  groupId: string;
  /** Null while adding a new expense (nothing on the server yet). */
  expenseId: string | null;
  /** The saved receipt, if any. */
  receiptId: string | null;
  /** A photo picked in this form, not saved yet. */
  staged: StagedReceipt | null;
  onStaged: (staged: StagedReceipt) => void;
  onRemove: () => void;
  disabled?: boolean;
}

/** One receipt photo per expense: add, view, replace or remove. */
export function ReceiptField({
  groupId,
  expenseId,
  receiptId,
  staged,
  onStaged,
  onRemove,
  disabled = false,
}: ReceiptFieldProps) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);

  const pick = async (source: 'camera' | 'library') => {
    setBusy(true);
    const result = await captureReceipt(source);
    setBusy(false);
    if (result.ok) onStaged(result.staged);
    else {
      const message = describeCaptureError(result.reason);
      if (message) Alert.alert('Receipt photo', message);
    }
  };

  const choose = () =>
    Alert.alert('Receipt photo', undefined, [
      { text: 'Take photo', onPress: () => void pick('camera') },
      { text: 'Choose from gallery', onPress: () => void pick('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const hasPhoto = staged !== null || receiptId !== null;

  if (!hasPhoto) {
    return (
      <View style={styles.actions}>
        <Button
          label="Take photo"
          icon="camera"
          variant="soft"
          onPress={() => void pick('camera')}
          busy={busy}
          disabled={disabled || busy}
          style={styles.grow}
        />
        <Button
          label="Gallery"
          icon="photoLibrary"
          variant="secondary"
          onPress={() => void pick('library')}
          disabled={disabled || busy}
          style={styles.grow}
        />
      </View>
    );
  }

  // Status line under the thumbnail.
  const pending = receiptId && !staged ? getReceiptFile(appContext.db, receiptId)?.state === 'upload' : false;
  const status = staged
    ? `New photo · ${formatBytes(staged.bytes)} · shared with the group after you save`
    : pending
      ? 'Saved on this phone · uploads when you’re online'
      : 'Shared with the group';

  const thumbUri = staged?.uri ?? (receiptId ? localReceiptUri(receiptId) : null);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => setViewing(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel="View receipt photo"
        style={[styles.thumb, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
      >
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Icon name="download" color={theme.muted} size={24} />
        )}
      </Pressable>
      <View style={styles.grow}>
        <AppText variant="label" style={styles.bold}>
          Receipt
        </AppText>
        <AppText variant="caption" color={theme.muted}>
          {thumbUri ? status : 'Tap to load the photo'}
        </AppText>
        {!disabled ? (
          <View style={styles.links}>
            <Pressable onPress={choose} hitSlop={8} accessibilityRole="button" disabled={busy}>
              <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
                {busy ? 'Opening…' : 'Replace'}
              </AppText>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert('Remove the receipt photo?', 'It’s removed for everyone in the group when you save.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: onRemove },
                ])
              }
              hitSlop={8}
              accessibilityRole="button"
            >
              <AppText variant="label" color={theme.negative} style={styles.bold}>
                Remove
              </AppText>
            </Pressable>
          </View>
        ) : null}
      </View>
      {viewing ? (
        <ReceiptViewer
          localUri={thumbUri}
          groupId={groupId}
          expenseId={expenseId}
          receiptId={staged ? null : receiptId}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </View>
  );
}

/** Full-screen photo. Downloads only now (on tap) when the phone has no copy. */
function ReceiptViewer({
  localUri,
  groupId,
  expenseId,
  receiptId,
  onClose,
}: {
  localUri: string | null;
  groupId: string;
  /** With receiptId: where to download from when there's no local copy. */
  expenseId: string | null;
  receiptId: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const canDownload = !localUri && expenseId !== null && receiptId !== null;
  const [uri, setUri] = useState<string | null>(localUri);
  const [message, setMessage] = useState<string | null>(
    !localUri && !canDownload ? 'This photo isn’t on this phone.' : null,
  );

  useEffect(() => {
    if (localUri || !expenseId || !receiptId) return;
    let cancelled = false;
    void loadReceipt({ groupId, expenseId, receiptId }).then((result) => {
      if (cancelled) return;
      if (result.ok) setUri(result.uri);
      else setMessage(describeReceiptLoadError(result.reason));
    });
    return () => {
      cancelled = true;
    };
  }, [localUri, groupId, expenseId, receiptId]);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.viewer}>
        {uri ? (
          <Image source={{ uri }} style={styles.full} contentFit="contain" accessibilityLabel="Receipt photo" />
        ) : message ? (
          <AppText color="#FFFFFF" style={styles.viewerMessage}>
            {message}
          </AppText>
        ) : (
          <ActivityIndicator color="#FFFFFF" />
        )}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[styles.close, { top: insets.top + 8 }]}
        >
          <Icon name="close" color="#FFFFFF" size={26} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  links: { flexDirection: 'row', gap: 20, marginTop: 4 },
  viewer: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  viewerMessage: { textAlign: 'center', paddingHorizontal: 32 },
  close: {
    position: 'absolute',
    right: 12,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
