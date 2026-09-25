import { useSyncExternalStore, useCallback } from 'react';

// Default = scuro. La scelta resta salvata sul dispositivo.
// Stato condiviso: tutti i toggle (sidebar, topbar, impostazioni) restano allineati.
const listeners = new Set();
const isDarkNow = () => document.documentElement.classList.contains('dark');

function setDark(dark) {
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  } catch {
    /* storage non disponibile */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#14110f' : '#fbf7ee');
  listeners.forEach((l) => l());
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme() {
  const isDark = useSyncExternalStore(subscribe, isDarkNow);
  const toggle = useCallback(() => setDark(!isDarkNow()), []);
  return { isDark, toggle, theme: isDark ? 'dark' : 'light' };
}
