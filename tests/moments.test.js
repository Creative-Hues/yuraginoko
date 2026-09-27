import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeDB,
  deleteMoment,
  listMoments,
  listPersonas,
  listSpecimens,
  listTanks,
  saveMoment,
  updateMoment,
} from '../src/storage/db.js';
import { Tank } from '../src/tank/tank.js';
import { byGradient, colorGroupOf } from '../src/creature/colorGroup.js';

afterEach(async () => {
  await closeDB();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('aquarium');
    req.onsuccess = req.onerror = () => resolve();
  });
});

// フェーズ4まで(バージョン2)の保存データを、そのままの形で作る
function makeV2Db({ persona, tank, specimen }) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aquarium', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('personas', { keyPath: 'id' });
      db.createObjectStore('tanks', { keyPath: 'personaId' });
      db.createObjectStore('aquaria', { keyPath: 'id' }).createIndex('personaId', 'personaId');
      db.createObjectStore('specimens', { keyPath: 'id' }).createIndex('personaId', 'personaId');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['personas', 'aquaria', 'specimens'], 'readwrite');
      tx.objectStore('personas').put(persona);
      tx.objectStore('aquaria').put(tank);
      tx.objectStore('specimens').put(specimen);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

const moment = (id, personaId, takenAt, extra = {}) => ({
  id,
  personaId,
  tankId: 't',
  creatureId: 'c',
  name: '',
  note: '',
  takenAt,
  creature: { id: 'c', seed: 1, genes: { hue: 0.5 } },
  look: { hue: 0.5 },
  ...extra,
});

describe('図鑑の保存', () => {
  it('今までの保存データ(人・水槽・標本)が、そのまま読めて、図鑑は空から使える', async () => {
    const tank = { ...Tank.createNew('p1').toData(), savedAt: 1 };
    await makeV2Db({
      persona: { id: 'p1', name: 'x', createdAt: 1, lastOpenedAt: 1 },
      tank,
      specimen: { id: 's1', personaId: 'p1', name: 'a', note: '', madeAt: 1, creature: tank.creatures[0] },
    });
    expect((await listPersonas()).map((p) => p.id)).toEqual(['p1']);
    const tanks = await listTanks('p1');
    expect(tanks).toHaveLength(1);
    expect(tanks[0].creatures).toEqual(tank.creatures);
    expect((await listSpecimens('p1')).map((s) => s.id)).toEqual(['s1']);
    expect(await listMoments('p1')).toEqual([]);
    await saveMoment(moment('m1', 'p1', 5));
    expect((await listMoments('p1')).map((m) => m.id)).toEqual(['m1']);
  });

  it('人ごとに分かれ、残した順に並び、名前とメモを直せて、消せる', async () => {
    await saveMoment(moment('b', 'p', 20));
    await saveMoment(moment('a', 'p', 10));
    await saveMoment(moment('x', 'q', 15));
    expect((await listMoments('p')).map((m) => m.id)).toEqual(['a', 'b']);
    expect((await listMoments('q')).map((m) => m.id)).toEqual(['x']);
    await updateMoment('a', { name: ' ひかり ', note: 'よく光っていた' });
    expect((await listMoments('p'))[0]).toMatchObject({ name: 'ひかり', note: 'よく光っていた', look: { hue: 0.5 } });
    await deleteMoment('a');
    expect((await listMoments('p')).map((m) => m.id)).toEqual(['b']);
    expect((await listMoments('q')).map((m) => m.id)).toEqual(['x']);
  });
});

describe('図鑑の色分け', () => {
  const at = (hue, hue2 = 0) => ({ look: { hue, hue2 } });

  it('色相から色のグループに分ける(赤は 0° の両側)', () => {
    expect(colorGroupOf(at(0)).key).toBe('red');
    expect(colorGroupOf(at(0.98)).key).toBe('red');
    expect(colorGroupOf(at(30 / 360)).key).toBe('orange');
    expect(colorGroupOf(at(60 / 360)).key).toBe('yellow');
    expect(colorGroupOf(at(120 / 360)).key).toBe('green');
    expect(colorGroupOf(at(185 / 360)).key).toBe('aqua');
    expect(colorGroupOf(at(0.62)).key).toBe('blue');
    expect(colorGroupOf(at(270 / 360)).key).toBe('purple');
    expect(colorGroupOf(at(320 / 360)).key).toBe('pink');
  });

  it('揺らぎを含めた見た目(look)で分け、無ければ遺伝子から', () => {
    expect(colorGroupOf({ look: { hue: 0.62 }, creature: { genes: { hue: 0 } } }).key).toBe('blue');
    expect(colorGroupOf({ creature: { genes: { hue: 0.62 } } }).key).toBe('blue');
  });

  it('グラデーション順は赤から一周し、同じ色なら2つ目の色で並ぶ', () => {
    const list = [at(0.62), at(0.01), at(0.97), at(0.3), at(0.3, 0.5), at(0.3, 0.1)];
    const sorted = [...list].sort(byGradient).map((d) => [d.look.hue, d.look.hue2]);
    expect(sorted).toEqual([
      [0.97, 0],
      [0.01, 0],
      [0.3, 0],
      [0.3, 0.1],
      [0.3, 0.5],
      [0.62, 0],
    ]);
  });
});
