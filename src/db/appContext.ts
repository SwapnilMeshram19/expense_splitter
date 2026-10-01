import { newId } from '@/lib/newId';

import { db } from './client';
import type { RepoContext } from './context';

export const appContext: RepoContext = { db, newId, now: Date.now };