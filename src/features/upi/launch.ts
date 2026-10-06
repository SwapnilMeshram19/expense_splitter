import { Linking, Platform } from 'react-native';

export type UpiLaunchResult = 'opened' | 'no_app';

/**
 * Whether any app handles upi:// links. A hint only, never a gate: without the <queries> entry
 * (plugins/with-upi-queries.js) Android 11+ reports false even when apps are installed.
 * iOS is out of scope for now.
 */
export async function hasUpiApp(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await Linking.canOpenURL('upi://pay');
  } catch {
    return false;
  }
}

/**
 * Hands the link to Android (its own picker appears when there's no default UPI app).
 * Resolves once the other app starts. It says nothing about whether money moved.
 */
export async function openUpiApp(uri: string): Promise<UpiLaunchResult> {
  try {
    await Linking.openURL(uri);
    return 'opened';
  } catch {
    return 'no_app';
  }
}