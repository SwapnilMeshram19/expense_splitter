export interface PickerMember {
  id: string;
  name: string;
}

/** Up to this many people, a row of chips: everyone visible, one tap. Beyond it, a picker. */
export const CHIP_LIMIT = 4;
/** The picker gets a search box once the list no longer fits on one screen. */
export const SEARCH_THRESHOLD = 8;

/** Case- and space-insensitive "contains" match on the name. */
export function filterMembers<T extends PickerMember>(members: readonly T[], query: string): T[] {
  const q = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
  if (!q) return [...members];
  return members.filter((m) => m.name.replace(/\s+/g, ' ').toLocaleLowerCase('en-IN').includes(q));
}
