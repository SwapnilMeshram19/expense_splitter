import { AndroidHaptics } from 'expo-haptics';

import { androidEffect, parseHapticsEnabled } from '../haptics';

describe('androidEffect', () => {
  it('uses the modern effects where the OS has them', () => {
    expect(androidEffect('selection', 34)).toBe(AndroidHaptics.Segment_Tick);
    expect(androidEffect('success', 30)).toBe(AndroidHaptics.Confirm);
    expect(androidEffect('warning', 33)).toBe(AndroidHaptics.Reject);
  });

  it('falls back to effects every Android version has (low-end phones on Android 9–10)', () => {
    expect(androidEffect('selection', 33)).toBe(AndroidHaptics.Clock_Tick);
    expect(androidEffect('success', 29)).toBe(AndroidHaptics.Virtual_Key);
    expect(androidEffect('warning', 28)).toBe(AndroidHaptics.Long_Press);
  });
});

describe('parseHapticsEnabled', () => {
  it('is on unless explicitly turned off', () => {
    expect(parseHapticsEnabled(null)).toBe(true);
    expect(parseHapticsEnabled('on')).toBe(true);
    expect(parseHapticsEnabled('garbage')).toBe(true);
    expect(parseHapticsEnabled('off')).toBe(false);
  });
});
