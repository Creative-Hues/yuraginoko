// IndexedDB への保存。データはすべてこの端末の中だけに置く(サーバーには送らない)。
//
// ストア
// - personas:  { id, name, createdAt, lastOpenedAt }
// - aquaria:   水槽 { id, personaId, name, createdAt, version, seed, creatures: [...], things: {...}, savedAt, ... }(index: personaId)
// - specimens: 標本 { id, personaId, name, note, madeAt, creature: {...}, ... }(index: personaId)
// - tanks:     (フェーズ3まで)1人1つの水槽。DB_VERSION 2 で aquaria に写した。念のための控えとして消さずに残す
//
// 後のフェーズでストアを足すときは、DB_VERSION を上げて upgrade() に手順を追加する。
import { makeId } from '../util/random.js';

const DB_NAME = 'aquarium';
const DB_VERSION = 2;

let dbPromise = null;

function upgrade(db, oldVersion, tx) {
  if (oldVersion < 1) {
    db.createObjectStore('personas', { keyPath: 'id' });
    db.createObjectStore('tanks', { keyPath: 'personaId' });
  }
  if (oldVersion < 2) {
    // 1人が複数の水槽を持てるように、水槽の鍵を人から水槽そのものへ。
    // 今までの水槽は、人の id をそのまま水槽の id にして写す(中身はそのまま)
    const aquaria = db.createObjectStore('aquaria', { keyPath: 'id' });
    aquaria.createIndex('personaId', 'personaId');
    const specimens = db.createObjectStore('specimens', { keyPath: 'id' });
    specimens.createIndex('personaId', 'personaId');
    tx.objectStore('tanks').openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const rec = cursor.value;
      aquaria.put({ ...rec, id: rec.id ?? rec.personaId, name: rec.name ?? '', createdAt: rec.createdAt ?? rec.savedAt ?? Date.now() });
      cursor.continue();
    };
  }
}

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion, req.transaction);
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

// storeNames(1つまたは配列)をまとめて1つのトランザクションで扱う。
// fn(store) の返したリクエストの結果を、書き込みが終わってから返す
async function run(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const req = fn((name) => tx.objectStore(name ?? [].concat(storeNames)[0]));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---- 人 ----

export async function listPersonas() {
  const all = await run('personas', 'readonly', (s) => s().getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export function getPersona(id) {
  return run('personas', 'readonly', (s) => s().get(id));
}

// 同じ名前がすでにあれば、新しく作らずにそれを返す
export async function addPersona(name) {
  const trimmed = name.trim();
  const existing = (await listPersonas()).find((p) => p.name === trimmed);
  if (existing) return existing;
  const now = Date.now();
  const persona = { id: makeId(), name: trimmed, createdAt: now, lastOpenedAt: now };
  await run('personas', 'readwrite', (s) => s().put(persona));
  return persona;
}

export async function markOpened(id) {
  const persona = await getPersona(id);
  if (!persona) return;
  persona.lastOpenedAt = Date.now();
  await run('personas', 'readwrite', (s) => s().put(persona));
}

// ---- 水槽 ----

const byCreated = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0);

// その人の水槽(作った順)
export async function listTanks(personaId) {
  const all = await run('aquaria', 'readonly', (s) => s().index('personaId').getAll(personaId));
  return all.sort(byCreated);
}

// すべての水槽(作った順)
export async function listAllTanks() {
  const all = await run('aquaria', 'readonly', (s) => s().getAll());
  return all.sort(byCreated);
}

export function loadTank(id) {
  return run('aquaria', 'readonly', (s) => s().get(id));
}

export function saveTank(data) {
  return run('aquaria', 'readwrite', (s) => s().put({ ...data, savedAt: Date.now() }));
}

// いくつかの水槽をまとめて保存する(生き物を移すとき、片方だけ書かれることがないように)
export function saveTanks(list) {
  const now = Date.now();
  return run('aquaria', 'readwrite', (s) => {
    for (const data of list) s().put({ ...data, savedAt: now });
  });
}

export async function renameTank(id, name) {
  const data = await loadTank(id);
  if (!data) return;
  await saveTank({ ...data, name: String(name ?? '').trim() });
}

// ---- 標本 ----

// その人の標本(標本にした順)
export async function listSpecimens(personaId) {
  const all = await run('specimens', 'readonly', (s) => s().index('personaId').getAll(personaId));
  return all.sort((a, b) => (a.madeAt ?? 0) - (b.madeAt ?? 0));
}

export function getSpecimen(id) {
  return run('specimens', 'readonly', (s) => s().get(id));
}

// 標本を保存し、同時に水槽(その子を外したもの)も保存する
export function saveSpecimen(specimen, tankData = null) {
  const now = Date.now();
  return run(['specimens', 'aquaria'], 'readwrite', (s) => {
    s('specimens').put(specimen);
    if (tankData) s('aquaria').put({ ...tankData, savedAt: now });
  });
}

// 名前と説明文を直す
export async function updateSpecimen(id, { name, note }) {
  const s = await getSpecimen(id);
  if (!s) return null;
  const next = { ...s, name: String(name ?? '').trim(), note: String(note ?? '').trim() };
  await run('specimens', 'readwrite', (st) => st().put(next));
  return next;
}
