import { planChannels } from '../realtime';

describe('planChannels', () => {
  it('opens new groups and closes ones that are gone', () => {
    expect(planChannels(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
  });

  it('closes everything when nothing is wanted (background, offline, no account)', () => {
    expect(planChannels(new Set(['a', 'b']).keys(), [])).toEqual({ add: [], remove: ['a', 'b'] });
  });

  it('does nothing when already in place', () => {
    expect(planChannels(['a'], ['a'])).toEqual({ add: [], remove: [] });
  });
});
