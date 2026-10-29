/**
 * Typed client for the server API, shared by the Android app and the web app (no React Native
 * imports). Writes go to the `api` Edge Function as commands; reads come from SQL functions.
 *
 *   run(commands)            POST /functions/v1/api           one result per command
 *   listGroups(known)        rpc list_groups                  snapshots of every group I'm in
 *   getGroup(id, rev)        rpc get_group                    one group, or UNCHANGED / FORBIDDEN
 *   listActivity(scope, …)   rpc list_activity                history, newest first, paged
 *
 * Everything below speaks the shared model (src/domain/model.ts); the wire format stays here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Command, CommandError } from '@/domain/commands';
import { activityFromWire, snapshotFromWire, type ActivityEntry, type GroupSnapshot, type WireGroupSnapshot } from '@/domain/model';
import type { WireActivity } from '@/domain/wire';

/** Why a call didn't get an answer from the server. */
export type ApiErrorCode = 'OFFLINE' | 'UNAUTHENTICATED' | 'BAD_REQUEST' | 'SERVER';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown): e is ApiError =>
  e instanceof ApiError || (e as { name?: string } | null)?.name === 'ApiError';

/** One command as sent: requestId makes a retry safe (the server answers it only once). */
export type CommandRequest =
  | (Command & { requestId: string })
  | { requestId: string; op: 'account.mergeAnonymous'; input: { anonymousAccessToken: string } };

/** Errors the server adds to the planner's own (store-time rules, transport problems). */
export type ServerCommandError =
  | { code: 'FORBIDDEN' | 'UNKNOWN_MEMBER' | 'MEMBER_HAS_BALANCE' | 'GROUP_HAS_BALANCES' | 'CURRENCY_MISMATCH' }
  | { code: 'INVALID'; detail?: string; table?: string }
  | { code: 'NOT_ANONYMOUS' | 'NO_TARGET' | 'IN_PROGRESS' | 'SERVER' };

export type CommandResult =
  | { requestId: string; ok: true; versions?: Record<string, number>; rev?: string; groupIds?: string[] }
  | { requestId: string; ok: false; error: CommandError | ServerCommandError };

export type GetGroupResult =
  | { status: 'OK'; snapshot: GroupSnapshot }
  | { status: 'UNCHANGED' }
  | { status: 'FORBIDDEN' };

export interface ListedGroup {
  id: string;
  rev: string;
  /** Present when the client's rev was missing or old. */
  snapshot?: GroupSnapshot;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  more: boolean;
}

export interface Api {
  run(commands: CommandRequest[], origin?: string): Promise<CommandResult[]>;
  listGroups(known: Record<string, string>): Promise<ListedGroup[]>;
  getGroup(groupId: string, knownRev?: string | null): Promise<GetGroupResult>;
  listActivity(groupId: string | null, before?: { createdAt: number; id: string } | null, limit?: number): Promise<ActivityPage>;
}

function functionError(error: unknown): ApiError {
  const e = error as { name?: string; context?: { status?: number } };
  if (e.name === 'FunctionsFetchError') return new ApiError('OFFLINE');
  const status = e.context?.status;
  if (status === 401) return new ApiError('UNAUTHENTICATED');
  if (status === 400 || status === 413) return new ApiError('BAD_REQUEST');
  return new ApiError('SERVER', `api failed: ${status ?? 'unknown'}`);
}

function rpcError(error: { code?: string; message?: string }): ApiError {
  if (!error.code) return new ApiError('OFFLINE'); // fetch failed before any HTTP response
  if (error.code === 'PGRST301' || error.code === 'PGRST303') return new ApiError('UNAUTHENTICATED');
  return new ApiError('SERVER', `rpc failed: ${error.code}`);
}

/** Read RPCs answer {status:'UNAUTHENTICATED'} when there is no session at all. */
function checkStatus(data: { status?: string } | null): void {
  if (!data) throw new ApiError('SERVER', 'empty response');
  if (data.status === 'UNAUTHENTICATED') throw new ApiError('UNAUTHENTICATED');
}

export function createApi(client: () => SupabaseClient): Api {
  return {
    async run(commands, origin) {
      const { data, error } = await client().functions.invoke<{ results: CommandResult[] }>('api', {
        body: { commands },
        headers: origin ? { 'X-Sync-Origin': origin } : undefined,
      });
      if (error) throw functionError(error);
      if (!data || !Array.isArray(data.results) || data.results.length !== commands.length) {
        throw new ApiError('SERVER', 'api returned no results');
      }
      return data.results;
    },

    async listGroups(known) {
      const { data, error } = await client().rpc('list_groups', { p_known: known });
      if (error) throw rpcError(error);
      const res = data as { status?: string; groups?: { id: string; rev: string; snapshot?: WireGroupSnapshot }[] } | null;
      checkStatus(res);
      return (res!.groups ?? []).map((g) => ({
        id: g.id.toLowerCase(),
        rev: String(g.rev),
        ...(g.snapshot ? { snapshot: snapshotFromWire(g.snapshot) } : {}),
      }));
    },

    async getGroup(groupId, knownRev) {
      const { data, error } = await client().rpc('get_group', { p_group_id: groupId, p_known_rev: knownRev ?? null });
      if (error) throw rpcError(error);
      const res = data as { status?: string; snapshot?: WireGroupSnapshot } | null;
      checkStatus(res);
      if (res!.status === 'OK' && res!.snapshot) return { status: 'OK', snapshot: snapshotFromWire(res!.snapshot) };
      if (res!.status === 'UNCHANGED') return { status: 'UNCHANGED' };
      return { status: 'FORBIDDEN' };
    },

    async listActivity(groupId, before, limit = 50) {
      const { data, error } = await client().rpc('list_activity', {
        p_group_id: groupId,
        p_before: before?.createdAt ?? null,
        p_before_id: before?.id ?? null,
        p_limit: limit,
      });
      if (error) throw rpcError(error);
      const res = data as { status?: string; activity?: WireActivity[]; more?: boolean } | null;
      checkStatus(res);
      if (res!.status === 'FORBIDDEN') return { entries: [], more: false };
      return { entries: (res!.activity ?? []).map(activityFromWire), more: res!.more === true };
    },
  };
}
