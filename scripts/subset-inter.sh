#!/usr/bin/env bash
# Rebuilds assets/fonts/Inter-*.ttf from @expo-google-fonts/inter (devDependency), keeping only the
# characters the app shows: Latin (incl. Extended-A for names), punctuation, currency (₹ etc.),
# arrows and math (≈, −). Indic scripts aren't in Inter; Android falls back to the system font
# for them glyph by glyph. Needs: pip install fonttools.
# Full Inter is ~340 KB per weight; subset ~70 KB. Run after upgrading the font package.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=node_modules/@expo-google-fonts/inter
UNICODES="U+0020-007E,U+00A0-00FF,U+0100-017F,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+25CF,U+FEFF,U+FFFD"
for spec in 400Regular 500Medium 600SemiBold 700Bold; do
  name="Inter-${spec#???}"
  pyftsubset "$SRC/$spec/Inter_$spec.ttf" \
    --unicodes="$UNICODES" \
    --layout-features+=tnum,case,zero \
    --name-IDs='*' --name-legacy --notdef-outline \
    --output-file="assets/fonts/$name.ttf"
  echo "assets/fonts/$name.ttf $(wc -c < "assets/fonts/$name.ttf") bytes"
done
cp "$SRC/LICENSE_FONT" assets/fonts/Inter-OFL.txt
