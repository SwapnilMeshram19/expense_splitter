export const MAX_NAME_LENGTH = 50;

export type NameError =
  | { code: 'NAME_REQUIRED' }
  | { code: 'NAME_TOO_LONG'; max: number }
  | { code: 'DUPLICATE_NAME'; name: string };

/** Trim and collapse internal whitespace: "  Rahul   K " -> "Rahul K". */
export const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** Validate one already-normalized name. */
export function validateName(name: string): NameError | null {
  if (name === '') return { code: 'NAME_REQUIRED' };
  if (name.length > MAX_NAME_LENGTH) return { code: 'NAME_TOO_LONG', max: MAX_NAME_LENGTH };
  return null;
}

/** First name that appears twice, compared case-insensitively ("Rahul" vs "rahul"). */
export function findDuplicateName(names: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) return name;
    seen.add(key);
  }
  return null;
}