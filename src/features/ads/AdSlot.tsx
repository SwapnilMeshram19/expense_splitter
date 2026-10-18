import { useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

import { getAppVariant } from '@/lib/appVariant';
import { AppText } from '@/ui/AppText';
import { useTheme } from '@/ui/theme';

import { chooseAdUnit, type AdPlacement } from './adPolicy';
import { useAdsState } from './adsRuntime';

/**
 * Production ad unit IDs (Android). Direct process.env access so Expo inlines them at build time.
 * Not secret: they ship in the APK anyway. iOS has no units yet, so iOS shows no ads.
 */
function configuredUnit(placement: AdPlacement): string | undefined {
  if (Platform.OS !== 'android') return undefined;
  return placement === 'home'
    ? process.env.EXPO_PUBLIC_ADMOB_HOME_BANNER_ID
    : process.env.EXPO_PUBLIC_ADMOB_ACTIVITY_BANNER_ID;
}

/** Inline adaptive banners can be screen-tall; this keeps the ad a calm card in the list. */
const MAX_AD_HEIGHT = 120;
/** Home and Activity lists have 20 px side padding. */
const LIST_SIDE_PADDING = 20;

/**
 * One inline banner, styled as a quiet "Sponsored" card. Renders nothing until the SDK is ready,
 * takes no space until an ad arrives (no empty box on slow networks), and disappears for good
 * on this mount if loading fails (offline, no fill).
 */
export function AdSlot({ placement, style }: { placement: AdPlacement; style?: ViewStyle }) {
  const theme = useTheme();
  const { ready } = useAdsState();
  const { width } = useWindowDimensions();
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

  const unitId = chooseAdUnit(getAppVariant(), configuredUnit(placement), TestIds.ADAPTIVE_BANNER);
  if (!ready || !unitId || status === 'failed') return null;

  const loaded = status === 'loaded';
  return (
    <View
      style={[
        // Before an ad arrives the banner is 0 px tall, so this takes no space. Never hidden with
        // opacity or clipping: AdMob treats ads loaded out of sight as invalid traffic.
        loaded && [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }],
        loaded && style,
      ]}
      accessibilityLabel={loaded ? 'Advertisement' : undefined}
    >
      {loaded ? (
        <AppText variant="caption" color={theme.muted} style={styles.label}>
          Sponsored
        </AppText>
      ) : null}
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.INLINE_ADAPTIVE_BANNER}
        width={Math.floor(width - LIST_SIDE_PADDING * 2 - 2)}
        maxHeight={MAX_AD_HEIGHT}
        onAdLoaded={() => setStatus('loaded')}
        onAdFailedToLoad={() => setStatus('failed')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 8,
  },
  label: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingBottom: 6 },
});
