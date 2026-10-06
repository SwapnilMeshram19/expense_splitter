/**
 * The only file that touches native OCR / image code (swap the library here if needed).
 * Everything runs on the device: images are never uploaded.
 */
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { OcrLine } from './parseReceipt';

/** Enough for receipt text; full-size camera photos are slow to read and can exhaust memory on low-end phones. */
const MAX_OCR_WIDTH = 1600;

/** Downscale wide photos before OCR. Returns the original uri when no resize is needed. */
export async function prepareForOcr(uri: string, width: number): Promise<string> {
  if (!(width > MAX_OCR_WIDTH)) return uri;
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_OCR_WIDTH });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
  return saved.uri;
}

const toNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** ML Kit lines with positions. The frame shape is normalized defensively across library versions. */
export async function readTextLines(uri: string): Promise<OcrLine[]> {
  const result = await TextRecognition.recognize(uri);
  const lines: OcrLine[] = [];
  for (const block of result.blocks) {
    for (const line of block.lines) {
      const raw: unknown = line.frame;
      const frame = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const left = toNumber(frame.left) ?? toNumber(frame.x);
      const top = toNumber(frame.top) ?? toNumber(frame.y);
      const width = toNumber(frame.width);
      const height = toNumber(frame.height);
      if (left === null || top === null || width === null || height === null) continue;
      lines.push({ text: line.text, left, top, width, height });
    }
  }
  // No positions at all: fall back to plain text, one row per line.
  if (lines.length === 0 && result.text) {
    return result.text.split('\n').map((text, i) => ({ text, left: 0, top: i * 10, width: 1, height: 8 }));
  }
  return lines;
}

/** Delete a temp image. Only touches files inside our own cache (never the user's gallery originals). */
export function deleteTempImage(uri: string): void {
  if (!uri.startsWith(Paths.cache.uri)) return;
  try {
    new File(uri).delete();
  } catch {
    // Already gone, or the OS cleaned the cache: nothing to do.
  }
}