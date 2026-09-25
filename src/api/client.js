const KEY_STORAGE = 'houseKey';

export function getHouseKey() {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setHouseKey(key) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* storage non disponibile */
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch(path, options = {}) {
  const key = getHouseKey();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-House-Key': key } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* risposta non JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}
