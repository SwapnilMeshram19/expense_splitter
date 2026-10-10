import { changedGroupIds, groupTopic, parseOrigin } from '../changeSignals';

const G1 = '019a0000-0000-7000-8000-000000000001';
const G2 = '019A0000-0000-7000-8000-000000000002';
const E1 = '019a0000-0000-7000-8000-0000000000e1';
const E2 = '019a0000-0000-7000-8000-0000000000e2';
const M1 = '019a0000-0000-7000-8000-0000000000a1';

describe('groupTopic', () => {
  it('prefixes and lower-cases the id', () => {
    expect(groupTopic(G2)).toBe('group:019a0000-0000-7000-8000-000000000002');
  });
});

describe('parseOrigin', () => {
  it('accepts uuid-like ids only', () => {
    expect(parseOrigin(E1)).toBe(E1);
    expect(parseOrigin('short')).toBeNull();
    expect(parseOrigin('x'.repeat(65))).toBeNull();
    expect(parseOrigin('bad id with spaces')).toBeNull();
    expect(parseOrigin(null)).toBeNull();
    expect(parseOrigin(42)).toBeNull();
  });
});

describe('changedGroupIds', () => {
  const batch = {
    groups: [{ id: G2 }],
    members: [{ id: M1, group_id: G1 }],
    expenses: [
      { id: E1, group_id: G1 },
      { id: E2, group_id: G2 },
    ],
    settlements: [],
  };

  it('returns the groups of applied rows, de-duplicated and lower-cased', () => {
    const applied = [
      { table: 'expenses', id: E1 },
      { table: 'members', id: M1 },
      { table: 'groups', id: G2 },
    ];
    expect(changedGroupIds(batch, applied)).toEqual([G1, G2.toLowerCase()]);
  });

  it('ignores rows that were not applied, unknown tables and junk', () => {
    expect(changedGroupIds(batch, [])).toEqual([]);
    expect(changedGroupIds(batch, [{ table: 'activity', id: E1 }])).toEqual([]);
    expect(changedGroupIds(batch, [{ table: 'expenses', id: 'nope' }, { table: 5, id: null }])).toEqual([]);
  });

  it('matches ids case-insensitively', () => {
    expect(changedGroupIds(batch, [{ table: 'expenses', id: E2.toUpperCase() }])).toEqual([G2.toLowerCase()]);
  });

  it('never trusts a malformed group id from the batch', () => {
    const bad = { expenses: [{ id: E1, group_id: 'group:evil' }] };
    expect(changedGroupIds(bad, [{ table: 'expenses', id: E1 }])).toEqual([]);
  });

  it('caps the number of groups', () => {
    const applied = [
      { table: 'expenses', id: E1 },
      { table: 'expenses', id: E2 },
    ];
    expect(changedGroupIds(batch, applied, 1)).toEqual([G1]);
  });
});
