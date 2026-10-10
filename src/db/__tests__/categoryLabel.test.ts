import { normalizeCategoryLabel } from '@/domain/categoryLabel';
import { describeActivity } from '@/features/activity/describeActivity';
import { analyzeForm, initialFormState } from '@/features/expenses/formState';
import { applyPull, applyPushResult, collectPushBatch } from '@/sync/engine';
import type { PullResult } from '@/sync/wire';
import { filterMembers } from '@/ui/memberFilter';

import { createExpense, getExpense, groupCategoryLabels, updateExpense } from '../repositories/expenses';
import { createGroup } from '../repositories/groups';
import { activeMembersQuery } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import type { ActivityLogEntry } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;
beforeEach(() => {
  t = createTestContext();
});
afterEach(() => t.close());

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Car pool',
    selfName: 'Asha',
    otherMemberNames: ['Rahul'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error('createGroup failed');
  const { groupId, selfMemberId: me } = created.value;
  const rahul = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'Rahul')!.id;
  return { groupId, me, rahul };
}

function add(groupId: string, me: string, rahul: string, extra: { category?: 'other' | 'food'; categoryLabel?: string | null }) {
  const result = createExpense(t.ctx, {
    groupId,
    description: 'Trip',
    amountPaise: 10000,
    expenseDate: '2026-10-01',
    payers: [{ memberId: me, amountPaise: 10000 }],
    splitInput: { type: 'equal', memberIds: [me, rahul] },
    actorMemberId: me,
    ...extra,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  t.advance(1000);
  return result.value.expenseId;
}

describe('normalizeCategoryLabel', () => {
  it('trims, collapses spaces and treats empty as plain Other', () => {
    expect(normalizeCategoryLabel('  Society   maintenance ')).toEqual({ ok: true, label: 'Society maintenance' });
    expect(normalizeCategoryLabel('   ')).toEqual({ ok: true, label: null });
    expect(normalizeCategoryLabel(null)).toEqual({ ok: true, label: null });
  });

  it('limits length by characters as typed', () => {
    expect(normalizeCategoryLabel('x'.repeat(30)).ok).toBe(true);
    expect(normalizeCategoryLabel('x'.repeat(31))).toEqual({ ok: false, error: 'TOO_LONG' });
    expect(normalizeCategoryLabel('पेट्रोल').ok).toBe(true);
  });
});

describe('custom category on expenses', () => {
  it('stores the label only with Other', () => {
    const { groupId, me, rahul } = setup();
    const custom = add(groupId, me, rahul, { category: 'other', categoryLabel: ' Petrol ' });
    const food = add(groupId, me, rahul, { category: 'food', categoryLabel: 'Ignored' });
    expect(getExpense(t.ctx.db, custom)!.expense.categoryLabel).toBe('Petrol');
    expect(getExpense(t.ctx.db, food)!.expense.categoryLabel).toBeNull();
  });

  it('refuses a name that is too long', () => {
    const { groupId, me, rahul } = setup();
    const result = createExpense(t.ctx, {
      groupId,
      description: 'Trip',
      amountPaise: 100,
      expenseDate: '2026-10-01',
      category: 'other',
      categoryLabel: 'x'.repeat(31),
      payers: [{ memberId: me, amountPaise: 100 }],
      splitInput: { type: 'equal', memberIds: [me, rahul] },
      actorMemberId: me,
    });
    expect(result).toEqual({ ok: false, error: { code: 'CATEGORY_LABEL_TOO_LONG' } });
  });

  it('keeps the label when an update does not mention it, drops it on a real category', () => {
    const { groupId, me, rahul } = setup();
    const id = add(groupId, me, rahul, { category: 'other', categoryLabel: 'Petrol' });
    const base = {
      groupId,
      description: 'Trip (edited)',
      amountPaise: 10000,
      expenseDate: '2026-10-01',
      payers: [{ memberId: me, amountPaise: 10000 }],
      splitInput: { type: 'equal' as const, memberIds: [me, rahul] },
      actorMemberId: me,
    };
    expect(updateExpense(t.ctx, id, base).ok).toBe(true);
    expect(getExpense(t.ctx.db, id)!.expense.categoryLabel).toBe('Petrol');

    expect(updateExpense(t.ctx, id, { ...base, category: 'transport' }).ok).toBe(true);
    expect(getExpense(t.ctx.db, id)!.expense.categoryLabel).toBeNull();
  });

  it('suggests the group’s names, most used first, without case duplicates', () => {
    const { groupId, me, rahul } = setup();
    add(groupId, me, rahul, { category: 'other', categoryLabel: 'Maid' });
    add(groupId, me, rahul, { category: 'other', categoryLabel: 'petrol' });
    add(groupId, me, rahul, { category: 'other', categoryLabel: 'Petrol' });
    add(groupId, me, rahul, { category: 'other', categoryLabel: null });
    expect(groupCategoryLabels(t.ctx.db, groupId)).toEqual(['Petrol', 'Maid']);
    expect(groupCategoryLabels(t.ctx.db, 'other-group')).toEqual([]);
  });

  it('sends the label to the server and takes it from a pull', () => {
    const { groupId, me, rahul } = setup();
    const id = add(groupId, me, rahul, { category: 'other', categoryLabel: 'Petrol' });

    const collected = collectPushBatch(t.ctx)!;
    const sent = collected.batch.expenses.find((e) => e.id === id)!;
    expect(sent.category_label).toBe('Petrol');

    // Server accepts everything: the phone is now in sync at version 1.
    applyPushResult(t.ctx, collected, {
      applied: [
        ...collected.batch.groups.map((r) => ({ table: 'groups' as const, id: r.id, version: 1 })),
        ...collected.batch.members.map((r) => ({ table: 'members' as const, id: r.id, version: 1 })),
        ...collected.batch.expenses.map((r) => ({ table: 'expenses' as const, id: r.id, version: 1 })),
        ...collected.batch.activity.map((r) => ({ table: 'activity' as const, id: r.id, version: null })),
      ],
      conflicts: [],
      rejected: [],
    });

    // Someone renames it on another phone.
    const { base_version: _base, ...row } = sent;
    const pull: PullResult = {
      cursor: '1',
      group_ids: [groupId],
      groups: [],
      members: [],
      expenses: [{ ...row, version: 2, category_label: 'Diesel' }],
      settlements: [],
      activity: [],
    };
    applyPull(t.ctx, pull);
    expect(getExpense(t.ctx.db, id)!.expense.categoryLabel).toBe('Diesel');

    // A server without the column (older deployment) sends no label: the local one stays.
    const { category_label: _label, ...withoutLabel } = row;
    applyPull(t.ctx, { ...pull, expenses: [{ ...withoutLabel, version: 3 }] });
    expect(getExpense(t.ctx.db, id)!.expense.categoryLabel).toBe('Diesel');

    // Moving to a real category clears it.
    applyPull(t.ctx, { ...pull, expenses: [{ ...withoutLabel, category: 'transport', version: 4 }] });
    expect(getExpense(t.ctx.db, id)!.expense.categoryLabel).toBeNull();
  });
});

describe('form', () => {
  const members = ['a', 'b'];
  const state = (patch: object) => ({
    ...initialFormState(members, 'a', '2026-10-01'),
    description: 'Fuel',
    amountText: '500',
    ...patch,
  });

  it('puts the normalised name in the draft only for Other', () => {
    expect(analyzeForm(state({ category: 'other', categoryLabel: ' Petrol ' }), members).draft?.categoryLabel).toBe('Petrol');
    expect(analyzeForm(state({ category: 'food', categoryLabel: 'Petrol' }), members).draft?.categoryLabel).toBeNull();
    expect(analyzeForm(state({ category: 'other', categoryLabel: '' }), members).draft?.categoryLabel).toBeNull();
  });

  it('reports a name that is too long', () => {
    const analysis = analyzeForm(state({ category: 'other', categoryLabel: 'x'.repeat(31) }), members);
    expect(analysis.draft).toBeNull();
    expect(analysis.problems.join(' ')).toMatch(/category name/);
  });
});

describe('activity text', () => {
  it('shows custom names when the category changes', () => {
    const entry = {
      id: 'x',
      groupId: 'g',
      entityType: 'expense',
      entityId: 'e',
      action: 'update',
      actorMemberId: 'a',
      before: { description: 'Fuel', category: 'other', categoryLabel: 'Petrol' },
      after: { description: 'Fuel', category: 'transport', categoryLabel: null },
      createdAt: 0,
      dirty: false,
    } as unknown as ActivityLogEntry;
    const view = describeActivity(entry, { me: 'a', nameOf: () => 'Asha' });
    expect(`${view.title} ${view.detail ?? ''}`).toContain('Petrol → Transport');
  });
});

describe('filterMembers', () => {
  const people = [
    { id: '1', name: 'Rahul Sharma' },
    { id: '2', name: 'Priya' },
    { id: '3', name: 'rahul k' },
  ];
  it('matches case-insensitively anywhere in the name', () => {
    expect(filterMembers(people, 'RAHUL').map((p) => p.id)).toEqual(['1', '3']);
    expect(filterMembers(people, ' riy ').map((p) => p.id)).toEqual(['2']);
    expect(filterMembers(people, '')).toHaveLength(3);
    expect(filterMembers(people, 'zz')).toEqual([]);
  });
});
