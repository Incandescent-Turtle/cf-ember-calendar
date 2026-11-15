// Three pages, no router library: "/" (the app), "/rekindle" and "/methodology". Pages serves index.html for any path.
import { useSyncExternalStore } from 'react';

export type Route = 'app' | 'rekindle' | 'methodology';

const PATHS: Record<Route, string> = { app: '/', rekindle: '/rekindle', methodology: '/methodology' };

const current = (): Route => {
  const p = location.pathname.replace(/\/+$/, '');
  if (p.endsWith('/methodology')) return 'methodology';
  if (p.endsWith('/rekindle')) return 'rekindle';
  return 'app';
};
const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(to: Route): void {
  const path = PATHS[to];
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
