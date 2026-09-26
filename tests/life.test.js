import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { makeChild, normalizeQuirks } from '../src/creature/breeding.js';
import { randomGenes } from '../src/creature/genes.js';
import { EGG, GROW, MATE, MUTATION, TANK_CAPACITY } from '../src/creature/lifeConfig.js';
import { Creature } from '../src/creature/creature.js';
import { makeRng } from '../src/util/random.js';
import { Tank } from '../src/tank/tank.js';
import { pairKey } from '../src/tank/social.js';
import {
  closeDB,
  listSpecimens,
  listTanks,
  loadTank,
  saveSpecimen,
  saveTanks,
  updateSpecimen,
} from '../src/storage/db.js';

afterEach(async () => {
  await closeDB();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('aquarium');
    req.onsuccess = req.onerror = () => resolve();
  });
});

// 水槽を dt 刻みで seconds 秒進める(until が true になったら止める)
function run(tank, seconds, until = () => false, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    tank.update(dt, t);
    if (until()) return true;
  }
  return false;
}

describe('赤ちゃんの遺伝子', () => {
  it('必ず1〜2項目が大きくずれる(遺伝子の大ずれか、新しい特徴)', () => {
    for (let s = 1; s < 300; s++) {
      const rng = makeRng(s);
      const a = { genes: randomGenes(rng), quirks: [] };
      const b = { genes: randomGenes(rng), quirks: [] };
      const child = makeChild(a, b, rng);
      expect(child.mutations.length).toBeGreaterThanOrEqual(MUTATION.COUNT[0]);
      expect(child.mutations.length).toBeLessThanOrEqual(MUTATION.COUNT[1]);
      for (const m of child.mutations) {
        if (m.kind === 'gene') {
          expect(Math.abs(m.delta)).toBeGreaterThanOrEqual(MUTATION.SHIFT[0]);
          const v = child.genes[m.key];
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        } else {
          expect(m.kind).toBe('quirk');
        }
      }
      expect(child.quirks.length).toBe(child.mutations.filter((m) => m.kind === 'quirk').length);
    }
  });

  it('親の特徴はおよそ半分受け継ぎ、数には上限がある', () => {
    let inherited = 0;
    const q = { type: 'notch', u: 0.5, size: 0.7, seed: 1 };
    for (let s = 1; s < 400; s++) {
      const rng = makeRng(s);
      const child = makeChild({ genes: randomGenes(rng), quirks: [q] }, { genes: randomGenes(rng), quirks: [] }, rng);
      if (child.quirks.some((c) => c.seed === 1)) inherited++;
      expect(child.quirks.length).toBeLessThanOrEqual(MUTATION.MAX_QUIRKS);
    }
    expect(inherited).toBeGreaterThan(150);
    expect(inherited).toBeLessThan(250);
  });

  it('壊れた特徴は読み込まない', () => {
    expect(normalizeQuirks([{ type: 'nope' }, null, { type: 'sprout', form: 'x', u: 3 }])).toEqual([
      { type: 'sprout', form: 'horn', u: 1, size: 0.8, seed: 0 },
    ]);
    expect(normalizeQuirks('x')).toEqual([]);
  });
});

