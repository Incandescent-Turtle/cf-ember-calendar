// Shared Rekindle controls: the big play/time bar (panel) and the map legend overlay.
import { rampCss } from './data';

export function TimeBar({
  t, setT, hours, playing, setPlaying, clock, label,
}: { t: number; setT: (h: number) => void; hours: number; playing: boolean; setPlaying: (b: boolean) => void; clock: string; label: string }) {
  const toggle = () => (t >= hours ? (setT(0), setPlaying(true)) : setPlaying(!playing));
  return (
    <div className="rk-timebar">
      <button className="rk-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Simulate the spread'}>
        <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        <span className="rk-play-text">{playing ? 'Pause' : t >= hours ? 'Simulate' : 'Continue'}</span>
      </button>
      <div className="rk-timebar-track">
        <div className="rk-clock-big">
          {clock} <span className="meta">(+{t} h)</span>
        </div>
        <input type="range" min={0} max={hours} step={1} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} aria-label={label} />
      </div>
    </div>
  );
}

export function RkLegend({
  hours, from, isoStepH, showIgnitions, showBase, burnAvailable, showBurn, setShowBurn,
}: {
  hours: number;
  from: string;
  isoStepH: number;
  showIgnitions: boolean;
  showBase: boolean;
  burnAvailable: boolean;
  showBurn: boolean;
  setShowBurn: (b: boolean) => void;
}) {
  return (
    <div className="time-control rk-legend-map" aria-label="Map legend">
      <div className="tc-label">Simulated fire arrival</div>
      <div className="tc-ramp" style={{ background: rampCss() }} />
      <div className="tc-ticks">
        <span>0 h</span>
        <span>{Math.round(hours / 2)} h</span>
        <span>{hours} h after {from}</span>
      </div>
      <ul className="rk-key">
        <li>
          <i className="rk-sym iso" /> simulated fire edge every {isoStepH} h
        </li>
        <li>
          <i className="rk-sym dot" /> satellite hotspot (up to the clock time)
        </li>
        {showIgnitions && (
          <li>
            <i className="rk-sym ign" /> ignition: first satellite detection
          </li>
        )}
        {showBase && (
          <li>
            <i className="rk-sym base" /> edge without the what-if change
          </li>
        )}
        {burnAvailable && showBurn && (
          <li>
            <i className="rk-sym burn" /> MODIS burned area by burn day
          </li>
        )}
      </ul>
      {burnAvailable && (
        <label className="tc-points">
          <input type="checkbox" checked={showBurn} onChange={(e) => setShowBurn(e.target.checked)} /> MODIS burned area (MCD64A1)
        </label>
      )}
    </div>
  );
}
