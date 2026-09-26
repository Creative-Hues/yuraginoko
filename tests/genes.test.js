import { describe, expect, it } from 'vitest';
import {
  GENE_DEFS,
  GENE_KEYS,
  TOUCH_DRIFT,
  applyTouchDrift,
  expressGenes,
  normalizeGenes,
  patternMix,
  randomGenes,
} from '../src/creature/genes.js';
import { makeRng } from '../src/util/random.js';

describe('遺伝子', () => {
  it('12項目あり、すべて 0〜1', () => {
    expect(GENE_KEYS).toHaveLength(12);
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
    const g = { ...randomGenes(makeRng(1)), bodyLength: 0.5, spikeCount: 0.5 };
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

  it('模様は4種類に分かれ、境目では隣と混ざる', () => {
    expect(patternMix(0.1).main).toBe('spots');
    expect(patternMix(0.4).main).toBe('stripes');
    expect(patternMix(0.6).main).toBe('net');
    expect(patternMix(0.9).main).toBe('gradient');
    expect(patternMix(0.125).amount).toBe(0);
    const edge = patternMix(0.249);
    expect(edge.other).toBe('stripes');
    expect(edge.amount).toBeGreaterThan(0);
  });
});
