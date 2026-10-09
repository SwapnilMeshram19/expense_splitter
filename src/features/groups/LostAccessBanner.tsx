import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { forgetGroupLocally } from '@/sync/lostGroups';
import { useTheme } from '@/ui/theme';

export function LostAccessBanner({ groupId, groupName }: { groupId: string; groupName: string }) {
  const theme = useTheme();

  const confirmForget = () =>
    Alert.alert(
      `Remove “${groupName}” from this phone?`,
      'Its history on this phone will be deleted. Nothing changes for the people still in the group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const result = forgetGroupLocally(appContext, groupId);
            if (result.ok) router.dismissTo('/');
            else Alert.alert('Not removed', 'You have access to this group again.');
          },
        },
      ],
    );

  return (
    <View style={[styles.banner, { borderColor: theme.warning, backgroundColor: theme.surface }]}>
      <Text style={{ color: theme.text, fontWeight: '600' }}>You no longer have access to this group</Text>
      <Text style={{ color: theme.muted }}>
        Someone may have removed you. You can still read what’s saved on this phone, but it can’t be changed.
        If you’re added back, it updates on the next sync.
      </Text>
      <Pressable accessibilityRole="button" onPress={confirmForget} hitSlop={8} style={styles.action}>
        <Text style={{ color: theme.negative, fontWeight: '600' }}>Remove from this phone</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  action: { paddingVertical: 4 },
});