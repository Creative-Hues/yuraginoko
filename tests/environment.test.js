import { describe, expect, it } from 'vitest';
import { Tank } from '../src/tank/tank.js';
import { DEFAULT_ENV, ENV_CHANGE, NUTRIENT, PLANT_GROWTH, PLANT_LIMIT } from '../src/tank/envConfig.js';
import { normalizeEnv, targetFor } from '../src/tank/environment.js';
import { plantStage } from '../src/tank/plants.js';
import { DAY_MS } from '../src/tank/algae.js';
import { DROPPING } from '../src/tank/food.js';

// フェーズ2の保存データ(環境なし)
const v2 = () => ({
  personaId: 'p',
  version: 2,
  seed: 77,
  lastSeenAt: Date.now() - 3 * DAY_MS,
  creatures: [
    { id: 'a', seed: 1, genes: { hue: 0.5, glow: 0.2, spikeCount: 0.4, pattern: 0.9 }, x: 0.4, z: 0.3, heading: 0, meal: { stage: 'ready' } },
    { id: 'b', seed: 2, genes: { hue: 0.1 }, x: 0.6, z: 0.7, heading: Math.PI, meal: { stage: 'ready' } },
  ],
  things: { algae: { w: 48, h: 27, cells: new Array(48 * 27).fill(0) } },
  env: {},
});

// 生き物を動かさずに、環境の変化だけを seconds 秒ぶん進める。
// まとめて変わるタイミングは、そろえておく(ふだんは生き物ごとにずれる)
function tick(tank, seconds) {
  for (const c of tank.creatures) c.envTimer ??= 0;
  for (let i = 0; i < seconds; i++) tank.tickEnv(1);
}

function fromData(data) {
  const tank = Tank.fromData(data);
  for (const c of tank.creatures) c.envTimer = 0;
  return tank;
}

