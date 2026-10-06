import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { getGroup } from '@/db/repositories/groups';
import { findSelfMemberId } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { deleteTempImage, prepareForOcr, readTextLines } from '@/features/receipt/ocr';
import { EMPTY_RECEIPT, parseReceipt, type ParsedReceipt } from '@/features/receipt/parseReceipt';
import { draftFromParsed, getReceiptDraft, saveReceiptDraft } from '@/features/receipt/receiptDraft';
import { LinkButton, PrimaryButton } from '@/features/upi/buttons';
import { useTheme } from '@/ui/theme';

// Module-level: reading the clock here is fine for the compiler's purity rule.
function storeNewDraft(parsed: ParsedReceipt, groupId: string): void {
  saveReceiptDraft(appContext, draftFromParsed(parsed, groupId, () => appContext.newId(), Date.now()));
}

export default function ScanScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const [allowed] = useState(
    () => getGroup(db, groupId) !== null && findSelfMemberId(db, groupId, getDeviceUserId()) !== null,
  );
  const [hasDraft] = useState(() => getReceiptDraft(appContext)?.groupId === groupId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsSettings, setNeedsSettings] = useState(false);

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Scan a bill' }} />
        <Text style={{ color: theme.muted }}>You’re not a member of this group.</Text>
      </View>
    );
  }

  const openReceipt = () =>
    router.replace({ pathname: '/groups/[groupId]/expenses/receipt', params: { groupId } });

  const startDraft = (parsed: ParsedReceipt) => {
    storeNewDraft(parsed, groupId);
    openReceipt();
  };

  const read = async (asset: ImagePicker.ImagePickerAsset) => {
    setBusy(true);
    setMessage(null);
    let prepared: string | null = null;
    try {
      prepared = await prepareForOcr(asset.uri, asset.width);
      const parsed = parseReceipt(await readTextLines(prepared));
      if (parsed.items.length === 0) {
        setMessage('Couldn’t find any items on this bill. Retake it flat and in good light, or enter the items yourself.');
        return;
      }
      startDraft(parsed);
    } catch {
      setMessage('Couldn’t read this photo. Try again, or enter the items yourself.');
    } finally {
      deleteTempImage(asset.uri);
      if (prepared && prepared !== asset.uri) deleteTempImage(prepared);
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    setMessage(null);
    setNeedsSettings(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage('Camera access is needed to scan a bill.');
      setNeedsSettings(!permission.canAskAgain);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) await read(asset);
  };

  const choosePhoto = async () => {
    setMessage(null);
    // Android photo picker: no storage permission needed.
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.9 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) await read(asset);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Scan a bill' }} />
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={theme.primary} size="large" />
          <Text style={{ color: theme.text }}>Reading the bill…</Text>
        </View>
      ) : (
        <>
          <Text style={[styles.title, { color: theme.text }]}>Split a bill by item</Text>
          <Text style={{ color: theme.muted }}>
            Lay the bill flat in good light and fill the frame. When asked, crop to just the bill.
          </Text>
          <Text style={{ color: theme.muted }}>
            The photo is read on your phone and deleted right after. It’s never uploaded.
          </Text>
          {message ? <Text style={{ color: theme.negative }}>{message}</Text> : null}
          {needsSettings ? <LinkButton label="Open settings" onPress={() => void Linking.openSettings()} /> : null}
          <PrimaryButton label="Take a photo" onPress={() => void takePhoto()} />
          <LinkButton label="Choose from gallery" onPress={() => void choosePhoto()} />
          <LinkButton label="Enter items yourself" onPress={() => startDraft(EMPTY_RECEIPT)} />
          {hasDraft ? <LinkButton label="Continue the last scanned bill" onPress={openReceipt} /> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 20, fontWeight: '600' },
  busy: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});