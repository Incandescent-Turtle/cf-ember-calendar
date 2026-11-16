// First-visit introduction (remembered per browser; "About" in the top bar reopens it).
import { useEffect } from 'react';
import { navigate } from './route';

export function Intro({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="intro-backdrop" onClick={onClose}>
      <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-title" onClick={(e) => e.stopPropagation()}>
        <button className="intro-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2 id="intro-title">Ember Calendar</h2>
        <p className="intro-lede">
          25 years of NASA satellite fire detections (MODIS and VIIRS) combined into one consistent record, so you can see when and where fire is unusual, anywhere on Earth.
        </p>
        <div className="intro-cards">
          <section>
            <h3>📅 Fire calendar</h3>
            <p>Pick an example, search a place or draw an area. See which months and years burn most, and which months were far above normal.</p>
            <button className="primary" onClick={onClose}>
              Explore the calendar
            </button>
          </section>
          <section>
            <h3>🔥 Rekindle</h3>
            <p>Replay real fires with a physics model. Change the wind or the fuel dryness, press Simulate, and watch how the fire would have spread.</p>
            <button
              className="primary rk-cta"
              onClick={() => {
                onClose();
                navigate('rekindle');
              }}
            >
              Try Rekindle
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
