import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createGroup, deleteGroup } from '@/db/repositories/groups';
import { getOrCreateDeviceUserId, getSetting, setSetting } from '@/db/repositories/profile';
import { SAMPLE_GROUP_IDS_KEY } from '@/db/repositories/sampleIds';

import { GUIDE_SEEN_KEY, markGuideSeen, shouldShowGuide } from '../guide';
import { GUIDE_PAGES } from '../guidePages';

let t: TestContext;
let me: string;

beforeEach(() => {
  t = createTestContext();
  me = getOrCreateDeviceUserId(t.ctx);
});
afterEach(() => t.close());

function makeGroup(name = 'Flat') {
  const r = createGroup(t.ctx, {
    name,
    selfName: 'Asha',
    otherMemberNames: ['Ravi'],
    deviceUserId: me,
  });
  if (!r.ok) throw new Error('group');
  return r.value;
}

describe('shouldShowGuide', () => {
  it('shows on a fresh install until it has been seen', () => {
    expect(shouldShowGuide(t.ctx)).toBe(true);
    expect(shouldShowGuide(t.ctx)).toBe(true);
    markGuideSeen(t.ctx);
    expect(shouldShowGuide(t.ctx)).toBe(false);
  });

  it('never shows to someone who already has a group, and remembers that', () => {
    makeGroup();
    expect(shouldShowGuide(t.ctx)).toBe(false);
    expect(getSetting(t.ctx, GUIDE_SEEN_KEY)).toBe('1');
  });

  it('counts deleted groups as history too', () => {
    const g = makeGroup();
    deleteGroup(t.ctx, { groupId: g.groupId, actorMemberId: g.selfMemberId });
    expect(shouldShowGuide(t.ctx)).toBe(false);
  });

  it('ignores a leftover example group from an old build', () => {
    const g = makeGroup('Old example');
    setSetting(t.ctx, SAMPLE_GROUP_IDS_KEY, JSON.stringify([g.groupId]));
    expect(shouldShowGuide(t.ctx)).toBe(true);
  });
});

describe('GUIDE_PAGES', () => {
  it('stays short, with unique keys and a few points per page', () => {
    expect(GUIDE_PAGES.length).toBeLessThanOrEqual(5);
    expect(new Set(GUIDE_PAGES.map((p) => p.key)).size).toBe(GUIDE_PAGES.length);
    for (const page of GUIDE_PAGES) {
      expect(page.points.length).toBeGreaterThanOrEqual(1);
      expect(page.points.length).toBeLessThanOrEqual(3);
      // One line on a small phone.
      for (const p of page.points) expect(p.text.length).toBeLessThanOrEqual(48);
    }
  });
});
