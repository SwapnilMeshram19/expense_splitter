import { useMemo } from 'react';

import { QR_QUIET_ZONE, qrMatrix, rowRuns } from '@/lib/qrMatrix';

/** QR code as one SVG path (crisp at any size, no canvas). Dark on white for scanners in any theme. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, d } = useMemo(() => {
    const matrix = qrMatrix(text);
    const n = matrix.length + QR_QUIET_ZONE * 2;
    const parts: string[] = [];
    matrix.forEach((row, r) => {
      for (const run of rowRuns(row)) {
        parts.push(
          `M${run.start + QR_QUIET_ZONE} ${r + QR_QUIET_ZONE}h${run.length}v1h-${run.length}z`,
        );
      }
    });
    return { size: n, d: parts.join('') };
  }, [text]);
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
