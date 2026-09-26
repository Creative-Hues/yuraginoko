// IndexedDB への保存。データはすべてこの端末の中だけに置く(サーバーには送らない)。
//
// ストア
// - personas: { id, name, createdAt, lastOpenedAt }
// - tanks:    { personaId, version, seed, creatures: [...], things: {...}, savedAt }
//
// 後のフェーズでストアを足すときは、DB_VERSION を上げて upgrade() に手順を追加する。
import { makeId } from '../util/random.js';

const DB_NAME = 'aquarium';
const DB_VERSION = 1;

let dbPromise = null;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('personas', { keyPath: 'id' });
    db.createObjectStore('tanks', { keyPath: 'personaId' });
  }
}

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function closeDB() {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

async function run(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listPersonas() {
  const all = await run('personas', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export function getPersona(id) {
  return run('personas', 'readonly', (s) => s.get(id));
}

// 同じ名前がすでにあれば、新しく作らずにそれを返す
export async function addPersona(name) {
  const trimmed = name.trim();
  const existing = (await listPersonas()).find((p) => p.name === trimmed);
  if (existing) return existing;
  const now = Date.now();
  const persona = { id: makeId(), name: trimmed, createdAt: now, lastOpenedAt: now };
  await run('personas', 'readwrite', (s) => s.put(persona));
  return persona;
}

export async function markOpened(id) {
  const persona = await getPersona(id);
  if (!persona) return;
  persona.lastOpenedAt = Date.now();
  await run('personas', 'readwrite', (s) => s.put(persona));
}

export function loadTank(personaId) {
  return run('tanks', 'readonly', (s) => s.get(personaId));
}

export function saveTank(data) {
  return run('tanks', 'readwrite', (s) => s.put({ ...data, savedAt: Date.now() }));
}
