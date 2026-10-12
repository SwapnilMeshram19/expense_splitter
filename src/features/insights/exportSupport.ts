import { requireOptionalNativeModule } from 'expo';

/**
 * CSV/PDF export needs two native modules (expo-print, expo-sharing). JavaScript can be newer than
 * the installed app (a dev client built before they were added, later an old Play build running a
 * newer bundle), so the Spending screen must not import them at load time: that throws and takes
 * the whole screen down. It checks here first and loads the export code only on tap.
 */
export const exportModulesInstalled = (): boolean =>
  requireOptionalNativeModule('ExpoPrint') !== null &&
  requireOptionalNativeModule('ExpoSharing') !== null;

export class ExportUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device');
  }
}
