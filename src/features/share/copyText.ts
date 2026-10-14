import * as Clipboard from 'expo-clipboard';
import { Platform, ToastAndroid } from 'react-native';

/** Copy to the clipboard and confirm. Android 13+ shows its own confirmation; older ones don't. */
export async function copyText(text: string, confirmation = 'Copied'): Promise<void> {
  await Clipboard.setStringAsync(text);
  if (Platform.OS === 'android' && Number(Platform.Version) < 33) {
    ToastAndroid.show(confirmation, ToastAndroid.SHORT);
  }
}
