/**
 * Receipt photo budget. Receipts are tall and narrow with small print: 1600 px on the long edge keeps
 * them readable while a JPEG at quality 0.6 lands around 150–300 KB. That keeps the free tier's
 * 1 GB of storage good for thousands of receipts and makes each download cheap on slow networks.
 */
export const RECEIPT_MAX_EDGE = 1600;
export const RECEIPT_QUALITY = 0.6;
/** Second pass for very busy photos that come out too big. */
export const RECEIPT_FALLBACK_EDGE = 1200;
export const RECEIPT_FALLBACK_QUALITY = 0.45;
/** Try the second pass above this; the bucket refuses files over 1 MB. */
export const RECEIPT_TARGET_BYTES = 900_000;
export const RECEIPT_MAX_BYTES = 1_048_576;

/** Resize to fit `maxEdge` on the long side (never enlarges). Null: already small enough. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (Math.max(width, height) <= maxEdge) return null;
  return width >= height
    ? { width: maxEdge }
    : { height: maxEdge };
}

/** "214 KB" / "1.2 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
