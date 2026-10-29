/**
 * Your payment details: kept on this phone as your default, and copied onto your member row in
 * each group (what the other members see). Copying happens only when you save, create a group or
 * join one, never in the background, so two phones with different details can't keep
 * overwriting each other.
 */
import { dataStore } from '@/data';
import { findSelfMemberId } from '@/data/selectors';
import type { RepoContext } from '@/db/context';
import { getSetting, setSetting } from '@/db/repositories/profile';
import type { CommandError, PayDetailsError } from '@/domain/commands';
import { MAX_PAY_METHODS, parsePayMethods, samePayMethod, serializePayMethods, type PayMethod } from '@/domain/payMethods';
import { isValidVpa, parseVpaInput } from '@/domain/upi';
import { err, ok, type Result } from '@/lib/result';

export const MY_PAY_DETAILS_KEY = 'my_pay_details';
/** Before the payment details screen existed, only the last UPI ID saved in a group was kept. */
const LAST_OWN_VPA_KEY = 'last_own_upi_vpa';

export interface PayDetails {
  vpa: string | null;
  methods: PayMethod[];
}

export function getMyPayDetails(ctx: RepoContext): PayDetails | null {
  const raw = getSetting(ctx, MY_PAY_DETAILS_KEY);
  if (raw) {
    try {
      const value = JSON.parse(raw) as { vpa?: unknown; methods?: unknown };
      return { vpa: isValidVpa(value.vpa as string) ? (value.vpa as string) : null, methods: parsePayMethods(value.methods) };
    } catch {
      // fall through to the older setting
    }
  }
  const lastVpa = getSetting(ctx, LAST_OWN_VPA_KEY);
  return isValidVpa(lastVpa) ? { vpa: lastVpa, methods: [] } : null;
}

/** My member rows in the groups I'm in: [groupId, member]. */
function myMembers() {
  const store = dataStore();
  const user = store.planningUserId();
  return store.groups().flatMap((s) => {
    const id = findSelfMemberId(s, user);
    const member = id ? s.members.find((m) => m.id === id) : undefined;
    return member ? [{ groupId: s.group.id, member }] : [];
  });
}

export const myGroupCount = (): number => myMembers().length;

function check(vpaInput: string | null, methods: readonly PayMethod[]): Result<PayDetails, PayDetailsError> {
  let vpa: string | null = null;
  if (vpaInput !== null && vpaInput.trim() !== '') {
    const parsed = parseVpaInput(vpaInput);
    if (!parsed.ok) return err(parsed.error);
    vpa = parsed.vpa;
  }
  const out: PayMethod[] = [];
  for (const m of methods) if (!out.some((x) => samePayMethod(x, m))) out.push(m);
  if (out.length > MAX_PAY_METHODS) return err({ code: 'TOO_MANY_METHODS', max: MAX_PAY_METHODS });
  return ok({ vpa, methods: out });
}

/**
 * Save your details here and in every group you're in (or only `groupId`). Groups that couldn't
 * be updated (offline, someone changed your row) are counted, not fatal: the default is saved.
 */
export async function saveMyPayDetails(
  ctx: RepoContext,
  input: { vpaInput: string | null; methods: readonly PayMethod[]; groupId?: string },
): Promise<Result<{ details: PayDetails; updatedGroups: number; failedGroups: number }, PayDetailsError | CommandError>> {
  const checked = check(input.vpaInput, input.methods);
  if (!checked.ok) return checked;
  const details = checked.value;
  if (!input.groupId) setSetting(ctx, MY_PAY_DETAILS_KEY, JSON.stringify(details));

  let updatedGroups = 0;
  let failedGroups = 0;
  const target = `${details.vpa}|${serializePayMethods(details.methods)}`;
  for (const { groupId, member } of myMembers()) {
    if (input.groupId && groupId !== input.groupId) continue;
    if (`${member.upiVpa}|${serializePayMethods(parsePayMethods(member.payMethods))}` === target) continue;
    const result = await dataStore().run('member.update', {
      groupId,
      memberId: member.id,
      expectedVersion: member.version,
      upiVpa: details.vpa,
      payMethods: details.methods,
    });
    if (result.ok) updatedGroups++;
    else if (input.groupId) return err(result.error as CommandError);
    else failedGroups++;
  }
  return ok({ details, updatedGroups, failedGroups });
}

/** After joining a group: copy your saved details into it (no-op if none saved). Best effort. */
export async function applyMyPayDetailsToGroup(ctx: RepoContext, groupId: string): Promise<void> {
  const mine = getMyPayDetails(ctx);
  if (!mine || (mine.vpa === null && mine.methods.length === 0)) return;
  await saveMyPayDetails(ctx, { vpaInput: mine.vpa, methods: mine.methods, groupId });
}
