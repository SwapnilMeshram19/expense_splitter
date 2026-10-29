import { useEffect } from 'react';

import { refreshIfStale } from '../platform/data';

/** A screen opened: fetch if the last fetch is old (cheap when nothing changed), start at the top. */
export function useScreenOpen(title: string): void {
  useEffect(() => {
    refreshIfStale();
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    document.title = title ? `${title} · Expense Splitter` : 'Expense Splitter';
  }, [title]);
}
