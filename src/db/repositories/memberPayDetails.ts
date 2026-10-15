import { and, eq, isNull } from 'drizzle-orm';

import {
  MAX_PAY_METHODS,
  methodKinds,
  parsePayMethods,
  samePayMethod,
  serializePayMethods,
  type PayMethod,
} from '@/domain/payMethods';
import { isValidVpa, parseVpaInput } from '@/domain/upi';
import { err, ok, type Result } from '@/lib/result';

import type { RepoContext } from '../context';
import { activityLog, members, settings } from '../schema';
import { isGroupLost } from './access';
import { activeMemberIds } from './members';
import { canEditMemberUpi, LAST_OWN_VPA_KEY, setMemberUpiVpa, type MemberUpiError } from './memberUpi';

/**
 * Your payment details, saved on this phone (settings is never synced) and copied into your
 * member row in each group, which is what other members see. Copying happens only when you save,
 * create a group or join one: never in the background, so two phones with different details
 * can't keep overwriting each other.
 */
export const MY_PAY_DETAILS_KEY = 'my_pay_details';

export interface PayDetails {
  vpa: string | null;
  methods: PayMethod[];
}

export type PayDetailsError = MemberUpiError | { code: 'TOO_MANY_METHODS'; max: number };

export function getMyPayDetails(ctx: RepoContext): PayDetails | null {
  const raw = ctx.db.select().from(settings).where(eq(settings.key, MY_PAY_DETAILS_KEY)).get()?.value;
  if (raw) {
    try {
      const value = JSON.parse(raw) as { vpa?: unknown; methods?: unknown };
      return {
        vpa: isValidVpa(value.vpa as string) ? (value.vpa as string) : null,
        methods: parsePayMethods(value.methods),
      };
    } catch {
      // fall through to the older single-UPI setting
    }
  }
  // Before this screen existed, only the last UPI ID you saved in a group was remembered.
  const lastVpa = ctx.db.select().from(settings).where(eq(settings.key, LAST_OWN_VPA_KEY)).get()?.value;
  return isValidVpa(lastVpa) ? { vpa: lastVpa, methods: [] } : null;
}

function storeMyPayDetails(ctx: RepoContext, details: PayDetails): void {
  const value = JSON.stringify(details);
  ctx.db
    .insert(settings)
    .values({ key: MY_PAY_DETAILS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

/** Drops exact duplicates (same account typed twice) and enforces the limit. */
function dedupe(methods: readonly PayMethod[]): Result<PayMethod[], PayDetailsError> {
  const out: PayMethod[] = [];
  for (const m of methods) if (!out.some((x) => samePayMethod(x, m))) out.push(m);
  return out.length > MAX_PAY_METHODS ? err({ code: 'TOO_MANY_METHODS', max: MAX_PAY_METHODS }) : ok(out);
}

/** Set a member's other payment methods (already validated by the form). Same rules as UPI IDs. */
export function setMemberPayMethods(
  ctx: RepoContext,
  input: { memberId: string; methods: readonly PayMethod[]; actorMemberId: string },
): Result<PayMethod[], PayDetailsError> {
  const member = ctx.db.select().from(members).where(eq(members.id, input.memberId)).get();
  if (!member || member.deletedAt !== null) return err({ code: 'MEMBER_NOT_FOUND' });
  if (!activeMemberIds(ctx.db, member.groupId).has(input.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });
  if (!canEditMemberUpi(member, input.actorMemberId)) return err({ code: 'NOT_ALLOWED' });

  const deduped = dedupe(input.methods);
  if (!deduped.ok) return deduped;
  const next = serializePayMethods(deduped.value);
  const before = parsePayMethods(member.payMethods);
  if (next === serializePayMethods(before)) return ok(deduped.value);

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(members).set({ payMethods: next, updatedAt: t, dirty: true }).where(eq(members.id, member.id)).run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: member.groupId,
        entityType: 'member',
        entityId: member.id,
        action: 'update',
        actorMemberId: input.actorMemberId,
        // Kinds only: the log is append-only and synced; account details must not live there forever.
        before: { payMethods: methodKinds(before) },
        after: { payMethods: methodKinds(deduped.value) },
        createdAt: t,
      })
      .run();
  });
  return ok(deduped.value);
}

