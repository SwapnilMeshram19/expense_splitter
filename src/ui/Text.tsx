import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { useTheme } from './theme';

/**
 * Drop-in replacements for react-native's Text and TextInput that use the app font and theme
 * colours by default. Screens import these instead of the react-native ones; any style passed in
 * still wins (colour, size, weight), so existing layouts keep working unchanged.
 */
export function Text({ style, ...rest }: TextProps) {
  const theme = useTheme();
  return <RNText {...rest} style={[{ fontFamily: theme.fontFamily, color: theme.text }, style]} />;
}

export function TextInput({ style, placeholderTextColor, ...rest }: TextInputProps) {
  const theme = useTheme();
  return (
    <RNTextInput
      {...rest}
      placeholderTextColor={placeholderTextColor ?? theme.muted}
      selectionColor={theme.primary}
      style={[{ fontFamily: theme.fontFamily, color: theme.text }, style]}
    />
  );
}
