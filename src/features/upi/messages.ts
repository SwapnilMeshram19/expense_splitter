import type { VpaError } from '@/domain/upi';

/** UPI ID problems; null for anything else (callers fall back to the common messages). */
export function describeMemberUpiError(error: VpaError | { code: string }, memberName: string): string | null {
  const e = error as VpaError | { code: 'NOT_ALLOWED' } | { code: 'NOT_FOUND' };
  switch (e.code) {
    case 'VPA_REQUIRED':
      return 'Enter a UPI ID.';
    case 'VPA_TOO_LONG':
      return `UPI IDs are at most ${e.max} characters.`;
    case 'VPA_INVALID':
      return 'That doesn’t look like a UPI ID. It should look like name@bank, e.g. rahul.k@okaxis.';
    case 'NOT_ALLOWED':
      return `Only ${memberName} can change their UPI ID.`;
    case 'NOT_FOUND':
      return `${memberName} is no longer in this group.`;
    default:
      return null;
  }
}
