import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appContext } from '@/db/appContext';
import { markGuideSeen } from '@/features/onboarding/guide';
import { GUIDE_PAGES, type GuidePage } from '@/features/onboarding/guidePages';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { GradientSurface } from '@/ui/GradientSurface';
import { Icon } from '@/ui/Icon';
import { ScreenGlow } from '@/ui/ScreenGlow';
import { useTheme, type Theme } from '@/ui/theme';

/**
 * First-run guide: four swipeable pages, then "Create a group" / "Join a group". Opened by Home
 * once per install (see onboarding/guide.ts) and again from Account → How it works.
 *
 * Plain FlatList paging, static icons, no animation library: smooth on low-end phones.
 */
export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<GuidePage>>(null);
  const [index, setIndex] = useState(0);
  const last = index === GUIDE_PAGES.length - 1;

  // Seen as soon as it opens: killing the app halfway must not bring it back on every launch.
  useEffect(() => markGuideSeen(appContext), []);

  const goTo = (next: number) => {
    list.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)));

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <ScreenGlow />
      <View style={styles.topBar}>
        <AppText variant="label" color={theme.muted}>
          {index + 1} of {GUIDE_PAGES.length}
        </AppText>
        {last ? null : (
          <Pressable
            onPress={close}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Skip the guide"
          >
            <AppText variant="label" color={theme.primary}>
              Skip
            </AppText>
          </Pressable>
        )}
      </View>

      <FlatList
        ref={list}
        data={GUIDE_PAGES}
        keyExtractor={(p) => p.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => <Page page={item} width={width} theme={theme} />}
        style={styles.grow}
      />

      <Dots count={GUIDE_PAGES.length} active={index} theme={theme} />

      <View style={styles.actions}>
        {last ? (
          <>
            <Button
              label="Create a group"
              icon="add"
              size="lg"
              onPress={() => router.replace('/groups/new')}
            />
            <Button
              label="Join with a code"
              icon="link"
              variant="secondary"
              onPress={() => router.replace('/join')}
            />
            <Button label="Look around first" variant="soft" onPress={close} />
          </>
        ) : (
          <Button label="Next" icon="arrowForward" size="lg" onPress={() => goTo(index + 1)} />
        )}
      </View>
    </View>
  );
}

function Page({ page, width, theme }: { page: GuidePage; width: number; theme: Theme }) {
  return (
    <View
      style={[styles.page, { width }]}
      accessible
      accessibilityLabel={`${page.title}. ${page.body}`}
    >
      <GradientSurface style={[styles.hero, { borderColor: theme.heroBorder }]}>
        <Icon name={page.icon} color={theme.onGradient} size={44} />
      </GradientSurface>
      <AppText variant="title" style={styles.center} accessibilityRole="header">
        {page.title}
      </AppText>
      <AppText color={theme.muted} style={styles.center}>
        {page.body}
      </AppText>
      <View style={[styles.points, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {page.points.map((p) => (
          <View key={p.text} style={styles.point}>
            <View style={[styles.pointIcon, { backgroundColor: theme.primarySoft }]}>
              <Icon name={p.icon} color={theme.onPrimarySoft} size={16} />
            </View>
            <AppText variant="label" style={styles.grow}>
              {p.text}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function Dots({ count, active, theme }: { count: number; active: number; theme: Theme }) {
  return (
    <View style={styles.dots} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === active
              ? { backgroundColor: theme.primary, width: 20 }
              : { backgroundColor: theme.border },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 48,
  },
  page: { paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center', gap: 14 },
  hero: {
    width: 104,
    height: 104,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  center: { textAlign: 'center' },
  points: {
    alignSelf: 'stretch',
    marginTop: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  pointIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 16 },
  dot: { height: 8, width: 8, borderRadius: 4 },
  actions: { paddingHorizontal: 20, gap: 10 },
});
