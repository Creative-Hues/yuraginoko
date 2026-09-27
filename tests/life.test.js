import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { makeChild } from '../src/creature/breeding.js';
import { randomTraits } from '../src/creature/traits.js';
import { DANCE_SECONDS } from '../src/tank/breedDance.js';
import { randomGenes } from '../src/creature/genes.js';
import { BREED, EGG, GROW, MATE, MUTATION, TANK_CAPACITY } from '../src/creature/lifeConfig.js';
import { Creature } from '../src/creature/creature.js';
import { makeRng } from '../src/util/random.js';
import { solidPattern } from '../src/creature/pattern.js';
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
  it('環境で変わる遺伝子と模様は、必ず1〜2項目が大きくずれる。特徴遺伝子の突然変異は多くても1つ', () => {
    let patternMutations = 0;
    for (let s = 1; s < 300; s++) {
      const rng = makeRng(s);
      const a = { genes: randomGenes(rng), pattern: solidPattern('spots'), traits: randomTraits(rng) };
      const b = { genes: randomGenes(rng), pattern: { net: 0.8, stripes: 0.2 }, traits: randomTraits(rng) };
      const child = makeChild(a, b, rng);
      const genes = child.mutations.filter((m) => m.kind === 'gene');
      const pattern = child.mutations.filter((m) => m.kind === 'pattern');
      expect(genes.length + pattern.length).toBeGreaterThanOrEqual(MUTATION.COUNT[0]);
      expect(genes.length + pattern.length).toBeLessThanOrEqual(MUTATION.COUNT[1]);
      // 模様は1種類だけ。変異がなければ両親どちらかの今の模様、変異があれば、受け継いだものとちがう種類
      const kinds = Object.keys(child.pattern);
      expect(kinds).toHaveLength(1);
      expect(child.pattern[kinds[0]]).toBe(1);
      if (pattern.length) {
        patternMutations++;
        expect(['spots', 'net']).toContain(pattern[0].from);
        expect(pattern[0].to).not.toBe(pattern[0].from);
        expect(kinds[0]).toBe(pattern[0].to);
      } else {
        expect(['spots', 'net']).toContain(kinds[0]);
      }
      for (const m of genes) {
        expect(MUTATION.SHIFT_KEYS).toContain(m.key);
        expect(Math.abs(m.delta)).toBeGreaterThanOrEqual(MUTATION.SHIFT[0]);
        expect(child.genes[m.key]).toBeGreaterThanOrEqual(0);
        expect(child.genes[m.key]).toBeLessThanOrEqual(1);
      }
      expect(child.mutations.filter((m) => m.kind === 'trait').length).toBeLessThanOrEqual(1);
      expect(child.mutations.every((m) => ['gene', 'pattern', 'trait'].includes(m.kind))).toBe(true);
      expect(child.quirks).toBeUndefined();
    }
    expect(patternMutations).toBeGreaterThan(0);
  });
});

