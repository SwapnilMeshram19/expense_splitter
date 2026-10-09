/**
 * Display profile from the identity provider's user metadata. Google puts the name in
 * full_name/name and the photo in avatar_url/picture; email sign-in has neither.
 * Values are display-only and never trusted for anything else.
 */
export function profileFromMetadata(metadata: unknown): { displayName: string | null; avatarUrl: string | null } {
  const record = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  const pick = (maxLength: number, ...keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, maxLength);
    }
    return null;
  };
  // A URL is never truncated (that would make it point elsewhere): too long means none.
  const url = pick(4096, 'avatar_url', 'picture');
  return { displayName: pick(80, 'full_name', 'name'), avatarUrl: url && url.length <= 2048 ? url : null };
}
