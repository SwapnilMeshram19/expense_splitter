import type { Command } from '@/domain/commands';
import { formatMoney } from '@/domain/currency';
import type { DataStatus, PendingOp } from '@/data/store';

import { describeCommonFailure } from './messages';

/** What a waiting or refused change was, in a few words. */
export function pendingTitle(cmd: Command, currency: string): string {
  switch (cmd.op) {
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
