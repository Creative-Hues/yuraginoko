import { describe, expect, it } from 'vitest';
import { Creature } from '../src/creature/creature.js';
import { makeChild } from '../src/creature/breeding.js';
import { randomGenes } from '../src/creature/genes.js';
import {
  inheritSensitivity,
  normalizeSensitivity,
  randomSensitivity,
  sensitivityFromSeed,
  sensitivityLines,
} from '../src/creature/sensitivity.js';
import { SENSITIVITY, SENSITIVITY_KEYS } from '../src/tank/envConfig.js';
import { Tank } from '../src/tank/tank.js';
import { makeRng } from '../src/util/random.js';

const count = (s, level) => SENSITIVITY_KEYS.filter((k) => s[k] === level).length;

function expectFits(s) {
  expect(Object.keys(s).sort()).toEqual([...SENSITIVITY_KEYS].sort());
  expect(count(s, 'high')).toBeGreaterThanOrEqual(SENSITIVITY.HIGH_COUNT[0]);
  expect(count(s, 'high')).toBeLessThanOrEqual(SENSITIVITY.HIGH_COUNT[1]);
  expect(count(s, 'low')).toBeGreaterThanOrEqual(SENSITIVITY.LOW_COUNT[0]);
  expect(count(s, 'low')).toBeLessThanOrEqual(SENSITIVITY.LOW_COUNT[1]);
}

describe('環境の受けやすさ', () => {
  it('受けやすいものが1〜2個、受けにくいものが1〜2個、残りはふつう', () => {
    const seen = new Set();
    for (let s = 1; s < 500; s++) {
      const sens = randomSensitivity(makeRng(s));
      expectFits(sens);
      seen.add(`${count(sens, 'high')}${count(sens, 'low')}`);
    }
    expect(seen).toEqual(new Set(['11', '12', '21', '22']));
  });

  it('持っていない古いデータは seed から決まり、毎回同じ。保存し直すと残る', () => {
    const old = { id: 'a', seed: 12345, genes: { hue: 0.3 }, x: 0.4, z: 0.3, heading: 0 };
    const c = new Creature(old);
    expectFits(c.sensitivity);
    expect(c.sensitivity).toEqual(sensitivityFromSeed(12345));
    expect(new Creature(old).sensitivity).toEqual(c.sensitivity);
    const again = new Creature(JSON.parse(JSON.stringify(c.toJSON())));
    expect(again.sensitivity).toEqual(c.sensitivity);
    // 水槽ごと保存しても残る
    const tank = Tank.createNew('p');
    const loaded = Tank.fromData(JSON.parse(JSON.stringify(tank.toData())));
    expect(loaded.creatures.map((x) => x.sensitivity)).toEqual(tank.creatures.map((x) => x.sensitivity));
  });

  it('壊れている・決まりに合わないときは seed から決め直す', () => {
    expect(normalizeSensitivity({ light: 'high' }, 7)).toEqual(sensitivityFromSeed(7));
    const allHigh = Object.fromEntries(SENSITIVITY_KEYS.map((k) => [k, 'high']));
    expect(normalizeSensitivity(allHigh, 7)).toEqual(sensitivityFromSeed(7));
    expect(normalizeSensitivity('x', 7)).toEqual(sensitivityFromSeed(7));
    const ok = { light: 'high', brightness: 'low', soil: 'normal', plants: 'normal', current: 'normal' };
    expect(normalizeSensitivity(ok, 7)).toEqual(ok);
  });

  it('赤ちゃんは項目ごとに両親のどちらかを受け継ぎ、20%くらいで変わる', () => {
    const a = { light: 'high', brightness: 'low', soil: 'normal', plants: 'normal', current: 'normal' };
    const b = { light: 'high', brightness: 'low', soil: 'normal', plants: 'normal', current: 'normal' };
    let changed = 0;
    let total = 0;
    for (let s = 1; s < 800; s++) {
      const child = inheritSensitivity(a, b, makeRng(s));
      expectFits(child);
      for (const k of SENSITIVITY_KEYS) {
        total++;
        if (child[k] !== a[k]) changed++;
      }
    }
    const rate = changed / total;
    expect(rate).toBeGreaterThan(0.12);
    expect(rate).toBeLessThan(0.3);
  });

  it('交配で生まれる子は、受けやすさを持ち、決まりに合っている', () => {
    for (let s = 1; s < 100; s++) {
      const rng = makeRng(s);
      const child = makeChild(
        { genes: randomGenes(rng), quirks: [], sensitivity: randomSensitivity(rng) },
        { genes: randomGenes(rng), quirks: [], sensitivity: randomSensitivity(rng) },
        rng,
      );
      expectFits(child.sensitivity);
      expect(Creature.born({ ...child, x: 0.5, z: 0.5 }).sensitivity).toEqual(child.sensitivity);
    }
  });

  it('表示:ふつうは出さない', () => {
    const lines = sensitivityLines({ light: 'high', brightness: 'normal', soil: 'normal', plants: 'normal', current: 'low' });
    expect(lines).toEqual(['受けやすい:光の色', '受けにくい:水流']);
  });
});
