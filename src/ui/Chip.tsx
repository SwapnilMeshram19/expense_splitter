import { Pressable, StyleSheet } from 'react-native';

import { AppText } from './AppText';
import { useTheme } from './theme';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** Single-choice pill (payer, method). Selected = tinted fill + accent border, not a solid block. */
export function Chip({ label, selected, onPress }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? theme.primarySoft : theme.surface,
        },
      ]}
    >
      <AppText
        variant="label"
        color={selected ? theme.onPrimarySoft : theme.text}
        style={selected ? styles.selected : undefined}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { fontWeight: '600' },
});
