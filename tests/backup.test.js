import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DB_VERSION,
  addPersona,
  addRequest,
  closeDB,
  exportAll,
  importAll,
  isDataEmpty,
  saveMoment,
  saveSpecimen,
  saveTank,
  setPersonaColor,
  setPersonaSound,
} from '../src/storage/db.js';
import { BACKUP_STORES, backupFileName, makeBackup, parseBackup } from '../src/storage/backup.js';
import { Tank } from '../src/tank/tank.js';

afterEach(async () => {
  await closeDB();
  await wipe();
});

async function wipe() {
  await closeDB();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('aquarium');
    req.onsuccess = req.onerror = () => resolve();
  });
}

const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
const sorted = (stores) => Object.fromEntries(BACKUP_STORES.map((n) => [n, byId(stores[n])]));
const toFile = (stores) => JSON.stringify(makeBackup(stores, { dbVersion: DB_VERSION }));

// 2人ぶんの、水槽・標本・図鑑・おねがい・名前の色・音
async function fill(names = ['テスト1', 'テスト2']) {
  const a = await addPersona(names[0], '#ffe14d');
  const b = await addPersona(names[1]);
  await setPersonaColor(b.id, '#ff8a8a');
  await setPersonaSound(a.id, { on: true, ambient: 0.3, effects: 0.7 });
  const ta = Tank.createNew(a.id, { name: 'ひとつめ' });
  ta.setNoBreed(true);
  const tb = Tank.createNew(b.id);
  await saveTank(ta.toData());
  await saveTank(tb.toData());
  const c = ta.creatures[0];
  await saveSpecimen({ id: `s-${a.id}`, personaId: a.id, tankId: ta.id, name: 'しずく', note: '', madeAt: 1, creature: c.toJSON() });
  await saveMoment({ id: `m-${a.id}`, personaId: a.id, tankId: ta.id, creatureId: c.id, name: '', note: 'メモ', takenAt: 2, creature: c.toJSON(), look: {} });
  await addRequest({ fromPersonaId: b.id, toPersonaId: a.id, tankId: ta.id, creatureId: c.id, creature: c.toJSON() });
  return { a, b, ta, tb };
}

describe('書き出し', () => {
  it('ファイル名はゲーム名と日付', () => {
    expect(backupFileName(new Date(2026, 8, 27))).toBe('yuraginoko-2026-09-27.json');
  });

  it('版と書き出した日時が入る', async () => {
    await fill();
    const data = JSON.parse(toFile(await exportAll()));
    expect(data.app).toBe('yuraginoko');
    expect(data.version).toBe(1);
    expect(data.dbVersion).toBe(DB_VERSION);
    expect(typeof data.exportedAt).toBe('number');
  });
});