describe('交流と交配', () => {
  // 2匹を近くに置いた水槽
  function pairTank() {
    const tank = Tank.createNew('p');
    const [a, b] = tank.creatures;
    Object.assign(a, { x: 0.4, z: 0.5 });
    Object.assign(b, { x: 0.6, z: 0.5 });
    tank.social.timer = 0;
    return { tank, a, b };
  }

  it('近づいて触れ合い、組み合わせごとに数える', () => {
    const { tank, a, b } = pairTank();
    expect(run(tank, 30, () => tank.social.count(a, b) === 1)).toBe(true);
    expect(a.meet?.partner).toBe(b);
    expect(b.meet?.partner).toBe(a);
    expect(tank.events.some((e) => e.type === 'meet')).toBe(true);
    const data = JSON.parse(JSON.stringify(tank.toData()));
    expect(data.social.pairs[pairKey(a, b)]).toBe(1);
    expect(Tank.fromData(data).social.count(a, b)).toBe(1);
  });

  it(`${MATE.MEETS}回目の交流で卵を産み、数分でかえって小さな赤ちゃんになる`, () => {
    const { tank, a, b } = pairTank();
    tank.social.pairs[pairKey(a, b)] = MATE.MEETS - 1;
    expect(run(tank, 30, () => tank.eggs.count === 1)).toBe(true);
    expect(tank.social.count(a, b)).toBe(0);
    const egg = tank.eggs.list[0];
    expect(egg.child.parents.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());

    // 保存して読み込んでも、卵はそのまま
    const loaded = Tank.fromData(JSON.parse(JSON.stringify(tank.toData())));
    expect(loaded.eggs.count).toBe(1);

    tank.eggs.list[0].progress = EGG.HATCH_SECONDS - 0.01;
    tank.update(0.05, 0);
    expect(tank.eggs.count).toBe(0);
    expect(tank.creatures).toHaveLength(3);
    const baby = tank.creatures[2];
    expect(baby.growth).toBeLessThan(0.01);
    expect(baby.size).toBeCloseTo(GROW.BABY_SIZE, 2);
    expect(baby.parents).toHaveLength(2);
    expect(baby.parents[0].genes).toBeTruthy();
    expect(baby.mutations.length).toBeGreaterThanOrEqual(1);
    expect(tank.events.some((e) => e.type === 'crowded')).toBe(false);

    // 赤ちゃんは交流しない。開いている間に育つ
    baby.update(GROW.SECONDS / 2, 0);
    expect(baby.growth).toBeCloseTo(0.5, 5);
    expect(baby.adult).toBe(false);
  });

  it('4匹のときに生まれると5匹になり、5匹の間は交配しない', () => {
    const { tank, a, b } = pairTank();
    for (let i = 0; i < TANK_CAPACITY - 2; i++) tank.creatures.push(tank.adopt(Creature.create({ x: 0.5, z: 0.95 })));
    // 他の子は交流しないように
    for (const c of tank.creatures.slice(2)) c.growth = 0.99;
    tank.social.pairs[pairKey(a, b)] = MATE.MEETS - 1;
    expect(run(tank, 30, () => tank.eggs.count === 1)).toBe(true);
    expect(tank.hasRoom).toBe(false);
    tank.eggs.list[0].progress = EGG.HATCH_SECONDS;
    tank.update(0.01, 0);
    expect(tank.creatures).toHaveLength(TANK_CAPACITY + 1);
    expect(tank.crowded).toBe(true);
    expect(tank.events.some((e) => e.type === 'crowded')).toBe(true);

    tank.social.pairs[pairKey(a, b)] = MATE.MEETS + 3;
    for (const c of [a, b]) {
      c.meet = null;
      c.behavior.pause = 0;
    }
    tank.social.timer = 0;
    tank.social.approach = null;
    run(tank, 40, () => tank.social.count(a, b) > MATE.MEETS + 3);
    expect(tank.eggs.count).toBe(0);

    // 1匹いなくなると、また交配できる
    tank.removeCreature(tank.creatures[4]);
    expect(tank.crowded).toBe(false);
    expect(tank.social.count(a, b)).toBeGreaterThanOrEqual(MATE.MEETS);
  });

  it('閉じていた間は、卵も成長も進まない', () => {
    const { tank, a, b } = pairTank();
    tank.social.pairs[pairKey(a, b)] = MATE.MEETS - 1;
    run(tank, 30, () => tank.eggs.count === 1);
    const data = JSON.parse(JSON.stringify(tank.toData()));
    data.creatures[0].growth = 0.2;
    data.savedAt = data.lastSeenAt = Date.now() - 10 * 86400000;
    const loaded = Tank.fromData(data);
    const before = JSON.stringify({ eggs: loaded.eggs.toData(), c: loaded.creatures.map((c) => c.toJSON()) });
    loaded.catchUp();
    expect(JSON.stringify({ eggs: loaded.eggs.toData(), c: loaded.creatures.map((c) => c.toJSON()) })).toBe(before);
  });

  it('外した子の交流の回数は消える', () => {
    const { tank, a, b } = pairTank();
    tank.social.pairs[pairKey(a, b)] = 3;
    tank.removeCreature(b);
    expect(tank.social.toData().pairs).toEqual({});
    expect(tank.creatures).toEqual([a]);
  });
});