/** UPI ID + other methods for one member, as one save. */
export function setMemberPayDetails(
  ctx: RepoContext,
  input: { memberId: string; vpaInput: string | null; methods: readonly PayMethod[]; actorMemberId: string },
): Result<PayDetails, PayDetailsError> {
  // Validate everything before writing anything, so a bad UPI ID doesn't leave half a save.
  if (input.vpaInput !== null && input.vpaInput.trim() !== '') {
    const parsed = parseVpaInput(input.vpaInput);
    if (!parsed.ok) return err(parsed.error);
  }
  const deduped = dedupe(input.methods);
  if (!deduped.ok) return deduped;

  const upi = setMemberUpiVpa(ctx, { memberId: input.memberId, vpaInput: input.vpaInput, actorMemberId: input.actorMemberId });
  if (!upi.ok) return upi;
  const methods = setMemberPayMethods(ctx, {
    memberId: input.memberId,
    methods: deduped.value,
    actorMemberId: input.actorMemberId,
  });
  if (!methods.ok) return methods;
  return ok({ vpa: upi.value.vpa, methods: methods.value });
}

/** Your member rows in groups you can still change. */
function myMemberRows(ctx: RepoContext, deviceUserId: string, groupId?: string) {
  return ctx.db
    .select()
    .from(members)
    .where(
      and(
        eq(members.userId, deviceUserId),
        isNull(members.deletedAt),
        groupId ? eq(members.groupId, groupId) : undefined,
      ),
    )
    .all()
    .filter((m) => !isGroupLost(ctx.db, m.groupId));
}

export const myGroupCount = (ctx: RepoContext, deviceUserId: string): number =>
  myMemberRows(ctx, deviceUserId).length;

/**
 * Save your details on this phone and copy them into every group you're in (or just `groupId`).
 * Returns how many groups changed.
 */
export function saveMyPayDetails(
  ctx: RepoContext,
  input: { deviceUserId: string; vpaInput: string | null; methods: readonly PayMethod[]; groupId?: string },
): Result<{ details: PayDetails; updatedGroups: number }, PayDetailsError> {
  let vpa: string | null = null;
  if (input.vpaInput !== null && input.vpaInput.trim() !== '') {
    const parsed = parseVpaInput(input.vpaInput);
    if (!parsed.ok) return err(parsed.error);
    vpa = parsed.vpa;
  }
  const deduped = dedupe(input.methods);
  if (!deduped.ok) return deduped;
  const details: PayDetails = { vpa, methods: deduped.value };

  if (!input.groupId) storeMyPayDetails(ctx, details);
  let updatedGroups = 0;
  for (const row of myMemberRows(ctx, input.deviceUserId, input.groupId)) {
    const before = `${row.upiVpa}|${serializePayMethods(parsePayMethods(row.payMethods))}`;
    const result = setMemberPayDetails(ctx, {
      memberId: row.id,
      vpaInput: vpa,
      methods: details.methods,
      actorMemberId: row.id,
    });
    if (result.ok && before !== `${vpa}|${serializePayMethods(details.methods)}`) updatedGroups++;
  }
  return ok({ details, updatedGroups });
}

/** After creating or joining a group: copy your saved details into it (no-op if none saved). */
export function applyMyPayDetailsToGroup(ctx: RepoContext, deviceUserId: string, groupId: string): void {
  const mine = getMyPayDetails(ctx);
  if (!mine || (mine.vpa === null && mine.methods.length === 0)) return;
  saveMyPayDetails(ctx, { deviceUserId, vpaInput: mine.vpa, methods: mine.methods, groupId });
}
