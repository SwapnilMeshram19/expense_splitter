/**
 * Text for the problems any save can run into (as opposed to a form's own validation errors,
 * which each feature's messages.ts explains). Returns null for codes it doesn't know, so callers
 * can fall back to their own text.
 */
export function describeCommonFailure(error: { code: string }): string | null {
  switch (error.code) {
    case 'OFFLINE':
      return 'You’re offline. Connect to the internet and try again.';
    case 'STALE':
      return 'Someone else changed this a moment ago. It’s been updated: check it and try again.';
    case 'NOT_FOUND':
      return 'This no longer exists, or you’re no longer in this group.';
    case 'NOT_A_MEMBER':
    case 'FORBIDDEN':
      return 'You’re not a member of this group any more.';
    case 'UNAUTHENTICATED':
      return 'Your session ended. Reopen the app and try again.';
    case 'ID_TAKEN':
      return 'This was already saved.';
    case 'CURRENCY_MISMATCH':
      return 'The group’s currency changed meanwhile. Reopen the group and try again.';
    case 'MEMBER_HAS_BALANCE':
      return 'They still have a balance. Settle up first.';
    case 'GROUP_HAS_BALANCES':
      return 'Some people still have balances. Settle up first.';
    case 'UNKNOWN_MEMBER':
      return 'Someone in this change has left the group.';
    case 'BAD_REQUEST':
    case 'INVALID_INPUT':
    case 'INVALID':
      return 'This version of the app couldn’t save that. Please update the app.';
    case 'SERVER':
    case 'IN_PROGRESS':
      return 'Couldn’t save right now. Please try again in a moment.';
    default:
      return null;
  }
}

/** A failure's text, with the feature's own explanation first. */
export function describeFailure<E extends { code: string }>(error: E, own: (e: E) => string | null | undefined): string {
  return own(error) ?? describeCommonFailure(error) ?? 'Couldn’t save that. Please try again.';
}