describe('フェーズ4の保存', () => {
  // フェーズ3のアプリが作ったのと同じ形のデータベース
  async function makeOldDb(tankData, persona) {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('aquarium', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('personas', { keyPath: 'id' });
        db.createObjectStore('tanks', { keyPath: 'personaId' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['personas', 'tanks'], 'readwrite');
        tx.objectStore('personas').put(persona);
        tx.objectStore('tanks').put(tankData);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  it('フェーズ3の水槽が、そのまま同じ人の水槽として読める', async () => {
    const persona = { id: 'p1', name: 'x', createdAt: 1, lastOpenedAt: 1 };
    const old = {
      personaId: 'p1',
      version: 3,
      seed: 5,
      lastSeenAt: 1000,
      creatures: [{ id: 'a', seed: 1, genes: { hue: 0.3 }, x: 0.4, z: 0.3, heading: 0, meal: { stage: 'ready' } }],
      things: { plants: [], other: 42 },
      env: { soil: 'mud', light: { color: 'blue', brightness: 0.3 }, current: { strength: 0.2, dir: -1 } },
      savedAt: 2000,
    };
    await makeOldDb(old, persona);
    const tanks = await listTanks('p1');
    expect(tanks).toHaveLength(1);
    expect(tanks[0].id).toBe('p1');
    const tank = Tank.fromData(tanks[0]);
    expect(tank.id).toBe('p1');
    expect(tank.name).toBe('');
    expect(tank.env.soil).toBe('mud');
    expect(tank.creatures[0].genes.hue).toBe(0.3);
    expect(tank.creatures[0].growth).toBe(1);
    expect(tank.creatures[0].quirks).toEqual([]);
    expect(tank.eggs.count).toBe(0);
    expect(tank.things.other).toBe(42);
    const again = tank.toData();
    expect(again.id).toBe('p1');
    expect(again.personaId).toBe('p1');
  });

  it('標本を保存して一覧に出し、名前と説明文を直せる。水槽もいっしょに保存される', async () => {
    const tank = Tank.createNew('p');
    const c = tank.creatures[0];
    tank.removeCreature(c);
    await saveSpecimen({ id: 's1', personaId: 'p', name: '', note: '', madeAt: 5, creature: c.toJSON() }, tank.toData());
    expect((await loadTank(tank.id)).creatures).toHaveLength(1);
    const list = await listSpecimens('p');
    expect(list).toHaveLength(1);
    expect(list[0].creature.genes).toEqual(c.genes);
    await updateSpecimen('s1', { name: ' ひかり ', note: 'よく光る' });
    expect((await listSpecimens('p'))[0]).toMatchObject({ name: 'ひかり', note: 'よく光る' });
    expect(await listSpecimens('other')).toEqual([]);
  });

  it('移すときは両方の水槽をいっしょに保存する', async () => {
    const from = Tank.createNew('p');
    const to = Tank.createEmpty('p');
    const c = from.creatures[0];
    from.removeCreature(c);
    to.addCreature(new Creature(c.toJSON()));
    await saveTanks([from.toData(), to.toData()]);
    const list = await listTanks('p');
    expect(list.map((t) => t.creatures.length).sort()).toEqual([1, 1]);
    expect((await loadTank(to.id)).creatures[0].id).toBe(c.id);
  });
});
