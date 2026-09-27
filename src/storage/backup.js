// データの書き出し・読み込み(公開版への引っ越し・機種変更の控え)。DB には触れず、ファイルの形だけを扱う。
//
// ファイルの形
// { app: 'chiisana-suiso', version, dbVersion, exportedAt, personas: [...], aquaria: [...], specimens: [...], moments: [...], requests: [...] }
// レコードは DB の中身そのまま。水槽の古い形は、今の保存データと同じく、開いたときに Tank.fromData が変換する。
//
// ファイルの形が変わったら BACKUP_VERSION を上げて、migrate() に手順を追加する。
// - 1: はじめの形
export const BACKUP_APP = 'chiisana-suiso';
export const BACKUP_VERSION = 1;

// 書き出すストア(フェーズ3までの控え tanks は書き出さない)
export const BACKUP_STORES = ['personas', 'aquaria', 'specimens', 'moments', 'requests'];

export function makeBackup(stores, { dbVersion, now = Date.now() } = {}) {
  const data = { app: BACKUP_APP, version: BACKUP_VERSION, dbVersion, exportedAt: now };
  for (const name of BACKUP_STORES) data[name] = stores[name] ?? [];
  return data;
}

// chiisana-suiso-2026-09-27.json(端末の日付)
export function backupFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${BACKUP_APP}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

// 古い形を今の形にそろえる(DB の upgrade() と同じ考え方)
function migrate(data) {
  const out = { ...data };
  // DB 版1の形(1人1つの水槽 tanks)だけがあれば、DB 版2と同じように aquaria へ写す
  if (!Array.isArray(out.aquaria) && Array.isArray(out.tanks)) {
    out.aquaria = out.tanks.map((rec) =>
      isRecord(rec) ? { ...rec, id: rec.id ?? rec.personaId, name: rec.name ?? '', createdAt: rec.createdAt ?? rec.savedAt ?? Date.now() } : rec,
    );
  }
  delete out.tanks;
  for (const name of BACKUP_STORES) out[name] ??= [];
  return out;
}

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v !== '';

// ストアごとの形の確認
const CHECKS = {
  personas: (r) => typeof r.name === 'string' && r.name.trim() !== '',
  aquaria: (r) => isId(r.personaId) && (r.creatures == null || Array.isArray(r.creatures)),
  specimens: (r) => isId(r.personaId),
  moments: (r) => isId(r.personaId),
  requests: (r) => isId(r.fromPersonaId) && isId(r.toPersonaId),
};

// ファイルの中身(文字列)を確かめる。読めれば { ok: true, data, counts }、読めなければ { ok: false }
// 形が1つでもおかしければ、一部だけ読むことはしない
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isRecord(raw) || raw.app !== BACKUP_APP) return { ok: false };
  if (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > BACKUP_VERSION) return { ok: false };
  const data = migrate(raw);
  for (const name of BACKUP_STORES) {
    const list = data[name];
    if (!Array.isArray(list)) return { ok: false };
    if (!list.every((r) => isRecord(r) && isId(r.id) && CHECKS[name](r))) return { ok: false };
  }
  // 持ち主の人がいないものは、どこにも見えないので外す
  const people = new Set(data.personas.map((p) => p.id));
  const owned = (r) => people.has(r.personaId);
  const clean = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    dbVersion: data.dbVersion,
    exportedAt: data.exportedAt,
    personas: data.personas,
    aquaria: data.aquaria.filter(owned),
    specimens: data.specimens.filter(owned),
    moments: data.moments.filter(owned),
    requests: data.requests.filter((r) => people.has(r.fromPersonaId) && people.has(r.toPersonaId)),
  };
  return { ok: true, data: clean, counts: countBackup(clean) };
}

// 「〇人の、水槽〇個・標本〇個・図鑑〇枚」用
export function countBackup(stores) {
  return {
    people: stores.personas?.length ?? 0,
    tanks: stores.aquaria?.length ?? 0,
    specimens: stores.specimens?.length ?? 0,
    moments: stores.moments?.length ?? 0,
  };
}

export const isEmptyCounts = (c) => !c.people && !c.tanks && !c.specimens && !c.moments;

// 書き込むレコードを決める。existing / incoming: { ストア名: [レコード] }
// - replace: ファイルの中身をそのまま
// - merge:   同じ名前で id が違う人は1人にまとめ(今の人の id に付けかえ、色・音は今のまま)、
//            同じ id がすでにあるものは今あるほうを残して、無いものだけ足す
export function planImport(existing, incoming, mode) {
  if (mode === 'replace') return Object.fromEntries(BACKUP_STORES.map((name) => [name, incoming[name] ?? []]));

  const byName = new Map((existing.personas ?? []).map((p) => [p.name.trim(), p.id]));
  const existingIds = new Set((existing.personas ?? []).map((p) => p.id));
  const remap = new Map();
  for (const p of incoming.personas ?? []) {
    const same = byName.get(p.name.trim());
    if (!existingIds.has(p.id) && same) remap.set(p.id, same);
  }
  const to = (id) => remap.get(id) ?? id;
  const moved = {
    personas: (incoming.personas ?? []).filter((p) => !remap.has(p.id)),
    aquaria: (incoming.aquaria ?? []).map((r) => ({ ...r, personaId: to(r.personaId) })),
    specimens: (incoming.specimens ?? []).map((r) => ({ ...r, personaId: to(r.personaId) })),
    moments: (incoming.moments ?? []).map((r) => ({ ...r, personaId: to(r.personaId) })),
    requests: (incoming.requests ?? []).map((r) => ({ ...r, fromPersonaId: to(r.fromPersonaId), toPersonaId: to(r.toPersonaId) })),
  };
  return Object.fromEntries(
    BACKUP_STORES.map((name) => {
      const have = new Set((existing[name] ?? []).map((r) => r.id));
      return [name, moved[name].filter((r) => !have.has(r.id))];
    }),
  );
}