describe('読み込み', () => {
  it('書き出したファイルを空の状態に読み込むと、すべて元どおり', async () => {
    await fill();
    const before = await exportAll();
    const text = toFile(before);
    await wipe();
    expect(await isDataEmpty()).toBe(true);

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.counts).toEqual({ people: 2, tanks: 2, specimens: 1, moments: 1 });
    await importAll(parsed.data, 'merge');

    const after = await exportAll();
    expect(sorted(after)).toEqual(sorted(before));
    const tank = Tank.fromData(after.aquaria.find((t) => t.name === 'ひとつめ'));
    expect(tank.noBreed).toBe(true);
    expect(tank.creatures).toHaveLength(2);
    expect(after.personas.find((p) => p.name === 'テスト1').sound).toEqual({ on: true, ambient: 0.3, effects: 0.7 });
  });

  it('追加する:同じ id があれば今あるほうを残し、無いものだけ足す', async () => {
    const { a, ta } = await fill();
    const text = toFile(await exportAll());
    // 今のデータ:同じ人・同じ水槽を書きかえ、ファイルに無い人もいる
    await setPersonaColor(a.id, '#3de8ff');
    await saveTank({ ...ta.toData(), name: 'いまの名前' });
    const c = await addPersona('テスト3');

    await importAll(parseBackup(text).data, 'merge');
    const now = await exportAll();
    expect(now.personas).toHaveLength(3);
    expect(now.personas.find((p) => p.id === a.id).color).toBe('#3de8ff');
    expect(now.aquaria.find((t) => t.id === ta.id).name).toBe('いまの名前');
    expect(now.personas.some((p) => p.id === c.id)).toBe(true);
    expect(now.aquaria).toHaveLength(2);
  });

  it('追加する:同じ名前で id が違う人は1人にまとめ、色と音は今のまま', async () => {
    const from = await fill(['テスト1', 'テスト2']);
    const text = toFile(await exportAll());
    await wipe();
    // 公開版で、同じ名前で遊び始めていた
    const here = await addPersona('テスト1', '#7dffb0');
    await saveTank(Tank.createNew(here.id).toData());

    await importAll(parseBackup(text).data, 'merge');
    const now = await exportAll();
    expect(now.personas.map((p) => p.name).sort()).toEqual(['テスト1', 'テスト2']);
    const one = now.personas.find((p) => p.name === 'テスト1');
    expect(one.id).toBe(here.id);
    expect(one.color).toBe('#7dffb0');
    expect(one.sound).toBeUndefined();
    expect(now.aquaria.filter((t) => t.personaId === here.id)).toHaveLength(2);
    expect(now.specimens[0].personaId).toBe(here.id);
    expect(now.moments[0].personaId).toBe(here.id);
    expect(now.requests[0].toPersonaId).toBe(here.id);
    expect(now.requests[0].fromPersonaId).toBe(from.b.id);
  });

  it('入れかえる:今だけにあったものは消え、ファイルの中身だけになる', async () => {
    await fill();
    const before = await exportAll();
    const text = toFile(before);
    const extra = await addPersona('テスト3');
    await saveTank(Tank.createNew(extra.id).toData());

    await importAll(parseBackup(text).data, 'replace');
    expect(sorted(await exportAll())).toEqual(sorted(before));
  });

  it('古い版(1人1つの水槽 tanks だけ)のファイルも読み込める', async () => {
    const text = JSON.stringify({
      app: 'yuraginoko',
      version: 1,
      personas: [{ id: 'p', name: 'テスト', createdAt: 1, lastOpenedAt: 1 }],
      tanks: [{ personaId: 'p', version: 1, seed: 7, creatures: [{ id: 'c', seed: 1, genes: { hue: 0.5 }, x: 0.4, z: 0.3, heading: 0 }], savedAt: 5 }],
    });
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.counts).toEqual({ people: 1, tanks: 1, specimens: 0, moments: 0 });
    await importAll(parsed.data, 'merge');
    const [rec] = (await exportAll()).aquaria;
    expect(rec).toMatchObject({ id: 'p', personaId: 'p', name: '', createdAt: 5 });
    expect(Tank.fromData(rec).creatures).toHaveLength(1);
  });

  it('前のアプリ名(ちいさな水槽)で書き出したファイルも読み込める', async () => {
    await fill();
    const before = await exportAll();
    const text = JSON.stringify({ ...JSON.parse(toFile(before)), app: 'chiisana-suiso' });
    await wipe();
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    await importAll(parsed.data, 'merge');
    expect(sorted(await exportAll())).toEqual(sorted(before));
  });

  it('持ち主のいないものは外す', () => {
    const parsed = parseBackup(
      JSON.stringify({
        app: 'yuraginoko',
        version: 1,
        personas: [{ id: 'p', name: 'テスト' }],
        aquaria: [{ id: 't1', personaId: 'p' }, { id: 't2', personaId: 'nobody' }],
      }),
    );
    expect(parsed.data.aquaria.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('読み込めないファイル', () => {
  const good = { app: 'yuraginoko', version: 1, personas: [{ id: 'p', name: 'テスト' }] };
  const bad = {
    'JSON でない': 'これはファイルではありません',
    'ほかのもの': JSON.stringify({ ...good, app: 'something-else' }),
    '目印がない': JSON.stringify({ personas: good.personas }),
    'もっと新しい版': JSON.stringify({ ...good, version: 99 }),
    '人が配列でない': JSON.stringify({ ...good, personas: {} }),
    'id のない人': JSON.stringify({ ...good, personas: [{ name: 'テスト' }] }),
    '名前のない人': JSON.stringify({ ...good, personas: [{ id: 'p' }] }),
    '生き物が配列でない水槽': JSON.stringify({ ...good, aquaria: [{ id: 't', personaId: 'p', creatures: 3 }] }),
    '配列そのもの': JSON.stringify([good]),
  };
  for (const [label, text] of Object.entries(bad)) {
    it(label, () => expect(parseBackup(text).ok).toBe(false));
  }

  it('書き込みの途中で失敗しても、今のデータは変わらない(入れかえ・追加とも)', async () => {
    await fill();
    const before = sorted(await exportAll());
    const broken = {
      personas: [{ id: 'new', name: 'あたらしい' }],
      aquaria: [{ id: 'ok', personaId: 'new' }, { id: { not: 'a key' }, personaId: 'new' }],
      specimens: [],
      moments: [],
      requests: [],
    };
    for (const mode of ['replace', 'merge']) {
      await expect(importAll(broken, mode)).rejects.toBeTruthy();
      expect(sorted(await exportAll())).toEqual(before);
    }
  });
});
