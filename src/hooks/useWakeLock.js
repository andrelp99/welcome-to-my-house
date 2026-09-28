import { useEffect, useState } from 'react';

// Schermo sempre acceso finche' active e la pagina e' visibile (modalita' cucina e spesa).
export function useWakeLock(active = true) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) return setOn(false);
    let lock = null;
    let dead = false;
    async function req() {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen');
          setOn(true);
          lock.addEventListener('release', () => !dead && setOn(false));
        }
      } catch {
        setOn(false);
      }
    }
    req();
    const onVis = () => document.visibilityState === 'visible' && req();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      dead = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
      setOn(false);
    };
  }, [active]);
  return on;
}
