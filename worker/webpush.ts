// Web Push senza librerie: VAPID (ES256) + cifratura payload aes128gcm (RFC 8291 / RFC 8188).
// Chiavi VAPID generate al primo uso e salvate in D1 (server_kv): zero configurazione manuale.

const enc = new TextEncoder();

export const b64u = {
  enc(buf: ArrayBuffer | Uint8Array): string {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(s: string): Uint8Array {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export type Vapid = { publicKey: string; privateJwk: JsonWebKey };

export async function getVapid(db: D1Database): Promise<Vapid> {
  const row = await db.prepare("SELECT v FROM server_kv WHERE k = 'vapid'").first<{ v: string }>();
  if (row) return JSON.parse(row.v);
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const privateJwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
  const raw = (await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer;
  const v: Vapid = { publicKey: b64u.enc(raw), privateJwk };
  // INSERT OR IGNORE: se due richieste generano insieme, vince la prima e rileggiamo
  await db.prepare("INSERT OR IGNORE INTO server_kv (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(v)).run();
  const again = await db.prepare("SELECT v FROM server_kv WHERE k = 'vapid'").first<{ v: string }>();
  return again ? JSON.parse(again.v) : v;
}

async function vapidAuth(endpoint: string, v: Vapid, subject: string) {
  const aud = new URL(endpoint).origin;
  const header = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.enc(sig)}, k=${v.publicKey}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array | ArrayBuffer, info: Uint8Array, bits: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bits));
}

// Cifra il payload per una sottoscrizione (p256dh, auth in base64url). Ritorna il body aes128gcm.
export async function encryptPayload(payload: Uint8Array, p256dh: string, authSecret: string) {
  const uaPublic = b64u.dec(p256dh);
  const auth = b64u.dec(authSecret);
  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', as.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, as.privateKey, 256);
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(payload, new Uint8Array([2])); // 0x02 = ultimo record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export type Sub = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushMsg = { title: string; body: string; url?: string; tag?: string };

// true = consegnata; 'gone' = sottoscrizione scaduta (da cancellare); false = errore temporaneo
export async function sendPush(db: D1Database, sub: Sub, msg: PushMsg): Promise<true | false | 'gone'> {
  const v = await getVapid(db);
  const body = await encryptPayload(enc.encode(JSON.stringify(msg)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, v, 'mailto:welcome-to-my-house@users.noreply.github.com'),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(12 * 3600),
      Urgency: 'normal',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) {
    console.error(JSON.stringify({ level: 'warn', msg: 'push fallita', status: res.status, body: (await res.text()).slice(0, 200) }));
    return false;
  }
  return true;
}
