import { describe, expect, it } from 'vitest';
import {
  GENE_DEFS,
  GENE_KEYS,
  TRAIT_KEYS,
  TOUCH_DRIFT,
  applyTouchDrift,
  expressGenes,
  normalizeGenes,
  randomGenes,
} from '../src/creature/genes.js';
import { makeRng } from '../src/util/random.js';
import { Creature } from '../src/creature/creature.js';
import { PATTERN_TYPES, mainPattern, movePattern, patternFromValue, patternLayers, solidPattern } from '../src/creature/pattern.js';

const layerTypes = (p) => patternLayers(p).map((l) => l.type);

describe('遺伝子', () => {
  it('環境で変わる遺伝子は9項目(模様は種類として別に持つ)、特徴遺伝子は5項目。すべて 0〜1', () => {
    expect(GENE_KEYS).toHaveLength(9);
    expect(GENE_KEYS).not.toContain('pattern');
    expect(TRAIT_KEYS).toHaveLength(5);
    expect(GENE_KEYS.filter((k) => TRAIT_KEYS.includes(k))).toEqual([]);
    const g = randomGenes(makeRng(42));
    for (const key of GENE_KEYS) {
      expect(g[key]).toBeGreaterThanOrEqual(0);
      expect(g[key]).toBeLessThanOrEqual(1);
    }
  });

  it('同じシードからは同じ遺伝子ができる', () => {
    expect(randomGenes(makeRng(7))).toEqual(randomGenes(makeRng(7)));
  });

  it('揺らぎは指定の幅に収まり、時間で少しずつ変わる', () => {
    const g = { ...randomGenes(makeRng(1)), bodyLength: 0.5, spikeLength: 0.5 };
    const seen = new Set();
    for (let t = 0; t < 300; t += 1.7) {
      const e = expressGenes(g, t, 1234);
      for (const def of GENE_DEFS) {
        if (def.wrap) continue;
        expect(Math.abs(e[def.key] - g[def.key])).toBeLessThanOrEqual(def.wobble + 1e-9);
      }
      seen.add(e.bodyLength.toFixed(4));
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('色相は 0 と 1 がつながっている', () => {
    const g = { ...randomGenes(makeRng(2)), hue: 0.001 };
    for (let t = 0; t < 100; t += 3) {
      const e = expressGenes(g, t, 99);
      expect(e.hue).toBeGreaterThanOrEqual(0);
      expect(e.hue).toBeLessThan(1);
    }
  });

  it('古い保存データに足りない項目は補い、ある項目はそのまま使う', () => {
    const old = { bodyLength: 0.25, hue: 0.8 };
    const g = normalizeGenes(old, makeRng(3));
    expect(g.bodyLength).toBe(0.25);
    expect(g.hue).toBe(0.8);
    for (const key of GENE_KEYS) expect(typeof g[key]).toBe('number');
  });

  it('撫でると透明度が +0.005、弾くと突起の長さが -0.005', () => {
    const g = { ...randomGenes(makeRng(4)), translucency: 0.5, spikeLength: 0.5 };
    expect(TOUCH_DRIFT.stroke.translucency).toBe(0.005);
    applyTouchDrift(g, 'stroke');
    expect(g.translucency).toBeCloseTo(0.505, 10);
    applyTouchDrift(g, 'flick');
    expect(g.spikeLength).toBeCloseTo(0.495, 10);
  });

  it('触れ合いの変化は 0〜1 からはみ出さない', () => {
    const g = { ...randomGenes(makeRng(5)), translucency: 0.998, spikeLength: 0.002 };
    applyTouchDrift(g, 'stroke');
    applyTouchDrift(g, 'flick');
    expect(g.translucency).toBe(1);
    expect(g.spikeLength).toBe(0);
    expect(applyTouchDrift(g, 'stroke')).toBe(false);
  });

  it('古いデータの模様の数字は、そのとき見えていた模様(境目では隣と少し混ざる)として読む', () => {
    expect(mainPattern(patternFromValue(0.1))).toBe('spots');
    expect(mainPattern(patternFromValue(0.4))).toBe('stripes');
    expect(mainPattern(patternFromValue(0.6))).toBe('net');
    expect(mainPattern(patternFromValue(0.9))).toBe('gradient');
    expect(patternFromValue(0.125)).toEqual({ spots: 1, stripes: 0, net: 0, gradient: 0 });
    const edge = patternFromValue(0.249);
    expect(edge.stripes).toBeGreaterThan(0);
    expect(edge.spots + edge.stripes).toBeCloseTo(1, 9);
    // 遺伝子の中からは外れ、生き物の模様として読まれる
    expect(normalizeGenes({ pattern: 0.6 }, makeRng(1)).pattern).toBeUndefined();
    const c = new Creature({ id: 'x', seed: 3, genes: { pattern: 0.6 } });
    expect(mainPattern(c.pattern)).toBe('net');
    expect(c.toJSON().pattern).toEqual({ net: 1 });
    expect(c.toJSON().genes.pattern).toBeUndefined();
  });

  it('模様は種類として移り変わる。目標の模様が濃くなり、ほかは同じ割合で薄れる(途中でほかの模様を通らない)', () => {
    const p = solidPattern('spots');
    for (let i = 0; i < 50; i++) {
      movePattern(p, 'net', 0.03);
      expect(p.stripes).toBe(0);
      expect(p.gradient).toBe(0);
      expect(p.spots + p.net).toBeCloseTo(1, 9);
    }
    expect(p).toEqual(solidPattern('net'));
    // 混ざっているところから別の模様へ:今ある2つが同じ割合で薄れる
    const q = { spots: 0.6, stripes: 0, net: 0.4, gradient: 0 };
    movePattern(q, 'gradient', 0.5);
    expect(q.gradient).toBeCloseTo(0.5, 9);
    expect(q.spots / q.net).toBeCloseTo(1.5, 9);
    // 小分けにしても、まとめても同じ
    const a = { spots: 0.7, stripes: 0.3, net: 0, gradient: 0 };
    const b = { ...a };
    movePattern(a, 'net', 0.2);
    for (let i = 0; i < 4; i++) movePattern(b, 'net', 0.05);
    for (const k of PATTERN_TYPES) expect(b[k]).toBeCloseTo(a[k], 9);
    expect(layerTypes({ spots: 0.995, net: 0.005, stripes: 0, gradient: 0 })).toEqual(['spots']);
  });
});

import { DIGEST_STEP, FOODS, FOOD_KEYS, foodDrift, nudgeGenes } from '../src/creature/genes.js';

describe('エサ', () => {
  it('4種類あり、どれも1回で動くのは DIGEST_STEP 以内', () => {
    expect(FOOD_KEYS).toEqual(['red', 'blue', 'yellow', 'glow']);
    const g = randomGenes(makeRng(3));
    for (const key of FOOD_KEYS) {
      for (const v of Object.values(foodDrift(g, key))) expect(Math.abs(v)).toBeLessThanOrEqual(DIGEST_STEP + 1e-12);
    }
  });

  it('色のエサは、目標の色へ近いほうの回り方で寄せる', () => {
    // 色相 0.9 から赤(0)へは、+方向(0 をまたぐ)のほうが近い
    expect(foodDrift({ hue: 0.9, glow: 0 }, 'red').hue).toBeCloseTo(DIGEST_STEP);
    expect(foodDrift({ hue: 0.1, glow: 0 }, 'red').hue).toBeCloseTo(-DIGEST_STEP);
    // ほとんど着いていれば、その差だけ
    expect(foodDrift({ hue: 0.61, glow: 0 }, 'blue').hue).toBeCloseTo(0.01);
    const g = { ...randomGenes(makeRng(1)), hue: 0.99 };
    nudgeGenes(g, foodDrift(g, 'yellow')); // 0.99 → 0.16 は +方向。1 をまたいで 0.07 に
    expect(g.hue).toBeCloseTo(0.07);
  });

  it('光るエサは光り方を強くし、1を超えない', () => {
    expect(foodDrift({ hue: 0.3, glow: 0.5 }, 'glow')).toEqual({ glow: DIGEST_STEP });
    expect(foodDrift({ hue: 0.3, glow: 0.99 }, 'glow').glow).toBeCloseTo(0.01);
    expect(FOODS.glow.hueToward).toBeUndefined();
  });
});

import { DIGEST_EFFECT_TYPES } from '../src/creature/digestEffects.js';

describe('消化のエフェクト', () => {
  it('どのエサにも、ある種類のエフェクトと色が決まっている', () => {
    for (const key of FOOD_KEYS) {
      const d = FOODS[key].digest;
      expect(DIGEST_EFFECT_TYPES).toContain(d.effect);
      expect(d.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // 4種類とも違うエフェクト
    expect(new Set(FOOD_KEYS.map((k) => FOODS[k].digest.effect)).size).toBe(4);
  });
});
