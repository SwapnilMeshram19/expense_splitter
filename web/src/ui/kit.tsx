/**
 * Small building blocks for the web screens. Plain elements + CSS classes (styles.css): no UI
 * library, so the first load stays small on mobile data.
 */
import type { ReactNode } from 'react';

import { initialsOf } from '@/ui/avatarColors';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      {label ? <p className="muted">{label}</p> : <span className="visually-hidden">Loading</span>}
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

export function Card({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return <section className={flush ? 'card flush' : 'card'}>{children}</section>;
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

/** Tiny inline icons (no icon font download). */
export function Icon({
  name,
  size = 20,
}: {
  name: 'back' | 'refresh' | 'person' | 'plus' | 'cloud';
  size?: number;
}) {
  const paths: Record<typeof name, string> = {
    back: 'M15 18l-6-6 6-6',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
    person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
    plus: 'M12 5v14M5 12h14',
    cloud: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z',
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
