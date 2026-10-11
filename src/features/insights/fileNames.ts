import type { Period } from './compute';

export type ExportFormat = 'csv' | 'pdf';

/** "Goa trip 2026!" → "goa-trip-2026". ASCII only: some share targets mangle other file names. */
export function fileSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'group';
}

export function exportFileName(groupName: string, period: Period, format: ExportFormat): string {
  const when = period ?? 'all-time';
  return `${fileSlug(groupName)}-${when}.${format}`;
}
