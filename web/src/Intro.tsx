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
            <h3>🔥 Rekindle: replay a real fire</h3>
            <p>Rewind a real wildfire and watch it spread again across the actual terrain, driven by fire physics and the weather it really had. Then turn up the wind or dry out the fuels, press Simulate, and see how much further it could have run.</p>
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
