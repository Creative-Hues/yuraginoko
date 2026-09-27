import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { Tank } from '../src/tank/tank.js';
import {
  addPersona,
  addRequest,
  closeDB,
  deletePersona,
  deleteSpecimens,
  deleteTank,
  getPersona,
  listMoments,
  listPersonas,
  listRequestsFrom,
  listRequestsTo,
  listSpecimens,
  listTanks,
  loadTank,
  saveMoment,
  saveSpecimen,
  saveTanks,
  setPersonaColor,
  updateTank,
} from '../src/storage/db.js';

afterEach(async () => {
  await closeDB();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('aquarium');
    req.onsuccess = req.onerror = () => resolve();
  });
});

// 2人と、それぞれの水槽・図鑑・標本。B は A の子へ、A は B の子へおねがいを出している
async function setup() {
  const a = await addPersona('テストA');
  const b = await addPersona('テストB');
  const ta = Tank.createNew(a.id);
  const tb = Tank.createNew(b.id);
  await saveTanks([ta.toData(), tb.toData()]);
  for (const [p, t] of [
    [a, ta],
    [b, tb],
  ]) {
    await saveMoment({ id: `m-${p.id}`, personaId: p.id, tankId: t.id, creatureId: t.creatures[0].id, takenAt: 1 });
    await saveSpecimen({ id: `s1-${p.id}`, personaId: p.id, madeAt: 1, creature: t.creatures[0].toJSON() });
    await saveSpecimen({ id: `s2-${p.id}`, personaId: p.id, madeAt: 2, creature: t.creatures[0].toJSON() });
  }
  const ask = (from, to, tank, targetTankId) =>
    addRequest({
      fromPersonaId: from.id,
      toPersonaId: to.id,
      tankId: tank.id,
      creatureId: tank.creatures[0].id,
      targetTankId,
      creature: tank.creatures[0].toJSON(),
    });
  await ask(b, a, ta, tb.id);
  await ask(a, b, tb, ta.id);
  return { a, b, ta, tb };
}

describe('消す', () => {
  it('名前を消すと、その人の水槽・図鑑・標本・おねがいがすべて消え、ほかの人のものは残る', async () => {
    const { a, b } = await setup();
    await deletePersona(a.id);
    expect((await listPersonas()).map((p) => p.id)).toEqual([b.id]);
    expect(await listTanks(a.id)).toEqual([]);
    expect(await listMoments(a.id)).toEqual([]);
    expect(await listSpecimens(a.id)).toEqual([]);
    expect(await listRequestsFrom(a.id)).toEqual([]);
    expect(await listRequestsTo(a.id)).toEqual([]);
    // B のものは残る(B が出したおねがいは、A あてなので消える)
    expect(await listTanks(b.id)).toHaveLength(1);
    expect(await listMoments(b.id)).toHaveLength(1);
    expect(await listSpecimens(b.id)).toHaveLength(2);
    expect(await listRequestsFrom(b.id)).toEqual([]);
  });

  it('水槽を消すと、その水槽の子へのおねがいは消え、そこで受け取るおねがいは新しい水槽で受け取る', async () => {
    const { a, b, ta } = await setup();
    await deleteTank(ta.id);
    expect(await loadTank(ta.id)).toBeUndefined();
    expect(await listRequestsTo(a.id)).toEqual([]); // A の水槽の子へのおねがい
    const [fromA] = await listRequestsFrom(a.id); // A が、消した水槽で受け取るはずだったおねがい
    expect(fromA.targetTankId).toBeNull();
    expect(await listTanks(b.id)).toHaveLength(1);
  });

  it('標本をえらんでまとめて消せる', async () => {
    const { a, b } = await setup();
    await deleteSpecimens([`s1-${a.id}`, `s2-${a.id}`]);
    expect(await listSpecimens(a.id)).toEqual([]);
    expect(await listSpecimens(b.id)).toHaveLength(2);
  });
});

describe('名前の色と、水槽の設定', () => {
  it('色を選んで登録でき、あとから変えられる。選んでいない人は色を持たない(登録順の色のまま)', async () => {
    const a = await addPersona('テストA');
    const b = await addPersona('テストB', '#ffe14d');
    expect(a.color).toBeUndefined();
    expect((await getPersona(b.id)).color).toBe('#ffe14d');
    await setPersonaColor(a.id, '#ff8a8a');
    expect((await getPersona(a.id)).color).toBe('#ff8a8a');
  });

  it('繁殖しない設定が保存される(無い水槽は繁殖する)', async () => {
    const p = await addPersona('テスト');
    const t = Tank.createNew(p.id);
    expect(t.noBreed).toBe(false);
    await saveTanks([t.toData()]);
    await updateTank(t.id, { name: 'なまえ', noBreed: true });
    const loaded = Tank.fromData(await loadTank(t.id));
    expect(loaded.name).toBe('なまえ');
    expect(loaded.noBreed).toBe(true);
    const old = { ...t.toData() };
    delete old.noBreed;
    expect(Tank.fromData(old).noBreed).toBe(false);
  });
});
