import { linkTo, useRoute } from './route';

/** Panel tabs: Calendar (/) and Rekindle (/rekindle). */
export function Tabs() {
  const route = useRoute();
  return (
    <nav className="tabs" aria-label="Panel">
      <a href="/" onClick={linkTo('app')} className={route === 'app' ? 'on' : ''} aria-current={route === 'app' ? 'page' : undefined}>
        📅 Fire calendar
      </a>
      <a href="/rekindle" onClick={linkTo('rekindle')} className={`tab-rk ${route === 'rekindle' ? 'on' : ''}`} aria-current={route === 'rekindle' ? 'page' : undefined}>
        🔥 Rekindle <span className="tab-note">simulate real fires</span>
      </a>
    </nav>
  );
}