describe('環境', () => {
  it('環境のない古いデータは、初期の環境で開き、閉じていた間は藻だけが増える', () => {
    const tank = fromData(v2());
    expect(tank.env).toEqual(DEFAULT_ENV);
    expect(tank.plants.count).toBe(0);
    const before = tank.creatures.map((c) => c.toJSON());
    tank.catchUp();
    expect(tank.algae.level).toBeGreaterThan(0);
    expect(tank.creatures.map((c) => c.toJSON())).toEqual(before);
    const saved = tank.toData();
    expect(saved.version).toBe(3);
    expect(saved.env).toEqual(DEFAULT_ENV);
  });

  it('知らない値は初期値に直す', () => {
    const env = normalizeEnv({ soil: 'lava', light: { color: 'x', brightness: 5 }, current: { strength: 'a', dir: 3 } });
    expect(env.soil).toBe('sand');
    expect(env.light).toEqual({ color: 'usual', brightness: 1 });
    expect(env.current).toEqual({ strength: 0, dir: 1 });
  });

  it('初期の環境では、生き物の遺伝子は変わらない', () => {
    const tank = fromData(v2());
    const before = tank.creatures.map((c) => ({ ...c.genes }));
    tick(tank, 100);
    expect(tank.creatures.map((c) => c.genes)).toEqual(before);
  });

  it('20秒ごとに 0.015 ずつ、まとめて変わる。変わるときは光って、少しかけて変わる', () => {
    const tank = fromData(v2());
    const c = tank.creatures[0];
    tank.setEnv({ soil: 'glowSand' });
    tick(tank, 19);
    expect(c.genes.glow).toBe(0.2);
    tick(tank, 1);
    expect(c.shiftGlow).toBe(1);
    expect(tank.events.some((e) => e.type === 'envShift' && e.creature === c)).toBe(true);
    // 途中で閉じても、保存するのは変わりきったあとの値
    c.updateShift(ENV_CHANGE.SHIFT_SECONDS / 2);
    expect(c.genes.glow).toBeCloseTo(0.2075, 6);
    expect(c.toJSON().genes.glow).toBeCloseTo(0.215, 6);
    c.updateShift(ENV_CHANGE.SHIFT_SECONDS);
    expect(c.genes.glow).toBeCloseTo(0.215, 6);
    // 泥:模様が網目(0.625 あたり)へ寄る
    tank.setEnv({ soil: 'mud' });
    tick(tank, 20);
    c.finishShift();
    expect(c.genes.pattern).toBeCloseTo(0.885, 6);
  });

  it('当てはまっていた時間のぶんだけ変わる', () => {
    const tank = fromData(v2());
    const c = tank.creatures[0];
    tank.setEnv({ soil: 'glowSand' });
    tick(tank, 5);
    tank.setEnv({ soil: 'sand' });
    tick(tank, 15);
    c.finishShift();
    expect(c.genes.glow).toBeCloseTo(0.2 + 0.015 / 4, 6);
  });

  it('目標の値で止まり、目標は生き物ごとに少しずれる', () => {
    const tank = fromData(v2());
    const [a, b] = tank.creatures;
    a.genes.glow = 0.3;
    b.genes.glow = 0.3;
    tank.setEnv({ soil: 'glowSand' });
    tick(tank, 20 * 60);
    a.finishShift();
    b.finishShift();
    for (const c of [a, b]) {
      expect(c.genes.glow).toBeCloseTo(targetFor(c, 'glow', 0.8), 6);
      expect(Math.abs(c.genes.glow - 0.8)).toBeLessThanOrEqual(ENV_CHANGE.TARGET_JITTER + 1e-9);
    }
    expect(a.genes.glow).not.toBeCloseTo(b.genes.glow, 3);
    // 「上げる」効果は、もう越えている生き物を下げない
    a.genes.glow = 0.97;
    tick(tank, 60);
    a.finishShift();
    expect(a.genes.glow).toBe(0.97);
  });

  it('光:色は寄り、暗くすると透けやすく光りやすくなる', () => {
    const tank = fromData(v2());
    const c = tank.creatures[0];
    c.genes.translucency = 0.3;
    tank.setEnv({ light: { color: 'blue', brightness: 0 } });
    tick(tank, 20);
    c.finishShift();
    expect(c.genes.hue).toBeCloseTo(0.515, 6);
    expect(c.genes.translucency).toBeCloseTo(0.315, 6);
    expect(c.genes.glow).toBeCloseTo(0.215, 6);
  });

  it('水流が強いと、うねりやすく浮きやすくなる', () => {
    const tank = fromData(v2());
    const c = tank.creatures[0];
    c.genes.wriggliness = 0.5;
    c.genes.floatiness = 0.5;
    tank.setEnv({ current: { strength: 1, dir: -1 } });
    tick(tank, 20);
    c.finishShift();
    expect(c.genes.wriggliness).toBeCloseTo(0.515, 6);
    expect(c.genes.floatiness).toBeCloseTo(0.515, 6);
  });

  it('閉じている間は変わらない', () => {
    const tank = fromData(v2());
    tank.setEnv({ soil: 'glowSand', current: { strength: 1, dir: 1 } });
    const before = tank.creatures.map((c) => c.toJSON());
    tank.catchUp(Date.now(), 30);
    expect(tank.creatures.map((c) => c.toJSON())).toEqual(before);
  });
});

