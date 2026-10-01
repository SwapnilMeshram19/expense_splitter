/**
 * Local SQLite schema. Mirrors the future Supabase (Postgres) schema.
 *
 * Conventions:
 * - Money: integer paise. Never REAL.
 * - System timestamps: UTC epoch ms (integer). Calendar dates: 'YYYY-MM-DD' text.
 * - Syncable tables are never hard-deleted (deleted_at tombstones).
 * - version = last server-acknowledged version (0 = never synced), used as the base for
 *   conflict detection; dirty = local changes not yet pushed.
 * - Payers/shares are owned by their expense and always rewritten with it in one transaction.
 *
 * Only `import type` from app code here: drizzle-kit loads this file outside Metro.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type { ItemInput, SplitInput } from '@/domain/splits';

/** Split input as stored: itemized items also carry their receipt line name. */
export type StoredSplitInput =
  | Exclude<SplitInput, { type: 'itemized' }>
  | { type: 'itemized'; items: (ItemInput & { name: string })[] };

export const EXPENSE_CATEGORIES = [
  'general',
  'food',
  'groceries',
  'travel',
  'transport',
  'stay',
  'shopping',
  'utilities',
  'entertainment',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const SETTLEMENT_METHODS = ['upi', 'cash', 'other'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const ENTITY_TYPES = ['group', 'member', 'expense', 'settlement'] as const;
export const ACTIVITY_ACTIONS = ['create', 'update', 'delete', 'restore'] as const;

/** Sync bookkeeping. A factory, because column builders must not be shared between tables. */
const syncColumns = () => ({
  createdAt: integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now()),
  deletedAt: integer('deleted_at'),
  version: integer('version').notNull().default(0),
  dirty: integer('dirty', { mode: 'boolean' }).notNull().default(true),
});

export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    simplifyDebts: integer('simplify_debts', { mode: 'boolean' }).notNull().default(true),
    ...syncColumns(),
  },
  (t) => [check('groups_name_not_blank', sql`length(trim(${t.name})) > 0`)],
);

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    displayName: text('display_name').notNull(),
    /** null = placeholder member without an account; can be claimed later via invite. */
    userId: text('user_id'),
    /** Visible only within this group. */
    upiVpa: text('upi_vpa'),
    ...syncColumns(),
  },
  (t) => [
    index('members_group_idx').on(t.groupId),
    // SQLite treats NULLs as distinct, so any number of placeholders is allowed.
    uniqueIndex('members_group_user_uq').on(t.groupId, t.userId),
    check('members_name_not_blank', sql`length(trim(${t.displayName})) > 0`),
  ],
);

export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    description: text('description').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    category: text('category', { enum: EXPENSE_CATEGORIES }).notNull().default('general'),
    /** Local calendar date 'YYYY-MM-DD'. Not a timestamp, so it can never shift by timezone. */
    expenseDate: text('expense_date').notNull(),
    /** Raw split as entered, so the user can re-edit it exactly. */
    splitInput: text('split_input', { mode: 'json' }).$type<StoredSplitInput>().notNull(),
    createdByMemberId: text('created_by_member_id')
      .notNull()
      .references(() => members.id),
    ...syncColumns(),
  },
  (t) => [
    index('expenses_group_date_idx').on(t.groupId, t.expenseDate),
    check('expenses_amount_positive', sql`${t.amountPaise} > 0`),
    check(
      'expenses_date_format',
      sql`${t.expenseDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const expensePayers = sqliteTable(
  'expense_payers',
  {
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    amountPaise: integer('amount_paise').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.memberId] }),
    index('expense_payers_member_idx').on(t.memberId),
    check('expense_payers_amount_non_negative', sql`${t.amountPaise} >= 0`),
  ],
);

export const expenseShares = sqliteTable(
  'expense_shares',
  {
    expenseId: text('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    amountPaise: integer('amount_paise').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.memberId] }),
    index('expense_shares_member_idx').on(t.memberId),
    check('expense_shares_amount_non_negative', sql`${t.amountPaise} >= 0`),
  ],
);

export const settlements = sqliteTable(
  'settlements',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    fromMemberId: text('from_member_id')
      .notNull()
      .references(() => members.id),
    toMemberId: text('to_member_id')
      .notNull()
      .references(() => members.id),
    amountPaise: integer('amount_paise').notNull(),
    method: text('method', { enum: SETTLEMENT_METHODS }).notNull().default('upi'),
    note: text('note'),
    settledAt: integer('settled_at').notNull(),
    createdByMemberId: text('created_by_member_id')
      .notNull()
      .references(() => members.id),
    ...syncColumns(),
  },
  (t) => [
    index('settlements_group_idx').on(t.groupId),
    check('settlements_amount_positive', sql`${t.amountPaise} > 0`),
    check('settlements_not_self', sql`${t.fromMemberId} <> ${t.toMemberId}`),
  ],
);

/** Append-only history. Never updated or deleted; pushed to the server but never edited. */
export const activityLog = sqliteTable(
  'activity_log',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id),
    entityType: text('entity_type', { enum: ENTITY_TYPES }).notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action', { enum: ACTIVITY_ACTIONS }).notNull(),
    actorMemberId: text('actor_member_id').references(() => members.id),
    before: text('before', { mode: 'json' }),
    after: text('after', { mode: 'json' }),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    dirty: integer('dirty', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('activity_group_created_idx').on(t.groupId, t.createdAt)],
);

/** Local-only key/value (never synced): device profile id, UI preferences. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type ExpensePayer = typeof expensePayers.$inferSelect;
export type ExpenseShare = typeof expenseShares.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;
export type ActivityLogEntry = typeof activityLog.$inferSelect;