import { apiFetch } from '../api/client.js';

// Notifiche push: iscrizione per dispositivo. Le preferenze (giornaliera/settimanale) stanno sul server.

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64u) {
  const t = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function registration() {
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('Service worker non pronto: riapri l’app')), 8000))]);
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

function deviceName() {
  const ua = navigator.userAgent;
  const kind = /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Telefono Android' : 'Tablet Android') : /Windows/.test(ua) ? 'PC Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : 'Dispositivo';
  return `${kind} · ${new Date().toLocaleDateString('it-IT')}`;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Notifiche non supportate da questo browser');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permesso notifiche negato: abilitalo dalle impostazioni del browser/app');
  const reg = await registration();
  const { publicKey } = await apiFetch('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  const same = sub && sub.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === publicKey;
  if (sub && !same) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ ...sub.toJSON(), device: deviceName() }) });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await apiFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe();
}

export async function pushStatus() {
  const sub = await currentSubscription();
  const res = await apiFetch('/api/push/status', { method: 'POST', body: JSON.stringify({ endpoint: sub?.endpoint }) });
  // iscritto nel browser ma non sul server (es. DB ripristinato): re-iscrivi in silenzio
  if (sub && !res.subscribed && Notification.permission === 'granted') {
    await apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ ...sub.toJSON(), device: deviceName() }) });
    return { ...res, subscribed: true, prefs: { daily: true, weekly: true } };
  }
  return { ...res, subscribed: !!sub && res.subscribed };
}

export async function setPushPrefs(prefs) {
  const sub = await currentSubscription();
  if (sub) await apiFetch('/api/push/prefs', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, prefs }) });
}

export async function testPush(kind = 'test') {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Notifiche non attive su questo dispositivo');
  return apiFetch('/api/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, kind }) });
}
