import { describe, expect, it } from 'vitest';
import { Creature } from '../src/creature/creature.js';
import { TRAIT_KEYS } from '../src/creature/genes.js';
import { TRAITS } from '../src/creature/lifeConfig.js';
import { hasBlink, inheritTraits, normalizeTraits, randomTraits, traitLines, traitsFromSeed } from '../src/creature/traits.js';
import { makeRng } from '../src/util/random.js';

const { BLINK } = TRAITS;
const base = (over = {}) => ({ spikeCount: 0.5, wriggliness: 0.5, tailLength: 0.5, antennaLength: 0.5, blink: 0, ...over });

// 突然変異なしで受け継ぐ
const inheritPlain = (a, b, rng) => inheritTraits(a, b, rng, 0);

describe('特徴遺伝子', () => {
  it('今いる生き物:突起の数と泳ぎ方の激しさは今の値を引き継ぎ、ほかは seed から。前の特徴(にじみなど)はなくなる', () => {
    const old = {
      id: 'a',
      seed: 99,
      genes: { hue: 0.3, spikeCount: 0.81, wriggliness: 0.12 },
      quirks: [{ type: 'notch', u: 0.5, size: 0.7, seed: 1 }],
      parents: [{ id: 'p', seed: 1, genes: { spikeCount: 0.2 }, quirks: [{ type: 'smudge' }] }],
      x: 0.4,
      z: 0.3,
      heading: 0,
    };
    const c = new Creature(old);
    expect(c.traits.spikeCount).toBe(0.81);
    expect(c.traits.wriggliness).toBe(0.12);
    const seeded = traitsFromSeed(99);
    for (const k of ['tailLength', 'antennaLength', 'blink']) expect(c.traits[k]).toBe(seeded[k]);
    expect(c.genes.spikeCount).toBeUndefined();
    expect(c.genes.wriggliness).toBeUndefined();
    expect(c.quirks).toBeUndefined();
    const saved = JSON.parse(JSON.stringify(c.toJSON()));
    expect(saved.quirks).toBeUndefined();
    expect(saved.parents[0].quirks).toBeUndefined();
    expect(new Creature(saved).traits).toEqual(c.traits);
    // 同じデータからは、毎回同じ
    expect(new Creature(old).traits).toEqual(c.traits);
  });

  it('最初の2匹:点滅する光模様は 40% くらいが弱めに持つ', () => {
    let has = 0;
    const N = 2000;
    const rng = makeRng(3);
    for (let i = 0; i < N; i++) {
      const t = randomTraits(rng);
      for (const k of TRAIT_KEYS) {
        expect(t[k]).toBeGreaterThanOrEqual(0);
        expect(t[k]).toBeLessThanOrEqual(1);
      }
      if (hasBlink(t)) {
        has++;
        expect(t.blink).toBeGreaterThanOrEqual(BLINK.FIRST[0]);
        expect(t.blink).toBeLessThanOrEqual(BLINK.FIRST[1]);
      } else {
        expect(t.blink).toBe(0);
      }
    }
    expect(has / N).toBeGreaterThan(0.35);
    expect(has / N).toBeLessThan(0.45);
  });

  it('数値の特徴は両親の中間を少しゆらした値', () => {
    for (let s = 1; s < 200; s++) {
      const { traits } = inheritPlain(base({ tailLength: 0.2 }), base({ tailLength: 0.8 }), makeRng(s));
      expect(Math.abs(traits.tailLength - 0.5)).toBeLessThanOrEqual(TRAITS.MIX_JITTER + 1e-9);
    }
  });

  it('点滅する光模様:両親とも→ほぼ必ず、片方だけ→半分、どちらも無し→出ない(突然変異がなければ)', () => {
    const N = 2000;
    const count = (a, b) => {
      let n = 0;
      let sum = 0;
      for (let s = 1; s <= N; s++) {
        const { traits } = inheritPlain(a, b, makeRng(s));
        if (hasBlink(traits)) {
          n++;
          sum += traits.blink;
        }
      }
      return { rate: n / N, avg: sum / Math.max(1, n) };
    };
    const both = count(base({ blink: 0.4 }), base({ blink: 0.6 }));
    expect(both.rate).toBeGreaterThan(0.9);
    expect(both.avg).toBeCloseTo(0.5, 1);
    const one = count(base({ blink: 0.5 }), base());
    expect(one.rate).toBeGreaterThan(0.44);
    expect(one.rate).toBeLessThan(0.56);
    expect(one.avg).toBeCloseTo(0.5 * BLINK.ONE_SCALE, 5);
    expect(count(base(), base()).rate).toBe(0);
  });

  it('突然変異は 30% くらいで1つ。数値は中間から大きく離れ、光模様は出る/強くなる/弱くなる', () => {
    const N = 3000;
    let mutated = 0;
    const changes = new Set();
    for (let s = 1; s <= N; s++) {
      const { traits, mutation } = inheritTraits(base({ blink: 0.5 }), base({ blink: 0.5 }), makeRng(s));
      if (!mutation) continue;
      mutated++;
      if (mutation.key === 'blink') {
        changes.add(mutation.change);
        expect(traits.blink).toBeGreaterThanOrEqual(BLINK.HAS); // 弱くなっても消えない
      } else {
        expect(Math.abs(traits[mutation.key] - 0.5)).toBeGreaterThanOrEqual(TRAITS.JUMP[0] - 1e-9);
      }
    }
    expect(mutated / N).toBeGreaterThan(0.26);
    expect(mutated / N).toBeLessThan(0.34);
    expect(changes.has('stronger')).toBe(true);
    expect(changes.has('weaker')).toBe(true);
    // 持っていない両親からは、突然変異で新しく出ることがある
    let appeared = 0;
    for (let s = 1; s <= N; s++) {
      const { traits, mutation } = inheritTraits(base(), base(), makeRng(s));
      if (mutation?.change === 'appear') {
        appeared++;
        expect(traits.blink).toBeGreaterThanOrEqual(BLINK.APPEAR[0]);
      } else {
        expect(hasBlink(traits)).toBe(false);
      }
    }
    expect(appeared).toBeGreaterThan(0);
  });

  it('撫でる・弾く・エサでは変わらない', () => {
    const c = Creature.create();
    const before = { ...c.traits };
    c.stroke(100);
    c.endStroke();
    c.flick();
    c.meal = { stage: 'fed', food: 'glow' };
    c.digest();
    c.updateDigest(100);
    expect(c.traits).toEqual(before);
  });

  it('標本画面の「生まれつきの特徴」', () => {
    expect(traitLines(base({ spikeCount: 0.9, wriggliness: 0.1, tailLength: 0.5, antennaLength: 0.7, blink: 0.3 }))).toEqual([
      { label: '突起の数', text: '多い' },
      { label: '泳ぎ方', text: 'おだやか' },
      { label: '尾', text: 'ふつう' },
      { label: '触角', text: '長い' },
      { label: '点滅する光', text: '控えめ' },
    ]);
    expect(normalizeTraits(null, { spikeCount: 0.3 }, 5).spikeCount).toBe(0.3);
  });
});
