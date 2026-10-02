import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { useTheme } from '@/ui/theme';

import { useAuth } from './authStore';

export function AccountButton() {
  const auth = useAuth();
  const theme = useTheme();
  if (auth.status === 'loading') return null;

  return (
    <Pressable onPress={() => router.push('/account')} hitSlop={12} accessibilityRole="button">
      <Text style={{ color: theme.primary, fontSize: 16, fontWeight: '500' }}>
        {auth.status === 'signedIn' ? 'Account' : 'Sign in'}
      </Text>
    </Pressable>
  );
}