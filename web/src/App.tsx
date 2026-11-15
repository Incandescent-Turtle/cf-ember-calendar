import { MapView } from './map/MapView';
import { CalendarPanel } from './panels/CalendarPanel';
import { Methodology } from './methodology/Methodology';
import { linkTo, useRoute } from './route';

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
        <Methodology />
      ) : (
        <main className="main">
          <MapView />
          <aside className="panel">
            <nav className="tabs" role="tablist">
              <button role="tab" aria-selected="true" className="on">
                Calendar
              </button>
            </nav>
            <CalendarPanel />
          </aside>
        </main>
      )}
    </div>
  );
}
