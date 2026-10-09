import { profileFromMetadata } from '@/features/auth/profile';
import { greetingFor } from '@/lib/dates';

import { avatarColors, initialsOf, safePhotoUrl } from '../avatarColors';

describe('initialsOf', () => {
  it('takes first and last word initials', () => {
    expect(initialsOf('Swapnil Meshram')).toBe('SM');
    expect(initialsOf('  priya   r  joshi ')).toBe('PJ');
    expect(initialsOf('rahul')).toBe('R');
  });

  it('handles empty names and non-Latin scripts without splitting characters', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('अमित शर्मा')).toBe('अश');
  });
});

describe('avatarColors', () => {
  it('is deterministic per seed and scheme', () => {
    expect(avatarColors('member-1', 'light')).toEqual(avatarColors('member-1', 'light'));
    const seeds = Array.from({ length: 40 }, (_, i) => `m-${i}`);
    expect(new Set(seeds.map((s) => avatarColors(s, 'dark').bg)).size).toBeGreaterThan(3);
  });
});

describe('safePhotoUrl', () => {
  it('accepts https URLs only', () => {
    expect(safePhotoUrl('https://lh3.googleusercontent.com/a/abc=s96-c')).toBe(
      'https://lh3.googleusercontent.com/a/abc=s96-c',
    );
    expect(safePhotoUrl('http://example.com/a.png')).toBeNull();
    expect(safePhotoUrl('file:///data/user/0/a.png')).toBeNull();
    expect(safePhotoUrl('javascript:alert(1)')).toBeNull();
    expect(safePhotoUrl('https://')).toBeNull();
    expect(safePhotoUrl(42)).toBeNull();
    expect(safePhotoUrl(`https://a.com/${'x'.repeat(3000)}`)).toBeNull();
  });
});

describe('profileFromMetadata', () => {
  it('reads Google metadata', () => {
    expect(
      profileFromMetadata({ full_name: ' Asha Rao ', avatar_url: 'https://lh3.googleusercontent.com/a/x' }),
    ).toEqual({ displayName: 'Asha Rao', avatarUrl: 'https://lh3.googleusercontent.com/a/x' });
    expect(profileFromMetadata({ name: 'Asha', picture: 'https://p/x' })).toEqual({
      displayName: 'Asha',
      avatarUrl: 'https://p/x',
    });
  });

  it('returns nulls for email sign-in or junk, and never truncates a URL', () => {
    expect(profileFromMetadata({})).toEqual({ displayName: null, avatarUrl: null });
    expect(profileFromMetadata(null)).toEqual({ displayName: null, avatarUrl: null });
    expect(profileFromMetadata({ full_name: 5, avatar_url: ['x'] })).toEqual({ displayName: null, avatarUrl: null });
    expect(profileFromMetadata({ avatar_url: `https://a.com/${'x'.repeat(2100)}` }).avatarUrl).toBeNull();
    expect(profileFromMetadata({ full_name: 'x'.repeat(200) }).displayName).toHaveLength(80);
  });
});

describe('greetingFor', () => {
  it('greets by local hour', () => {
    expect(greetingFor(new Date(2026, 9, 9, 8, 0))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 9, 9, 13, 0))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 9, 9, 22, 0))).toBe('Good evening');
    expect(greetingFor(new Date(2026, 9, 9, 2, 0))).toBe('Good evening');
  });
});
