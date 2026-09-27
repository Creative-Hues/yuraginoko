import { describe, expect, it } from 'vitest';
import { VoiceLimiter, chirpPitch, normalizeSound } from '../src/audio/sound.js';
import { DEFAULTS, MASTER, SOUNDS } from '../src/audio/soundConfig.js';

describe('音の設定', () => {
  it('設定の無い人(前からいる人)は、音なし・初期の音量', () => {
    expect(normalizeSound(undefined)).toEqual({ ...DEFAULTS, on: false });
    expect(normalizeSound({})).toEqual({ ...DEFAULTS, on: false });
  });

  it('壊れた値は初期値に、音量は 0〜1 に収める', () => {
    expect(normalizeSound({ on: 'yes', ambient: 'x', effects: null })).toEqual({ on: false, ambient: DEFAULTS.ambient, effects: DEFAULTS.effects });
    expect(normalizeSound({ on: true, ambient: 3, effects: -1 })).toEqual({ on: true, ambient: 1, effects: 0 });
  });
});

describe('鳴き声の高さ', () => {
  it('同じ子はいつも同じ高さ。幅は ±spread 半音', () => {
    const limit = 2 ** (SOUNDS.chirp.spread / 12);
    for (let seed = 1; seed < 400; seed += 7) {
      const p = chirpPitch(seed);
      expect(chirpPitch(seed)).toBe(p);
      expect(p).toBeGreaterThanOrEqual(1 / limit);
      expect(p).toBeLessThanOrEqual(limit);
    }
    expect(new Set([1, 2, 3, 4, 5].map((s) => chirpPitch(s))).size).toBeGreaterThan(1);
  });
});

describe('重なりの上限', () => {
  it('同時に鳴る数の上限を超えない', () => {
    const lim = new VoiceLimiter(2, {});
    expect(lim.tryStart('a', 0)).toBe(true);
    expect(lim.tryStart('b', 0)).toBe(true);
    expect(lim.tryStart('c', 0)).toBe(false);
    lim.end();
    expect(lim.tryStart('c', 0)).toBe(true);
  });

  it('同じ音は minGap より詰めて鳴らさない', () => {
    const lim = new VoiceLimiter(10, { flick: 0.1 });
    expect(lim.tryStart('flick', 1)).toBe(true);
    expect(lim.tryStart('flick', 1.05)).toBe(false);
    expect(lim.tryStart('flick', 1.2)).toBe(true);
  });

  it('どの音も、立ち上がりがなめらかで、高すぎない', () => {
    for (const s of Object.values(SOUNDS)) {
      expect(s.attack).toBeGreaterThanOrEqual(MASTER.MIN_ATTACK);
      expect(s.gain).toBeLessThanOrEqual(0.5);
      const top = Math.max(s.freq, s.peak ?? 0, s.to ?? 0) * 2 ** ((Math.max(0, ...(s.notes ?? [0])) + (s.spread ?? 0)) / 12);
      if (s.type !== 'noise') expect(top).toBeLessThanOrEqual(MASTER.FREQ_MAX);
    }
  });
});
