import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { openAddExpense } from '@/features/overview/openAddExpense';
import { GradientSurface } from '@/ui/GradientSurface';
import { Icon, type IconName } from '@/ui/Icon';
import { TAB_BAR_HEIGHT, useTabBarBottom } from '@/ui/tabBarSpace';
import { useTheme } from '@/ui/theme';

function TabIcon({ name, color, focused }: { name: IconName; color: ColorValue; focused: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.iconPill, focused && { backgroundColor: theme.primarySoft }]}>
      <Icon name={name} color={color} />
    </View>
  );
}

/** Raised centre button: not a tab, it starts the add-expense flow. */
function AddButton() {
  const theme = useTheme();
  return (
    <View style={styles.addSlot}>
      <Pressable
        onPress={openAddExpense}
        accessibilityRole="button"
        accessibilityLabel="Add expense"
        style={({ pressed }) => [
          styles.addRing,
          { transform: [{ scale: pressed ? 0.94 : 1 }] },
        ]}
      >
        <GradientSurface style={[styles.addButton, { borderColor: theme.heroBorder }]}>
          <Icon name="add" color={theme.onGradient} size={26} />
        </GradientSurface>
      </Pressable>
    </View>
  );
}

const renderAddButton = () => <AddButton />;

type TabIconProps = { color: ColorValue; focused: boolean };
const homeIcon = (p: TabIconProps) => <TabIcon name="home" {...p} />;
const activityIcon = (p: TabIconProps) => <TabIcon name="activity" {...p} />;
const settleIcon = (p: TabIconProps) => <TabIcon name="settle" {...p} />;
const accountIcon = (p: TabIconProps) => <TabIcon name="account" {...p} />;

export default function TabsLayout() {
  const theme = useTheme();
  const bottom = useTabBarBottom();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.onPrimarySoft,
        tabBarInactiveTintColor: theme.muted,
        // Floating pill: content scrolls underneath (tab screens pad by useTabBarSpace()).
        // Near-opaque surface instead of blur: blur views drop frames on low-end Android.
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom,
          height: TAB_BAR_HEIGHT,
          borderRadius: TAB_BAR_HEIGHT / 2,
          backgroundColor: `${theme.surface}F2`,
          borderWidth: StyleSheet.hairlineWidth,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: theme.border,
          borderTopColor: theme.highlight,
          paddingTop: 8,
          paddingBottom: 8,
          paddingHorizontal: 6,
          // One shadowed view is cheap; it lifts the bar off the content.
          elevation: 10,
          shadowColor: '#000000',
          shadowOpacity: 0.25,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
        },
        tabBarItemStyle: { height: TAB_BAR_HEIGHT - 16 },
        tabBarShowLabel: false,
        tabBarLabelStyle: { fontFamily: theme.fontFamily, fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: theme.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: homeIcon }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: activityIcon }} />
      <Tabs.Screen name="add" options={{ title: 'Add', tabBarButton: renderAddButton }} />
      <Tabs.Screen name="settle" options={{ title: 'Settle', tabBarIcon: settleIcon }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: accountIcon }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconPill: { width: 56, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  addSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Gradient disc sitting inside the pill.
  addRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 0, marginTop: -2, overflow: 'hidden' },
  addButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
