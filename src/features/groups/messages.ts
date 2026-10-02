import type { GroupDeleteError, GroupError, GroupUpdateError } from '@/db/repositories/groups';
import type { MemberError } from '@/db/repositories/members';
import type { NameError } from '@/db/repositories/names';
import { formatPaise } from '@/domain/money';

export function describeNameError(error: NameError, subject: string): string {
  switch (error.code) {
    case 'NAME_REQUIRED':
      return `${subject} is required.`;
    case 'NAME_TOO_LONG':
      return `${subject} can be at most ${error.max} characters.`;
    case 'DUPLICATE_NAME':
      return `"${error.name}" is already in this group. Use a different name.`;
  }
}

export function describeGroupError(error: GroupError): string {
  return describeNameError(error.error, error.target === 'group' ? 'Group name' : 'Each name');
}

export function describeGroupUpdateError(error: GroupUpdateError): string {
  switch (error.code) {
    case 'NAME_REQUIRED':
    case 'NAME_TOO_LONG':
    case 'DUPLICATE_NAME':
      return describeNameError(error, 'Group name');
    case 'GROUP_NOT_FOUND':
      return 'This group no longer exists.';
    case 'NOT_A_MEMBER':
      return 'You’re not a member of this group.';
  }
}

export function describeGroupDeleteError(error: GroupDeleteError): string {
  switch (error.code) {
    case 'GROUP_NOT_FOUND':
      return 'This group no longer exists.';
    case 'NOT_A_MEMBER':
      return 'You can only delete groups you’re a member of.';
    case 'UNSETTLED_BALANCES':
      return `${error.count} people still have balances. Record the payments first so everyone is settled up.`;
  }
}

export function describeMemberError(error: MemberError): string {
  switch (error.code) {
    case 'NAME_REQUIRED':
    case 'NAME_TOO_LONG':
    case 'DUPLICATE_NAME':
      return describeNameError(error, 'Name');
    case 'GROUP_NOT_FOUND':
      return 'This group no longer exists.';
    case 'MEMBER_NOT_FOUND':
      return 'This person is no longer in the group.';
    case 'NOT_A_MEMBER':
      return 'You’re not a member of this group.';
    case 'CANNOT_REMOVE_SELF':
      return 'You can’t remove yourself.';
    case 'MEMBER_HAS_BALANCE':
      return error.balancePaise < 0
        ? `They still owe ${formatPaise(-error.balancePaise)}. Settle up first.`
        : `They are still owed ${formatPaise(error.balancePaise)}. Settle up first.`;
  }
}