/**
 * Small building blocks for the web screens. Plain elements + CSS classes (styles.css): no UI
 * library, so the first load stays small on mobile data.
 */
import type { ReactNode } from 'react';

import type { ExpenseCategory } from '@/domain/model';
import { initialsOf } from '@/ui/avatarColors';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      {label ? <p className="muted">{label}</p> : <span className="visually-hidden">Loading</span>}
    </div>
  );
}

const SWATCH_COUNT = 8;

/** Same hash as the app's avatarColors(): a member gets the same colour on the phone and here. */
function swatchIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % SWATCH_COUNT;
}

/** Initials on a stable colour. `seed` is the member or group id (falls back to the name). */
export function Avatar({
  name,
  seed,
  size = 'md',
}: {
  name: string;
  seed?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`avatar sw-${swatchIndex(seed ?? name)} avatar-${size}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

/** Overlapping avatars for a group's members (first few, then "+n"). */
export function AvatarStack({
  people,
  max = 4,
}: {
  people: { id: string; name: string }[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack" aria-hidden="true">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} seed={p.id} size="sm" />
      ))}
      {extra > 0 ? <span className="avatar avatar-sm avatar-more">+{extra}</span> : null}
    </span>
  );
}

// Category icon and colour, matching the app's CategoryTile (src/ui/CategoryTile.tsx).
const CATEGORY_SWATCH: Record<ExpenseCategory, number> = {
  general: 4,
  food: 6,
  groceries: 7,
  travel: 3,
  transport: 0,
  stay: 5,
  shopping: 1,
  utilities: 2,
  entertainment: 6,
  other: 4,
};

const CATEGORY_PATH: Record<ExpenseCategory, string> = {
  general: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  food: 'M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M16 21V3c2 1 3 3 3 6s-1 4-3 4',
  groceries: 'M3 4h2l2.4 11h10.2L20 7H6.2M9.5 20h.01M17 20h.01',
  travel: 'M7 7h10v13H7zM10 7V4h4v3M10 11v5M14 11v5',
  transport: 'M5 15l1.6-5.5A2 2 0 0 1 8.5 8h7a2 2 0 0 1 1.9 1.5L19 15M4 15h16v3H4zM7 18v2M17 18v2',
  stay: 'M3 19V7M3 14h18v5M21 14v-1a3 3 0 0 0-3-3h-7v4M7 11.5h.01',
  shopping: 'M5 8h14l-1.2 12H6.2zM9 8V7a3 3 0 0 1 6 0v1',
  utilities: 'M13 3L5 14h6l-1 7 8-11h-6z',
  entertainment: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10',
  other: 'M6 12h.01M12 12h.01M18 12h.01',
};

export function CategoryTile({ category }: { category: string }) {
  const key = (category in CATEGORY_PATH ? category : 'other') as ExpenseCategory;
  return (
    <span className={`tile sw-${CATEGORY_SWATCH[key]}`} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={CATEGORY_PATH[key]} />
      </svg>
    </span>
  );
}

export function Card({
  children,
  flush = false,
  className = '',
}: {
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`card${flush ? ' flush' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </section>
  );
}

/** Card heading row: title and an optional action on the right. */
export function CardHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string | null;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="error-text" role="alert">
      {children}
    </p>
  );
}

export function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="center">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export type IconName =
  | 'back'
  | 'refresh'
  | 'person'
  | 'plus'
  | 'cloud'
  | 'swap'
  | 'share'
  | 'warning'
  | 'check'
  | 'globe'
  | 'pie';

/** Tiny inline icons (no icon font download). */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    back: 'M15 18l-6-6 6-6',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
    plus: 'M12 5v14M5 12h14',
    cloud: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z',
    swap: 'M7 7h13l-4-4M17 17H4l4 4',
    share: 'M12 3v12M7 8l5-5 5 5M5 14v5h14v-5',
    warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
    check: 'M5 12l5 5 9-10',
    globe:
      'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9M12 3c-2.5 2.5-3.5 5.5-3.5 9s1 6.5 3.5 9',
    pie: 'M12 3v9h9A9 9 0 1 1 12 3zM15 3.5A9 9 0 0 1 20.5 9H15z',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
