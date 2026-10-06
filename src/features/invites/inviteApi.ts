import { err, ok, type Result } from '@/lib/result';
import { getSupabase } from '@/lib/supabase';

import type { InviteStatus } from './messages';

export interface InviteFailure {
  status: InviteStatus;
  /** Present with ALREADY_MEMBER: the group to open. */
  groupId?: string;
}

export interface CreatedInvite {
  code: string;
  expiresAt: string;
}

export interface InvitePreview {
  groupId: string;
  groupName: string;
  memberCount: number;
  placeholders: { id: string; displayName: string }[];
}

export interface Joined {
  groupId: string;
  memberId: string | null;
}

type Payload = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const statusOf = (p: Payload) => str(p.status) as InviteStatus;

/** All four RPCs answer { status, ... } rather than raising, so only transport errors land here. */
async function call(fn: string, args: Record<string, unknown>): Promise<Result<Payload, InviteFailure>> {
  try {
    const { data, error } = await getSupabase().rpc(fn, args);
    if (error) return err({ status: error.code ? 'SERVER' : 'OFFLINE' });
    if (!data || typeof data !== 'object') return err({ status: 'SERVER' });
    return ok(data as Payload);
  } catch {
    return err({ status: 'SERVER' });
  }
}

export async function createInvite(groupId: string): Promise<Result<CreatedInvite, InviteFailure>> {
  const r = await call('create_invite', { p_group_id: groupId });
  if (!r.ok) return err(r.error);
  if (statusOf(r.value) !== 'OK') return err({ status: statusOf(r.value) });
  return ok({ code: str(r.value.code), expiresAt: str(r.value.expires_at) });
}

export async function revokeAllInvites(groupId: string): Promise<Result<number, InviteFailure>> {
  const r = await call('revoke_all_invites', { p_group_id: groupId });
  if (!r.ok) return err(r.error);
  if (statusOf(r.value) !== 'OK') return err({ status: statusOf(r.value) });
  return ok(typeof r.value.revoked === 'number' ? r.value.revoked : 0);
}

export async function previewInvite(code: string): Promise<Result<InvitePreview, InviteFailure>> {
  const r = await call('preview_invite', { p_code: code });
  if (!r.ok) return err(r.error);
  const status = statusOf(r.value);
  if (status === 'ALREADY_MEMBER') return err({ status, groupId: str(r.value.group_id) });
  if (status !== 'OK') return err({ status });

  const raw = Array.isArray(r.value.placeholders) ? r.value.placeholders : [];
  return ok({
    groupId: str(r.value.group_id),
    groupName: str(r.value.group_name),
    memberCount: typeof r.value.member_count === 'number' ? r.value.member_count : 0,
    placeholders: raw
      .filter((p): p is Payload => typeof p === 'object' && p !== null)
      .map((p) => ({ id: str(p.id), displayName: str(p.display_name) })),
  });
}

/** JOINED and ALREADY_MEMBER both succeed: either way the group should open. */
export async function joinGroup(
  code: string,
  claimMemberId: string | null,
  displayName: string | null,
): Promise<Result<Joined, InviteFailure>> {
  const r = await call('join_group', {
    p_code: code,
    p_claim_member_id: claimMemberId,
    p_display_name: displayName,
  });
  if (!r.ok) return err(r.error);
  const status = statusOf(r.value);
  if (status !== 'JOINED' && status !== 'ALREADY_MEMBER') return err({ status });
  return ok({ groupId: str(r.value.group_id), memberId: str(r.value.member_id) || null });
}