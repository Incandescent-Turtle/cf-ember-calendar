// First-visit intro state (localStorage; private mode just shows it again).
import { useState } from 'react';

const KEY = 'ember-intro-seen-v1';

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode: show it again next time */
  }
}

export function useIntro() {
  const [open, setOpen] = useState(() => !seen());
  return { open, show: () => setOpen(true), hide: () => (markSeen(), setOpen(false)) };
}

