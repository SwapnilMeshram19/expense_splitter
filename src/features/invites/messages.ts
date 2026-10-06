/** Invite codes: 8 characters from an alphabet without 0/O, 1/I/L, U. Shown as ABCD-EFGH. */
const CODE_RE = /^[2-9A-HJKMNP-TV-Z]{8}$/;

export const INVITE_BASE_URL = 'https://split.ssoftapp.in/join/';

export const normalizeInviteCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const isWellFormedInviteCode = (code: string): boolean => CODE_RE.test(code);

export const formatInviteCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

export const inviteUrl = (code: string): string => `${INVITE_BASE_URL}?code=${formatInviteCode(code)}`;

const wellFormed = (candidate: string | undefined): string | null => {
  if (!candidate) return null;
  const code = normalizeInviteCode(candidate);
  return isWellFormedInviteCode(code) ? code : null;
};

/**
 * Pulls a code out of whatever was pasted: the whole WhatsApp message, the link, or the code.
 * Never scans free text for 8-letter words ("EXPENSES" would look like a valid code).
 */
export function extractInviteCode(text: string): string | null {
  const fromLink = /[?&]code=([A-Za-z0-9-]+)/.exec(text);
  if (fromLink) return wellFormed(fromLink[1]);

  const dashed = /\b([A-Za-z0-9]{4})-([A-Za-z0-9]{4})\b/.exec(text);
  if (dashed) {
    const code = wellFormed(`${dashed[1]}${dashed[2]}`);
    if (code) return code;
  }

  return wellFormed(text.trim());
}

export function buildShareMessage(groupName: string, code: string): string {
  return (
    `Join “${groupName}” on Expense Splitter to split expenses with me:\n` +
    `${inviteUrl(code)}\n\n` +
    `Or open the app and enter code ${formatInviteCode(code)}. It expires in 7 days.`
  );
}

export type InviteStatus =
  | 'OK'
  | 'JOINED'
  | 'ALREADY_MEMBER'
  | 'INVALID'
  | 'EXPIRED'
  | 'USED_UP'
  | 'REVOKED'
  | 'RATE_LIMITED'
  | 'ALREADY_CLAIMED'
  | 'UNKNOWN_MEMBER'
  | 'GROUP_FULL'
  | 'FORBIDDEN'
  | 'TOO_MANY_INVITES'
  | 'UNAUTHENTICATED'
  | 'OFFLINE'
  | 'SERVER';

export function describeInviteStatus(status: InviteStatus): string {
  switch (status) {
    case 'INVALID':
      return 'That code doesn’t work. Check it and try again.';
    case 'EXPIRED':
      return 'This invite has expired. Ask for a new one.';
    case 'USED_UP':
      return 'This invite has been used too many times. Ask for a new one.';
    case 'REVOKED':
      return 'This invite was cancelled. Ask for a new one.';
    case 'RATE_LIMITED':
      return 'Too many wrong codes. Wait 10 minutes, then try again.';
    case 'ALREADY_CLAIMED':
      return 'Someone just picked that name. Choose another, or join as new.';
    case 'UNKNOWN_MEMBER':
      return 'That person isn’t in the group any more. Please choose again.';
    case 'GROUP_FULL':
      return 'This group is full (50 people).';
    case 'FORBIDDEN':
      return 'Only members of this group can invite people.';
    case 'TOO_MANY_INVITES':
      return 'This group has too many active invite links. Stop the old links first.';
    case 'UNAUTHENTICATED':
      return 'Please sign in first.';
    case 'OFFLINE':
      return 'No internet connection. Try again when you’re online.';
    default:
      return 'Something went wrong. Please try again.';
  }
}