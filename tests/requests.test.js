import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { Creature } from '../src/creature/creature.js';
import { Tank } from '../src/tank/tank.js';
import {
  addPersona,
  addRequest,
  closeDB,
  deleteRequest,
  getPersona,
  giveCreature,
  listMoments,
  listPersonas,
  listRequestsFrom,
  listRequestsTo,
  listTanks,
  loadTank,
  markRequestNoticed,
  pruneRequests,
  saveSpecimen,
  saveTanks,
  setPersonaClosed,
} from '../src/storage/db.js';

afterEach(async () => {
  await closeDB();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('aquarium');
    req.onsuccess = req.onerror = () => resolve();
  });
});

// 2人と、それぞれの水槽
async function twoPeople() {
  const owner = await addPersona('テストA');
  const asker = await addPersona('テストB');
  const ownerTank = Tank.createNew(owner.id);
  const askerTank = Tank.createNew(asker.id);
  await saveTanks([ownerTank.toData(), askerTank.toData()]);
  return { owner, asker, ownerTank, askerTank, child: ownerTank.creatures[0] };
}

const ask = ({ owner, asker, ownerTank, askerTank, child }, targetTankId = askerTank.id) =>
  addRequest({
    fromPersonaId: asker.id,
    toPersonaId: owner.id,
    tankId: ownerTank.id,
    creatureId: child.id,
    targetTankId,
    creature: child.toJSON(),
  });

describe('おねがい', () => {
  it('今までの保存データ(版3)が、そのまま読める', async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('aquarium', 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('personas', { keyPath: 'id' }).put({ id: 'p1', name: 'テスト', createdAt: 1, lastOpenedAt: 1 });
        db.createObjectStore('tanks', { keyPath: 'personaId' });
        const aquaria = db.createObjectStore('aquaria', { keyPath: 'id' });
        aquaria.createIndex('personaId', 'personaId');
        aquaria.put({ ...Tank.createNew('p1', { id: 't1' }).toData(), createdAt: 1 });
        db.createObjectStore('specimens', { keyPath: 'id' }).createIndex('personaId', 'personaId');
        const moments = db.createObjectStore('moments', { keyPath: 'id' });
        moments.createIndex('personaId', 'personaId');
        moments.put({ id: 'm1', personaId: 'p1', takenAt: 1 });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    expect((await listPersonas()).map((p) => p.name)).toEqual(['テスト']);
    const tanks = await listTanks('p1');
    expect(tanks).toHaveLength(1);
    expect(Tank.fromData(tanks[0]).creatures).toHaveLength(2);
    expect(await listMoments('p1')).toHaveLength(1);
    expect(await listRequestsTo('p1')).toEqual([]);
    expect((await getPersona('p1')).closedToRequests).toBeUndefined(); // 無ければ受け付ける
  });

  it('同じ子へのおねがいは1人1つまで。取り消すと消える', async () => {
    const t = await twoPeople();
    const r1 = await ask(t);
    const r2 = await ask(t);
    expect(r2.id).toBe(r1.id);
    expect(await listRequestsFrom(t.asker.id)).toHaveLength(1);
    const incoming = await listRequestsTo(t.owner.id);
    expect(incoming).toHaveLength(1);
    expect(incoming[0].status).toBe('asked');
    expect(incoming[0].noticedAt).toBeNull();

    await markRequestNoticed(r1.id);
    expect((await listRequestsTo(t.owner.id))[0].noticedAt).toBeGreaterThan(0);

    await deleteRequest(r1.id);
    expect(await listRequestsTo(t.owner.id)).toEqual([]);
    expect(await listRequestsFrom(t.asker.id)).toEqual([]);
  });

  it('あげる:元の水槽から外れ、受け取る水槽に同じ子(遺伝子・特徴・受けやすさ・親の記録)が入る', async () => {
    const t = await twoPeople();
    t.child.parents = [{ id: 'x', genes: t.child.genes }];
    const r = await ask(t);
    const snapshot = t.child.toJSON();

    const target = Tank.fromData(await loadTank(t.askerTank.id));
    target.addCreature(new Creature(t.child.toJSON()));
    t.ownerTank.removeCreature(t.child);
    await giveCreature([t.ownerTank.toData(), target.toData()], r, target.id);

    const from = await loadTank(t.ownerTank.id);
    expect(from.creatures.some((c) => c.id === t.child.id)).toBe(false);
    const to = await loadTank(t.askerTank.id);
    const moved = to.creatures.find((c) => c.id === t.child.id);
    expect(moved.genes).toEqual(snapshot.genes);
    expect(moved.traits).toEqual(snapshot.traits);
    expect(moved.sensitivity).toEqual(snapshot.sensitivity);
    expect(moved.parents).toEqual(snapshot.parents);

    const [given] = await listRequestsFrom(t.asker.id);
    expect(given.status).toBe('given');
    expect(given.arrivedTankId).toBe(t.askerTank.id);
    // 届いたおねがいは、持ち主側のまだ決めていないおねがいには数えない。自動では消えない
    expect(await pruneRequests()).toBe(0);
    expect((await listRequestsTo(t.owner.id)).filter((x) => x.status === 'asked')).toEqual([]);
  });

  it('標本になった子・ほかの水槽に移った子へのおねがいは、自動で消える', async () => {
    const t = await twoPeople();
    const other = t.ownerTank.creatures[1];
    await ask(t);
    await ask({ ...t, child: other });
    expect(await pruneRequests()).toBe(0);

    // 1匹目は標本に
    t.ownerTank.removeCreature(t.child);
    await saveSpecimen({ id: 's1', personaId: t.owner.id, madeAt: 1, creature: t.child.toJSON() }, t.ownerTank.toData());
    expect(await pruneRequests()).toBe(1);
    expect((await listRequestsFrom(t.asker.id)).map((r) => r.creatureId)).toEqual([other.id]);

    // 2匹目は持ち主のほかの水槽へ
    const second = Tank.createEmpty(t.owner.id);
    second.addCreature(new Creature(other.toJSON()));
    t.ownerTank.removeCreature(other);
    await saveTanks([t.ownerTank.toData(), second.toData()]);
    expect(await pruneRequests()).toBe(1);
    expect(await listRequestsFrom(t.asker.id)).toEqual([]);
  });

  it('おねがいを受け付けない設定が保存される', async () => {
    const { owner } = await twoPeople();
    await setPersonaClosed(owner.id, true);
    expect((await getPersona(owner.id)).closedToRequests).toBe(true);
    await setPersonaClosed(owner.id, false);
    expect((await getPersona(owner.id)).closedToRequests).toBe(false);
  });
});
