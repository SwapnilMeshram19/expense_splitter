import type { MemberUpiError } from '@/db/repositories/memberUpi';

export function describeMemberUpiError(error: MemberUpiError, memberName: string): string {
  switch (error.code) {
    case 'VPA_REQUIRED':
      return 'Enter a UPI ID.';
    case 'VPA_TOO_LONG':
      return `UPI IDs are at most ${error.max} characters.`;
    case 'VPA_INVALID':
      return 'That doesn’t look like a UPI ID. It should look like name@bank, e.g. rahul.k@okaxis.';
    case 'NOT_ALLOWED':
      return `Only ${memberName} can change their UPI ID.`;
    case 'NOT_A_MEMBER':
      return 'You’re not a member of this group.';
    case 'MEMBER_NOT_FOUND':
      return `${memberName} is no longer in this group.`;
  }
}