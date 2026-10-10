import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { newId } from '@/lib/newId';

import type { StagedReceipt } from './receiptFiles';
import {
  fitWithin,
  RECEIPT_FALLBACK_EDGE,
  RECEIPT_FALLBACK_QUALITY,
  RECEIPT_MAX_BYTES,
  RECEIPT_MAX_EDGE,
  RECEIPT_QUALITY,
  RECEIPT_TARGET_BYTES,
} from './sizing';

export type CaptureResult =
  | { ok: true; staged: StagedReceipt }
  | { ok: false; reason: 'CANCELED' | 'CAMERA_DENIED' | 'TOO_LARGE' | 'FAILED' };

async function compress(uri: string, width: number, height: number, maxEdge: number, quality: number) {
  const context = ImageManipulator.manipulate(uri);
  const size = fitWithin(width, height, maxEdge);
  if (size) context.resize(size);
  const image = await context.renderAsync();
  // Re-encoding drops the EXIF block, so the phone's GPS location never leaves with a receipt.
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
  return { uri: result.uri, bytes: new File(result.uri).size };
}

/**
 * Take or choose a receipt photo and shrink it for upload (≈150–300 KB). The result is staged in
 * the cache; it becomes permanent only when the expense is saved (commitStagedReceipt).
 */
export async function captureReceipt(source: 'camera' | 'library'): Promise<CaptureResult> {
  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { ok: false, reason: 'CAMERA_DENIED' };
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      quality: 1, // compressed once, below
      exif: false,
      allowsEditing: false,
    };
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return { ok: false, reason: 'CANCELED' };

    let out = await compress(asset.uri, asset.width, asset.height, RECEIPT_MAX_EDGE, RECEIPT_QUALITY);
    if (out.bytes > RECEIPT_TARGET_BYTES) {
      const first = out.uri;
      out = await compress(asset.uri, asset.width, asset.height, RECEIPT_FALLBACK_EDGE, RECEIPT_FALLBACK_QUALITY);
      try {
        new File(first).delete();
      } catch {
        // cache file; the OS clears it eventually
      }
    }
    if (out.bytes > RECEIPT_MAX_BYTES) return { ok: false, reason: 'TOO_LARGE' };
    return { ok: true, staged: { receiptId: newId(), uri: out.uri, bytes: out.bytes } };
  } catch (e) {
    if (__DEV__) console.log('[receipt] capture failed', (e as Error | null)?.message);
    return { ok: false, reason: 'FAILED' };
  }
}

export function describeCaptureError(reason: Exclude<CaptureResult, { ok: true }>['reason']): string | null {
  switch (reason) {
    case 'CANCELED':
      return null;
    case 'CAMERA_DENIED':
      return 'Allow camera access in your phone’s settings to take a receipt photo, or choose one from the gallery.';
    case 'TOO_LARGE':
      return 'That photo is too large even after shrinking. Try a closer shot of just the receipt.';
    case 'FAILED':
      return 'Couldn’t read that photo. Try again.';
  }
}
