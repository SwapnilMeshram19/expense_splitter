import { Redirect } from 'expo-router';

/**
 * Placeholder route behind the centre "+" button. The button opens the add-expense flow itself
 * and never navigates here; a deep link to /add lands on Home instead of an empty screen.
 */
export default function AddPlaceholder() {
  return <Redirect href="/" />;
}
