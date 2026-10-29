/**
 * Small per-browser settings in localStorage (the app keeps these in its local profile table).
 * Every access is guarded: storage can be blocked or full, and the page must work without it.
 */
const SELF_NAME = 'es-self-name';
const KEYS = [SELF_NAME];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not saved: only a convenience
  }
}

/** The name you use in groups (pre-filled when creating or joining one). */
export const getSelfName = (): string => read(SELF_NAME) ?? '';
export const setSelfName = (name: string): void => write(SELF_NAME, name.trim() || null);

export function clearLocalPrefs(): void {
  KEYS.forEach((k) => write(k, null));
}
