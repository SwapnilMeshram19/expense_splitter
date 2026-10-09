import { getSupabase } from '@/lib/supabase';

import type { SyncTransport } from './runSync';
import type { PullResult, PushResult } from './wire';

export type SyncErrorCode = 'OFFLINE' | 'UNAUTHENTICATED' | 'BATCH_REFUSED' | 'SERVER';

/** Rows per pull page: ~100–150 KB of JSON, fine on a slow mobile connection. */
export const PULL_PAGE_SIZE = 300;

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

function functionErrorCode(error: unknown): SyncErrorCode {
  const e = error as { name?: string; context?: { status?: number } };
  if (e.name === 'FunctionsFetchError') return 'OFFLINE';
  const status = e.context?.status;
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 400 || status === 413) return 'BATCH_REFUSED';
  return 'SERVER';
}

function rpcErrorCode(error: { code?: string }): SyncErrorCode {
  if (!error.code) return 'OFFLINE'; // fetch failed before any HTTP response
  if (error.code === 'PGRST301' || error.code === 'PGRST303') return 'UNAUTHENTICATED'; // JWT invalid/expired
  return 'SERVER';
}

export const supabaseTransport: SyncTransport = {
  async push(batch) {
    // invoke() attaches the signed-in user's access token automatically.
    const { data, error } = await getSupabase().functions.invoke<PushResult>('sync-push', { body: batch });
    if (error) {
      const code = functionErrorCode(error);
      throw new SyncError(code, `push failed: ${code}`);
    }
    if (!data) throw new SyncError('SERVER', 'push returned no data');
    return data;
  },

  async pull(cursor, fullGroupIds) {
    const { data, error } = await getSupabase().rpc('pull_page', {
      p_cursor: cursor,
      p_full_group_ids: fullGroupIds,
      p_limit: PULL_PAGE_SIZE,
    });
    if (error) {
      const code = rpcErrorCode(error);
      throw new SyncError(code, `pull failed: ${code}`);
    }
    return data as PullResult;
  },
};