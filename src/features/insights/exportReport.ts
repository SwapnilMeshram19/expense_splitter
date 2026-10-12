import { Directory, File, Paths } from 'expo-file-system';
import { printToFileAsync } from 'expo-print';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

import { monthLabel, type Period } from './compute';
import { ExportUnavailableError } from './exportSupport';
import { exportFileName, type ExportFormat } from './fileNames';
import { buildExpensesCsv } from './csv';
import type { InsightsSource } from './loadInsights';
import { buildReportHtml } from './reportHtml';

/**
 * CSV and PDF exports, made on the phone and handed to the share sheet (WhatsApp, Drive, Gmail…).
 * Nothing goes to a server, so exports cost nothing and work offline.
 *
 * Privacy: the files hold names, notes and amounts. They're written to the app's cache under
 * exports/ (never public storage), and the folder is emptied before each new export, so at most
 * one old export sits on the phone until the next one (or until Android clears the cache).
 */

export type { ExportFormat } from './fileNames';

export { ExportUnavailableError } from './exportSupport';

const exportsDir = () => new Directory(Paths.cache, 'exports');

function freshExportsDir(): Directory {
  const dir = exportsDir();
  try {
    if (dir.exists) dir.delete();
  } catch {
    // A stale file we can't delete is only wasted cache space; the new one gets its own name.
  }
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export async function exportGroup(
  source: InsightsSource,
  options: { format: ExportFormat; period: Period; today: string },
): Promise<void> {
  const { format, period, today } = options;
  if (!(await isAvailableAsync())) throw new ExportUnavailableError();

  const { group } = source;
  const dir = freshExportsDir();
  const target = new File(dir, exportFileName(group.name, period, format));
  const title = `${group.name} · ${period ? monthLabel(period, 'long') : 'All time'}`;

  if (format === 'csv') {
    target.create({ overwrite: true });
    target.write(
      buildExpensesCsv({
        currency: group.currency,
        members: source.members,
        expenses: source.expenses,
        settlements: source.settlements,
        period,
      }),
    );
    await shareAsync(target.uri, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: title,
    });
    return;
  }

  const html = buildReportHtml({
    groupName: group.name,
    currency: group.currency,
    members: source.members,
    expenses: source.expenses,
    period,
    today,
    balances: period === null ? source.balances : null,
    budget: source.budget,
  });
  // A4 in points; the page margins come from the HTML's @page rule.
  const { uri } = await printToFileAsync({ html, width: 595, height: 842 });
  // expo-print names the file randomly; give it a readable name for the share sheet.
  new File(uri).moveSync(target, { overwrite: true });
  await shareAsync(target.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: title,
  });
}
