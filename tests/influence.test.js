import { describe, expect, it } from 'vitest';
import { FOODS } from '../src/creature/genes.js';
import { EGG } from '../src/creature/lifeConfig.js';
import { Tank } from '../src/tank/tank.js';
import { eggMood } from '../src/tank/eggs.js';
import { NO_EFFECT_TEXT, PLANTS, PLANT_KEYS, SOILS, SOIL_KEYS } from '../src/tank/envConfig.js';
import { currentHint, effectText, influenceList, lightHint, nowInfluences, plantHint, soilHint } from '../src/tank/influence.js';

const section = (title) => influenceList().find((s) => s.title === title);
const rowWith = (title, name) => section(title).rows.find((r) => r.label.split('・').includes(name));

describe('影響の一覧', () => {
  it('エサ・光の色・明るさ・土・植物・水流が並ぶ', () => {
    expect(influenceList().map((s) => s.title)).toEqual(['エサ', '光の色', '明るさ', '土', '植物', '水流']);
  });

  it('すべての植物と土が、envConfig.js の定義から一覧に出る', () => {
    for (const k of PLANT_KEYS) expect(rowWith('植物', PLANTS[k].label)).toBeTruthy();
    for (const k of SOIL_KEYS) expect(rowWith('土', SOILS[k].label)).toBeTruthy();
  });

  it('文章は効果の定義から作り、同じ文章はまとめる', () => {
    expect(rowWith('植物', 'トゲ草').text).toBe('突起が長くなる');
    expect(rowWith('植物', 'ひらひら葉').text).toBe('縁が波打つ');
    expect(rowWith('植物', 'のびる藻').text).toBe('体が細長くなる');
    expect(rowWith('植物', 'まるい苔').text).toBe('体がずんぐりする');
    expect(rowWith('植物', '光るキノコ').text).toBe('光り方が強くなる');
    const flowers = rowWith('植物', '赤い花草');
    expect(flowers.label).toBe('赤い花草・青い花草・黄色い花草');
    expect(flowers.text).toBe('体の色がその色に寄る');
    expect(flowers.note).toBeTruthy(); // エサのあとに生える
    expect(rowWith('土', '砂').text).toBe(NO_EFFECT_TEXT);
    expect(rowWith('土', '泥').text).toBe('網目の模様に寄る');
    expect(rowWith('土', '小石').text).toBe('斑点の模様に寄る');
    expect(rowWith('土', '光る砂').text).toBe('光り方が強くなる');
    expect(rowWith('エサ', FOODS.red.label).label).toBe([FOODS.red.label, FOODS.blue.label, FOODS.yellow.label].join('・'));
    expect(rowWith('エサ', FOODS.glow.label).text).toBe('光り方が強くなる');
    expect(rowWith('光の色', 'いつもの').text).toBe(NO_EFFECT_TEXT);
    expect(rowWith('光の色', '青').text).toBe('体の色がその色に寄る');
    expect(rowWith('明るさ', '暗い').text).toBe('透けやすくなる、光り方が強くなる');
    expect(rowWith('明るさ', '明るい').text).toBe('透けにくくなる、光り方が弱くなる');
    expect(section('水流').rows[0].text).toBe('浮きやすくなる');
  });

  it('言葉のない効果は「変化なし」', () => {
    expect(effectText({})).toBe(NO_EFFECT_TEXT);
    expect(effectText(null)).toBe(NO_EFFECT_TEXT);
  });
});

describe('編集モードの一言', () => {
  it('選んだものの効き方を出す', () => {
    expect(plantHint('toge')).toBe('トゲ草:突起が長くなる');
    expect(soilHint('glowSand')).toBe('光る砂:光り方が強くなる');
    expect(lightHint({ light: { color: 'blue', brightness: 0.5 } })).toBe('青:体の色がその色に寄る');
    expect(lightHint({ light: { color: 'usual', brightness: 0 } })).toBe(`いつもの:${NO_EFFECT_TEXT} / 暗い:透けやすくなる、光り方が強くなる`);
    expect(currentHint({ current: { strength: 0 } })).toBe(`水流:${NO_EFFECT_TEXT}`);
    expect(currentHint({ current: { strength: 1 } })).toBe('水流:浮きやすくなる');
  });
});

describe('観察中の「いま受けている影響」', () => {
  it('光の色・土・近くの植物・水流の名前が出る。初期の環境では何も出ない', () => {
    const tank = Tank.createNew('p');
    const c = tank.creatures[0];
    expect(nowInfluences(c, tank.env, tank.plants.list)).toEqual([]);
    tank.setEnv({ soil: 'glowSand', light: { color: 'blue' }, current: { strength: 0.8 } });
    const m = c.points[Math.floor(c.points.length / 2)];
    const p = tank.plant('toge', m.x, m.z);
    p.growth = 1;
    expect(nowInfluences(c, tank.env, tank.plants.list)).toEqual(['青い光', '光る砂', 'トゲ草', '水の流れ']);
  });
});

describe('卵のようす', () => {
  it('かえるまでの進み具合で一言が変わる(数字は出さない)', () => {
    const at = (k) => eggMood({ progress: EGG.HATCH_SECONDS * k });
    expect(at(0)).toBe('まだねむっている');
    expect(at(0.6)).toBe('すこしずつ育っている');
    expect(at(0.95)).toBe('もうすぐかえりそう');
    for (const k of [0, 0.3, 0.6, 0.9, 1]) expect(at(k)).not.toMatch(/\d/);
  });
});
