// Two pages, no router library: "/" (the app) and "/methodology". Pages serves index.html for any path.
import { useSyncExternalStore } from 'react';

export type Route = 'app' | 'methodology';

const current = (): Route => (location.pathname.replace(/\/+$/, '').endsWith('/methodology') ? 'methodology' : 'app');
const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(to: Route): void {
  const path = to === 'methodology' ? '/methodology' : '/';
  if (location.pathname !== path) history.pushState(null, '', path);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export const useRoute = (): Route =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
  );

/** onClick for <a href> links: client-side navigation, keeping cmd/ctrl-click working. */
export const linkTo = (to: Route) => (e: { preventDefault: () => void; metaKey: boolean; ctrlKey: boolean; button: number }) => {
  if (e.metaKey || e.ctrlKey || e.button !== 0) return;
  e.preventDefault();
  navigate(to);
};
