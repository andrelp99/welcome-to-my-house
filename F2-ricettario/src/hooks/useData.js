import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadAll } from '../db/logic.js';
import { loadRecipes } from '../db/recipes.js';
import { getSyncState, subscribeSync } from '../db/sync.js';

export function useData() {
  return useLiveQuery(loadAll, []);
}

export function useSyncState() {
  const [s, setS] = useState(getSyncState());
  useEffect(() => subscribeSync(setS), []);
  return s;
}

// Toast "annulla" minimale condiviso.
let toastListener = null;
export function showToast(msg, action) {
  toastListener?.({ msg, action, id: Date.now() });
}
export function useToast() {
  const [t, setT] = useState(null);
  useEffect(() => {
    toastListener = setT;
    return () => (toastListener = null);
  }, []);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), 5000);
    return () => clearTimeout(h);
  }, [t]);
  return [t, () => setT(null)];
}

// Ricettario: ricette + ingredienti + passaggi + sostituti (live).
export function useRecipes() {
  return useLiveQuery(loadRecipes, []);
}
