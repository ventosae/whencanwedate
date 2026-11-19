// Saves the session (body + tattoos) in IndexedDB so a reload keeps your work.
const DB = 'tattoo-studio';
const STORE = 'session';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSession() {
  try {
    return (await tx('readonly', (s) => s.get('current'))) || null;
  } catch {
    return null;
  }
}

export async function saveSession(data) {
  try {
    await tx('readwrite', (s) => s.put(data, 'current'));
    return true;
  } catch {
    return false;
  }
}

export async function clearSession() {
  try {
    await tx('readwrite', (s) => s.delete('current'));
  } catch {
    /* nothing to clear */
  }
}
