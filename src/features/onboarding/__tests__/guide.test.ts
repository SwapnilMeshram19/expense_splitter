import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createGroup } from '@/db/repositories/groups';
import { getOrCreateDeviceUserId, getSetting } from '@/db/repositories/profile';

import { GUIDE_SEEN_KEY, markGuideSeen, shouldShowGuide } from '../guide';
import { GUIDE_PAGES } from '../guidePages';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});
afterEach(() => t.close());

describe('shouldShowGuide', () => {
  it('shows on a fresh install until it has been seen', () => {
    expect(shouldShowGuide(t.ctx, 0)).toBe(true);
    expect(shouldShowGuide(t.ctx, 0)).toBe(true);
    markGuideSeen(t.ctx);
    expect(shouldShowGuide(t.ctx, 0)).toBe(false);
  });

  it('never shows to someone who already has a group, and remembers that', () => {
    expect(shouldShowGuide(t.ctx, 1)).toBe(false);
    expect(getSetting(t.ctx, GUIDE_SEEN_KEY)).toBe('1');
  });

  it('counts groups still in the pre-1.1 tables (an update, before the hand-over)', () => {
    createGroup(t.ctx, { name: 'Flat', selfName: 'Asha', otherMemberNames: [], deviceUserId: getOrCreateDeviceUserId(t.ctx) });
    expect(shouldShowGuide(t.ctx, 0)).toBe(false);
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
