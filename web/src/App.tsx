import { MapView } from './map/MapView';
import { CalendarPanel } from './panels/CalendarPanel';
import { Tabs } from './Tabs';
import { linkTo, useRoute } from './route';
import { lazy, Suspense } from 'react';

// Methodology and Rekindle load on demand (bundle split, S7).
const Methodology = lazy(() => import('./methodology/Methodology').then((m) => ({ default: m.Methodology })));
const RekindleView = lazy(() => import('./rekindle/RekindleView').then((m) => ({ default: m.RekindleView })));

export default function App() {
  const route = useRoute();
  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <a href="/" onClick={linkTo('app')} className="home">
            Ember Calendar
          </a>{' '}
          <span className="tag">harmonized MODIS + VIIRS hotspot activity, 2000 → today</span>
        </h1>
        <nav className="topnav">
          <a href="/methodology" onClick={linkTo('methodology')} aria-current={route === 'methodology' ? 'page' : undefined}>
            Methodology
          </a>
        </nav>
      </header>
      {route === 'methodology' ? (
        <Suspense fallback={<p className="loading">Loading…</p>}>
          <Methodology />
        </Suspense>
      ) : route === 'rekindle' ? (
        <Suspense fallback={<p className="loading">Loading…</p>}>
          <RekindleView />
        </Suspense>
      ) : (
        <main className="main">
          <MapView />
          <aside className="panel">
            <Tabs />
            <CalendarPanel />
          </aside>
        </main>
      )}
    </div>
  );
}
