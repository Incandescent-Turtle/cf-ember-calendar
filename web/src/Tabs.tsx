import { linkTo, useRoute } from './route';

/** Panel tabs: Calendar (/) and Rekindle (/rekindle). */
export function Tabs() {
  const route = useRoute();
  return (
    <nav className="tabs" aria-label="Panel">
      <a href="/" onClick={linkTo('app')} className={route === 'app' ? 'on' : ''} aria-current={route === 'app' ? 'page' : undefined}>
        Calendar
      </a>
      <a href="/rekindle" onClick={linkTo('rekindle')} className={route === 'rekindle' ? 'on' : ''} aria-current={route === 'rekindle' ? 'page' : undefined}>
        Rekindle <span className="tab-note">fire-spread hindcast</span>
      </a>
    </nav>
  );
}
