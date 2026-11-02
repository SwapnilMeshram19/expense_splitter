import type { Command } from '@/domain/commands';
import { formatMoney } from '@/domain/currency';
import type { GroupSnapshot } from '@/domain/model';
import type { DataStatus, PendingOp } from '@/data/store';
import { formatIsoDate } from '@/lib/dates';

import { describeCommonFailure } from './messages';

/** What a waiting or refused change was, in a few words. `group` names home services. */
export function pendingTitle(cmd: Command, currency: string, group?: GroupSnapshot | null): string {
  switch (cmd.op) {
    case 'household.mark': {
      const service = group?.householdServices.find((h) => h.id === cmd.input.serviceId.toLowerCase());
      return `${service?.name ?? 'Home service'} on ${formatIsoDate(cmd.input.date)}`;
    }
    case 'expense.add':
    case 'expense.update':
      return `Expense “${cmd.input.description.trim()}”`;
    case 'settlement.add':
      return `Payment of ${formatMoney(cmd.input.amountPaise, currency)}`;
    case 'group.create':
      return `Group “${cmd.input.name.trim()}”`;
    default:
      return 'A change';
  }
}

/** Why it isn't on the server. */
export function pendingReason(op: PendingOp): string {
  if (op.status === 'queued') return 'Waiting for internet. Sends on its own.';
  if (op.status === 'sending') return 'Sending…';
  if (op.error?.code === 'MARK_CONFLICT') {
    const current = (op.error as { current?: number | null }).current;
    const what = current === null || current === undefined ? 'back to usual' : current === 0 ? 'as absent' : 'with another amount';
    return `Someone else marked this day ${what}. Try again keeps yours, Discard keeps theirs.`;
  }
  return op.error ? (describeCommonFailure(op.error) ?? 'The server didn’t accept it.') : 'The server didn’t accept it.';
}

export interface DataStatusView {
  icon: 'cloudUpload' | 'syncProblem' | 'cloudOff';
  tone: 'muted' | 'warning';
  label: string;
}

/** The header icon: only when something needs the person (refused, or waiting on a dead network). */
export function describeDataStatus(status: DataStatus): DataStatusView | null {
  if (status.failed > 0) {
    return {
      icon: 'syncProblem',
      tone: 'warning',
      label: status.failed === 1 ? '1 change wasn’t saved' : `${status.failed} changes weren’t saved`,
    };
  }
  if (status.queued > 0) {
    return {
      icon: 'cloudUpload',
      tone: 'muted',
      label: status.queued === 1 ? '1 change waiting to send' : `${status.queued} changes waiting to send`,
    };
  }
  return null;
}
