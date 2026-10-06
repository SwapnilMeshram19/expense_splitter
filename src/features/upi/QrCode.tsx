import { useMemo } from 'react';
import { PixelRatio, View } from 'react-native';

import { QR_QUIET_ZONE, qrMatrix, rowRuns } from '@/lib/qrMatrix';

/** Always black on white (also in dark mode): scanners need the contrast. */
export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const rows = useMemo(() => qrMatrix(value).map((row) => rowRuns(row)), [value]);
  const modules = rows.length;
  const total = modules + QR_QUIET_ZONE * 2;

  // Whole physical pixels per module, so edges stay sharp at any screen density.
  const ratio = PixelRatio.get();
  const cell = Math.max(1, Math.floor((size * ratio) / total)) / ratio;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: cell * total, height: cell * total, padding: cell * QR_QUIET_ZONE, backgroundColor: '#fff' }}
    >
      {rows.map((runs, r) => (
        <View key={r} style={{ width: cell * modules, height: cell }}>
          {runs.map((run) => (
            <View
              key={run.start}
              style={{
                position: 'absolute',
                left: run.start * cell,
                width: run.length * cell,
                height: cell,
                backgroundColor: '#000',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}