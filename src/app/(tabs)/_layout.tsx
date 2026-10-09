import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { getDeviceUserId } from '@/db/session';
import { openAddExpense } from '@/features/overview/openAddExpense';
import { Icon, type IconName } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

const BAR_HEIGHT = 64;

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
        onPress={() => openAddExpense(db, getDeviceUserId())}
        accessibilityRole="button"
        accessibilityLabel="Add expense"
        style={({ pressed }) => [
          styles.addButton,
          {
            backgroundColor: theme.primary,
            borderColor: theme.background,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Icon name="add" color={theme.onPrimary} size={26} />
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
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.onPrimarySoft,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          height: BAR_HEIGHT + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 6,
          elevation: 0,
        },
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
  iconPill: { width: 52, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  addSlot: { flex: 1, alignItems: 'center' },
  addButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 4,
    marginTop: -22,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
});
