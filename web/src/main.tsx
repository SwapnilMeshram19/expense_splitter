import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { startAuth } from './platform/auth';
import { startData } from './platform/data';
import { applyRegion } from './platform/region';
import './styles.css';

async function boot(): Promise<void> {
  applyRegion();
  // The cache opens first (a few ms), so the first render already shows the last known groups.
  await startData();
  startAuth();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