describe('交流と繁殖', () => {
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

  // 準備ができた2匹が、すぐ繁殖を探し始めるようにする(交流は起きないように)
  function readyTank() {
    const t = pairTank();
    t.tank.social.pairs[pairKey(t.a, t.b)] = MATE.MEETS;
    t.tank.social.timer = Infinity;
    t.tank.social.breedTimer = 0;
    let bred = 0;
    const orig = t.tank.bred.bind(t.tank);
    t.tank.bred = (a, b) => {
      bred++;
      return orig(a, b);
    };
    return { ...t, bred: () => bred };
  }

  it(`${MATE.MEETS}回目の交流で繁殖の準備ができる(卵はまだ産まない)。準備は保存される`, () => {
    const { tank, a, b } = pairTank();
    tank.social.pairs[pairKey(a, b)] = MATE.MEETS - 1;
    expect(tank.readyToBreed(a)).toBe(false);
    expect(run(tank, 30, () => tank.social.count(a, b) === MATE.MEETS)).toBe(true);
    expect(tank.eggs.count).toBe(0);
    expect(tank.readyToBreed(a)).toBe(true);
    expect(tank.readyToBreed(b)).toBe(true);
    const loaded = Tank.fromData(JSON.parse(JSON.stringify(tank.toData())));
    expect(loaded.readyToBreed(loaded.creatures[0])).toBe(true);
  });

  it('準備ができた2匹は並んで輪になり、回りながら昇って沈み、底で離れてから確率で卵を産む。産んだら回数は 0', () => {
    const { tank, a, b, bred } = readyTank();
    tank.random = () => BREED.CHANCE - 0.01; // 当たり
    expect(run(tank, BREED.GIVE_UP, () => !!tank.social.breeding)).toBe(true);
    expect(a.breed?.partner).toBe(b);
    expect(b.breed?.partner).toBe(a);
    expect(a.meet).toBeNull(); // 交流(触角)とは別の動き
    const dance = tank.social.breeding;
    // 並ぶ:頭としっぽが逆向き
    run(tank, BREED.PHASES.nestle - 0.1);
    expect(dance.phase).toBe('nestle');
    expect(Math.cos(a.heading) * Math.cos(b.heading)).toBeLessThan(0);
    // 昇って、真ん中あたりの高さで回る(輪の反対側にいて、2匹の体の波はそろっている)
    run(tank, BREED.PHASES.rise + BREED.PHASES.hover / 2);
    expect(dance.phase).toBe('hover');
    expect(a.lift).toBeCloseTo(BREED.RISE_LIFT, 1);
    expect(b.lift).toBeCloseTo(BREED.RISE_LIFT, 1);
    expect((a.x - dance.cx) * (b.x - dance.cx) + (a.z - dance.cz) * (b.z - dance.cz) * 0.2).toBeLessThan(0);
    expect(a.phase).toBe(b.phase);
    expect(a.breed.calm).toBe(1);
    expect(tank.eggs.count).toBe(0);
    const zBefore = [a.z, b.z];
    run(tank, BREED.PHASES.hover / 2 + BREED.PHASES.sink / 2);
    expect(dance.phase).toBe('sink');
    expect(Math.sign(a.z - b.z)).not.toBe(Math.sign(zBefore[0] - zBefore[1])); // 回って、手前と奥が入れ替わる
    // 底に着いて離れたあとに産む
    let liftAtEgg = null;
    expect(
      run(tank, DANCE_SECONDS, () => {
        if (tank.eggs.count === 1) liftAtEgg = Math.max(a.lift, b.lift);
        return tank.eggs.count === 1;
      }),
    ).toBe(true);
    expect(liftAtEgg).toBeLessThan(0.05);
    expect(bred()).toBe(1);
    expect(a.breed).toBeNull();
    expect(tank.social.count(a, b)).toBe(0);
    expect(tank.readyToBreed(a)).toBe(false);
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
    expect(tank.events.some((e) => e.type === 'hatch' && e.egg === egg)).toBe(true);
    expect(tank.events.some((e) => e.type === 'crowded')).toBe(false);

    // 赤ちゃんは交流しない。開いている間に育つ
    baby.update(GROW.SECONDS / 2, 0);
    expect(baby.growth).toBeCloseTo(0.5, 5);
    expect(baby.adult).toBe(false);
  });

  it('のぞいている間は、繁殖を始めず、卵もかえらない', () => {
    const { tank, bred } = readyTank();
    tank.random = () => 0;
    tank.peek = true;
    tank.mate(tank.creatures[0], tank.creatures[1]);
    tank.eggs.list[0].progress = EGG.HATCH_SECONDS - 0.01;
    run(tank, BREED.GIVE_UP + DANCE_SECONDS + 1);
    expect(bred()).toBe(0);
    expect(tank.social.breeding).toBeNull();
    expect(tank.eggs.count).toBe(1);
    expect(tank.creatures).toHaveLength(2);
  });

  it('繁殖しない水槽は、準備がたまっても繁殖しない。交流は続き、今ある卵はかえる', () => {
    const { tank, a, b, bred } = readyTank();
    tank.random = () => 0;
    tank.mate(a, b);
    tank.eggs.list[0].progress = EGG.HATCH_SECONDS - 0.01;
    tank.setNoBreed(true);
    expect(tank.readyToBreed(a)).toBe(false); // 観察の一言も出さない
    tank.social.timer = 0;
    let met = 0;
    const orig = tank.met.bind(tank);
    tank.met = (x, y) => {
      met++;
      return orig(x, y);
    };
    run(tank, BREED.GIVE_UP + DANCE_SECONDS + 1);
    expect(bred()).toBe(0);
    expect(tank.social.breeding).toBeNull();
    expect(tank.eggs.count).toBe(0);
    expect(tank.creatures).toHaveLength(3);
    expect(met).toBeGreaterThan(0);
    expect(tank.social.count(a, b)).toBeGreaterThanOrEqual(MATE.MEETS);
  });

  it('最後まで終わっても産まなかったときは、準備ができたまま次を待つ', () => {
    const { tank, a, b, bred } = readyTank();
    tank.random = () => BREED.CHANCE + 0.01; // 外れ
    expect(run(tank, BREED.GIVE_UP + DANCE_SECONDS + 1, () => bred() === 1)).toBe(true);
    expect(tank.eggs.count).toBe(0);
    expect(tank.social.count(a, b)).toBe(MATE.MEETS);
    expect(tank.readyToBreed(a)).toBe(true);
    expect(tank.social.breedTimer).toBeGreaterThan(0); // 次は少しあとで
  });

  it('途中で弾かれたら繁殖はやめて、準備ができたまま', () => {
    const { tank, a, b, bred } = readyTank();
    tank.random = () => 0;
    expect(run(tank, BREED.GIVE_UP, () => !!tank.social.breeding)).toBe(true);
    run(tank, 1);
    a.flick();
    tank.update(1 / 30, 0);
    expect(tank.social.breeding).toBeNull();
    expect(a.breed).toBeNull();
    expect(b.breed).toBeNull();
    run(tank, DANCE_SECONDS + 1);
    expect(bred()).toBe(0);
    expect(tank.eggs.count).toBe(0);
    expect(tank.readyToBreed(a)).toBe(true);
  });

  it('4匹のときに生まれると5匹になり、5匹の間は繁殖しない', () => {
    const { tank, a, b } = readyTank();
    for (let i = 0; i < TANK_CAPACITY - 2; i++) tank.creatures.push(tank.adopt(Creature.create({ x: 0.5, z: 0.95 })));
    // 他の子は交流しないように
    for (const c of tank.creatures.slice(2)) c.growth = 0.99;
    tank.random = () => 0;
    expect(run(tank, BREED.GIVE_UP + DANCE_SECONDS + 1, () => tank.eggs.count === 1)).toBe(true);
    expect(tank.hasRoom).toBe(false);
    tank.eggs.list[0].progress = EGG.HATCH_SECONDS;
    tank.update(0.01, 0);
    expect(tank.creatures).toHaveLength(TANK_CAPACITY + 1);
    expect(tank.crowded).toBe(true);
    expect(tank.events.some((e) => e.type === 'crowded')).toBe(true);

    tank.social.pairs[pairKey(a, b)] = MATE.MEETS + 3;
    for (const c of [a, b]) {
      c.breed = null;
      c.behavior.pause = 0;
    }
    tank.social.breedTimer = 0;
    tank.social.approach = null;
    run(tank, 40, () => !!tank.social.breeding);
    expect(tank.social.breeding).toBeNull();
    expect(tank.eggs.count).toBe(0);

    // 1匹いなくなると、また繁殖できる(準備はそのまま)
    tank.removeCreature(tank.creatures[4]);
    expect(tank.crowded).toBe(false);
    expect(tank.readyToBreed(a)).toBe(true);
  });

  it('閉じていた間は、卵も成長も進まない', () => {
    const { tank } = readyTank();
    tank.random = () => 0;
    run(tank, BREED.GIVE_UP + DANCE_SECONDS + 1, () => tank.eggs.count === 1);
    expect(tank.eggs.count).toBe(1);
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
    expect(tank.creatures[0].quirks).toBeUndefined();
    expect(Object.keys(tank.creatures[0].traits).sort()).toEqual(['antennaLength', 'blink', 'spikeCount', 'tailLength', 'wriggliness']);
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
