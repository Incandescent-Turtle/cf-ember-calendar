import { MapView } from './map/MapView';
import { CalendarPanel } from './panels/CalendarPanel';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Ember Calendar <span className="tag">harmonized MODIS + VIIRS hotspot activity, 2000 → today</span>
        </h1>
      </header>
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
    </div>
  );
}
