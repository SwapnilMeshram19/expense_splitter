import { useState, type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A Pressable that settles in slightly while held (98%), then back: the calm, tactile feedback
 * that replaces the opacity flash on cards and buttons.
 *
 * Runs as a Reanimated CSS transition on the UI thread: no JS per frame, so it stays smooth on
 * low-end phones. Only `transform` animates (no layout), and 2% for ~120 ms is far below what
 * reduce-motion settings exist to prevent.
 */
export function PressableScale({
  style,
  children,
  disabled,
  onPressIn,
  onPressOut,
  scaleTo = 0.98,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  /** Plain style (not a function): `pressed` is handled here. */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  scaleTo?: number;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={[
        style,
        {
          transform: [{ scale: pressed && !disabled ? scaleTo : 1 }],
          transitionProperty: 'transform',
          transitionDuration: pressed ? 90 : 160,
          transitionTimingFunction: 'ease-out',
        },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}