describe('植物', () => {
  it('近くの植物は育ち具合に合わせて効き(とても大きいは1.5倍)、芽や遠くの植物は効かない', () => {
    const tank = fromData(v2());
    const c = tank.creatures[0];
    const m = c.points[Math.floor(c.points.length / 2)];
    const p = tank.plant('toge', m.x, m.z);
    tick(tank, 20);
    c.finishShift();
    expect(c.genes.spikeCount).toBe(0.4); // 芽のまま
    p.growth = 1;
    tank.plants.grow = () => false; // 育ち具合を固定して確かめる
    tick(tank, 20);
    c.finishShift();
    expect(c.genes.spikeCount).toBeCloseTo(0.415, 6);
    p.growth = 2;
    tick(tank, 20);
    c.finishShift();
    expect(c.genes.spikeCount).toBeCloseTo(0.4375, 6);
    tank.movePlant(p, m.x > 0.5 ? 0.04 : 0.96, m.z);
    tick(tank, 20);
    c.finishShift();
    expect(c.genes.spikeCount).toBeCloseTo(0.4375, 6);
  });

  it('芽 → 小さい → 大きい → とても大きい と育ち、栄養があると早い', () => {
    const tank = fromData(v2());
    const a = tank.plant('nobi', 0.2, 0.2);
    const b = tank.plant('nobi', 0.8, 0.8);
    tank.nutrients.add(0.8, 0.8, 1);
    expect(plantStage(a.growth)).toBe('sprout');
    tick(tank, Math.ceil(PLANT_GROWTH.SMALL_AT * PLANT_GROWTH.SECONDS));
    expect(plantStage(a.growth)).toBe('small');
    expect(b.growth).toBeGreaterThan(a.growth);
    expect(tank.nutrients.at(0.8, 0.8)).toBeLessThan(1); // 育つと栄養を使う
    tick(tank, PLANT_GROWTH.SECONDS);
    expect(plantStage(a.growth)).toBe('large');
    a.growth = 1; // 大きくなったところから
    tick(tank, PLANT_GROWTH.HUGE_SECONDS - 60);
    expect(plantStage(a.growth)).toBe('large');
    tick(tank, 60);
    expect(plantStage(a.growth)).toBe('huge');
    expect(a.growth).toBe(2);
  });

  it('前の保存データの育ち具合(0〜1)はそのまま読め、2 を超えない', () => {
    const data = v2();
    data.things.plants = [
      { id: 'x', kind: 'toge', x: 0.3, z: 0.4, growth: 1, seed: 5 },
      { id: 'y', kind: 'hira', x: 0.6, z: 0.4, growth: 0.5, seed: 6 },
      { id: 'z', kind: 'maru', x: 0.6, z: 0.4, growth: 9, seed: 7 },
    ];
    const tank = fromData(data);
    expect(tank.plants.list.map((p) => p.growth)).toEqual([1, 0.5, 2]);
  });

  it('合計8本まで。抜ける', () => {
    const tank = fromData(v2());
    for (let i = 0; i < PLANT_LIMIT; i++) expect(tank.plant('maru', i / 10, 0.5)).not.toBeNull();
    expect(tank.plant('maru', 0.5, 0.5)).toBeNull();
    tank.removePlant(tank.plants.list[0]);
    expect(tank.plants.count).toBe(PLANT_LIMIT - 1);
  });

  it('保存して読み込むと、環境・植物・栄養が戻る', () => {
    const tank = fromData(v2());
    tank.setEnv({ soil: 'pebble', light: { color: 'pink', brightness: 0.8 }, current: { strength: 0.4, dir: -1 } });
    const p = tank.plant('hira', 0.3, 0.6);
    p.growth = 0.5;
    tank.nutrients.add(0.5, 0.5, 0.3);
    const loaded = Tank.fromData(JSON.parse(JSON.stringify(tank.toData())));
    expect(loaded.env).toEqual(tank.env);
    expect(loaded.plants.list).toEqual(tank.plants.list);
    expect(loaded.nutrients.at(0.5, 0.5)).toBeCloseTo(0.3, 3);
  });
});

describe('排泄物と土', () => {
  // 排泄の粒を出して、溶けきるまで進める
  function excreteAndMelt(tank, food) {
    const c = tank.creatures[0];
    c.meal = { stage: 'digested', food };
    tank.excrete(c);
    const life = DROPPING.FIRST_DELAY + DROPPING.EACH_DELAY * 5 + DROPPING.EMERGE + DROPPING.MELT_START + DROPPING.MELT + 1;
    for (let i = 0; i < life * 10; i++) tank.updateFood(0.1);
  }

  it('粒が溶けると土に栄養がたまり、食べたエサの種類の芽が出る', () => {
    const tank = fromData(v2());
    tank.random = () => 0; // 必ず芽が出る
    excreteAndMelt(tank, 'blue');
    const total = tank.nutrients.cells.reduce((s, v) => s + v, 0);
    expect(total).toBeGreaterThan(NUTRIENT.PER_DROPPING);
    expect(tank.plants.count).toBe(1);
    expect(tank.plants.list[0].kind).toBe('blueFlower');
    expect(tank.events.some((e) => e.type === 'sprout')).toBe(true);
  });

  it('芽が出ないこともあり、上限のときは生えない', () => {
    const tank = fromData(v2());
    tank.random = () => 0.99;
    excreteAndMelt(tank, 'glow');
    expect(tank.plants.count).toBe(0);
    tank.random = () => 0;
    for (let i = 0; i < PLANT_LIMIT; i++) tank.plant('toge', i / 10, 0.1);
    excreteAndMelt(tank, 'glow');
    expect(tank.plants.count).toBe(PLANT_LIMIT);
    expect(tank.plants.list.some((p) => p.kind === 'glowCap')).toBe(false);
  });
});
