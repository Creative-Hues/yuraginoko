import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { addPersona, closeDB, listPersonas, loadTank, saveTank } from '../src/storage/db.js';
import { Tank } from '../src/tank/tank.js';

afterEach(async () => {
  await closeDB();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('aquarium');
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe('保存', () => {
  it('人を追加して一覧に出る。同じ名前は増えない', async () => {
    const a = await addPersona('テスト1');
    await addPersona('テスト2');
    const again = await addPersona(' テスト1 ');
    expect(again.id).toBe(a.id);
    const list = await listPersonas();
    expect(list.map((p) => p.name)).toEqual(['テスト1', 'テスト2']);
  });

  it('新しい水槽には2匹いて、保存して読み込むと同じ状態に戻る', async () => {
    const p = await addPersona('テスト');
    const tank = Tank.createNew(p.id);
    expect(tank.creatures).toHaveLength(2);

    // 触れ合いで遺伝子が変わった状態も残る
    const c = tank.creatures[0];
    const before = c.genes.spikeLength;
    c.flick();
    expect(tank.dirty).toBe(true);
    c.x = 0.42;

    await saveTank(tank.toData());
    const loaded = Tank.fromData(await loadTank(p.id));
    expect(loaded.creatures).toHaveLength(2);
    expect(loaded.creatures[0].x).toBe(0.42);
    expect(loaded.creatures[0].genes).toEqual(c.genes);
    expect(loaded.creatures[0].genes.spikeLength).toBeCloseTo(Math.max(0, before - 0.005), 10);
  });

  it('撫でた距離が短いときは遺伝子を動かさない', () => {
    const tank = Tank.createNew('x');
    const c = tank.creatures[0];
    c.genes.translucency = 0.5;
    c.stroke(5);
    c.endStroke();
    expect(c.genes.translucency).toBe(0.5);
    c.stroke(15);
    c.stroke(15);
    c.endStroke();
    expect(c.genes.translucency).toBeCloseTo(0.505, 10);
  });
});

import { MEAL } from '../src/creature/creature.js';
import { DAY_MS } from '../src/tank/algae.js';

describe('フェーズ2の保存', () => {
  const v1 = () => ({
    personaId: 'p',
    version: 1,
    seed: 77,
    creatures: [
      { id: 'a', seed: 1, genes: { hue: 0.5, glow: 0.2 }, x: 0.4, z: 0.3, heading: 0 },
      { id: 'b', seed: 2, genes: { hue: 0.1 }, x: 0.6, z: 0.7, heading: Math.PI },
    ],
    things: {},
    env: {},
    savedAt: Date.now() - 7 * DAY_MS,
  });

  it('フェーズ1のデータがそのまま読め、閉じていた間は藻だけが増える', () => {
    const data = v1();
    const tank = Tank.fromData(data);
    expect(tank.algae.level).toBe(0);
    expect(tank.creatures.map((c) => c.meal.stage)).toEqual([MEAL.ready, MEAL.ready]);
    const before = tank.creatures.map((c) => c.toJSON());
    tank.catchUp();
    expect(tank.algae.level).toBeGreaterThan(0.3);
    expect(tank.creatures.map((c) => c.toJSON())).toEqual(before);
    expect(tank.creatures).toHaveLength(2);
    const saved = tank.toData();
    expect(saved.version).toBe(2);
    expect(saved.things.algae.cells).toHaveLength(48 * 27);
  });

  it('?days の日数で上書きできる', () => {
    const a = Tank.fromData({ ...v1(), savedAt: Date.now() });
    a.catchUp(Date.now(), 14);
    const b = Tank.fromData({ ...v1(), savedAt: Date.now() });
    b.catchUp(Date.now(), 3);
    expect(a.algae.level).toBeGreaterThan(b.algae.level);
  });

  it('エサ → 消化 → 排泄 で基本の色が 0.03 動いて保存され、休みに入る', async () => {
    const p = await addPersona('テスト');
    const tank = Tank.createNew(p.id);
    const c = tank.creatures[0];
    c.genes.hue = 0.5;
    expect(tank.feed(c, 'blue')).toBe(true);
    expect(c.meal.stage).toBe(MEAL.seeking);
    // 着くまで進める
    for (let i = 0; i < 60 * 40 && c.meal.stage === MEAL.seeking; i++) tank.update(1 / 60, i / 60);
    expect(c.meal.stage).toBe(MEAL.fed);
    expect(c.genes.hue).toBe(0.5);
    c.digest();
    for (let i = 0; i < 60 * 5; i++) tank.update(1 / 60, i / 60);
    expect(c.meal.stage).toBe(MEAL.digested);
    expect(c.genes.hue).toBeCloseTo(0.53, 6);
    expect(tank.excrete(c)).toBe(true);
    expect(c.meal.stage).toBe(MEAL.resting);
    expect(tank.food.droppings.length).toBeGreaterThan(0);
    expect(tank.food.droppings.every((d) => d.food === 'blue')).toBe(true); // 粒は食べたエサの色
    // その場でぴたりと止まって、粒はしっぽの先から出る
    expect(c.behavior.pause).toBeGreaterThan(0);
    expect(c.touch.cringe).toBe(1); // きゅっと縮む
    const tail = { ...c.points[c.points.length - 1] };
    tank.update(1, 1);
    // きゅっと縮むぶん(体の長さの 12% まで)しか動かない
    const moved = Math.hypot(c.points[c.points.length - 1].x - tail.x, c.points[c.points.length - 1].z - tail.z);
    expect(moved).toBeLessThan(0.24 * 0.12 + 1e-6);
    expect(tank.food.droppings.every((d) => d.x0 === tail.x)).toBe(true);

    await saveTank(tank.toData());
    const loaded = Tank.fromData(await loadTank(p.id));
    const lc = loaded.creatures[0];
    expect(lc.genes.hue).toBeCloseTo(0.53, 6);
    expect(lc.meal.stage).toBe(MEAL.resting);
    expect(lc.restProgress()).toBeLessThan(0.1);
    lc.refreshMeal(Date.now() + 61_000);
    expect(lc.meal.stage).toBe(MEAL.ready);
  });

  it('エサに向かう途中で閉じたときは、開くと「消化させる」から', () => {
    const tank = Tank.createNew('x');
    const c = tank.creatures[0];
    tank.feed(c, 'red');
    const loaded = Tank.fromData(JSON.parse(JSON.stringify(tank.toData())));
    expect(loaded.creatures[0].meal).toEqual({ stage: MEAL.fed, food: 'red' });
  });
});
