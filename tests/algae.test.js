import { describe, expect, it } from 'vitest';
import { ALGAE, Algae, calmFor, growthAmount, growthDays } from '../src/tank/algae.js';

describe('藻', () => {
  it('閉じていた日数で増え、14日以上は同じ量で止まる', () => {
    expect(growthAmount(0)).toBe(0);
    expect(growthAmount(3)).toBeCloseTo(0.25);
    expect(growthAmount(7)).toBeCloseTo(0.65);
    expect(growthAmount(14)).toBe(1);
    expect(growthAmount(30)).toBe(1);
    expect(growthAmount(2)).toBeLessThan(growthAmount(3));
  });

  it('量から日数に戻せる', () => {
    for (const d of [0.5, 2, 5, 10]) expect(growthDays(growthAmount(d))).toBeCloseTo(d, 6);
  });

  it('全体の汚れ具合は日数とともに増え、上限を超えない', () => {
    const levels = [3, 7, 14, 30].map((d) => {
      const a = new Algae(null, 123);
      a.grow(d);
      return a.level;
    });
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[0]).toBeLessThan(levels[1]);
    expect(levels[1]).toBeLessThan(levels[2]);
    expect(levels[3]).toBeCloseTo(levels[2], 6);
    expect(levels[3]).toBeLessThanOrEqual(1);
  });

  it('何回かに分けて閉じても、まとめて閉じたのと同じだけ増える', () => {
    const a = new Algae(null, 5);
    a.grow(2);
    a.grow(3);
    const b = new Algae(null, 5);
    b.grow(5);
    expect(a.level).toBeCloseTo(b.level, 5);
  });

  it('擦ると減り、一部を消したところも次に開いたとき続きから育つ', () => {
    const a = new Algae(null, 9);
    a.grow(14);
    const full = a.level;
    for (let x = 0.1; x <= 0.9; x += 0.02) a.erase(x, 0.5, ALGAE.BRUSH / 2, ALGAE.BRUSH, 0.5);
    expect(a.level).toBeLessThan(full);
    const cleaned = a.level;
    a.grow(3);
    expect(a.level).toBeGreaterThan(cleaned);
    expect(a.level).toBeLessThanOrEqual(full + 1e-6);
  });

  it('保存して読み込むと同じ量に戻る。形が違うデータは藻なしから', () => {
    const a = new Algae(null, 42);
    a.grow(7);
    const b = new Algae(a.toData(), 42);
    expect(b.level).toBeCloseTo(a.level, 3);
    expect(new Algae({ w: 3, h: 3, cells: [1, 1, 1] }, 42).level).toBe(0);
    expect(new Algae(undefined, 42).level).toBe(0);
  });

  it('藻が多いほど動きがゆっくり', () => {
    expect(calmFor(0)).toBe(1);
    expect(calmFor(1)).toBe(ALGAE.CALM_MIN);
    expect(calmFor(0.5)).toBeLessThan(1);
  });
});

describe('掃除', () => {
  it('擦ると、見えないほど薄い残りまで消しきれる', () => {
    const a = new Algae(null, 11);
    a.grow(14);
    expect(a.hasVisible()).toBe(true);
    // 画面全体を、弱めの力で何往復か擦る
    for (let pass = 0; pass < 8; pass++) {
      for (let y = 0; y <= 1; y += 0.05) for (let x = 0; x <= 1; x += 0.03) a.erase(x, y, 0.05, 0.1, 0.2);
    }
    expect(a.hasVisible()).toBe(false);
    expect(a.level).toBe(0);
  });

  it('見えない薄い藻だけのときは「見える藻はない」', () => {
    const a = new Algae(null, 3);
    a.grow(0.5); // 半日ぶん:どのマスも見える濃さに届かない
    expect(a.level).toBeGreaterThan(0);
    expect(a.hasVisible()).toBe(false);
    a.grow(7);
    expect(a.hasVisible()).toBe(true);
  });
});
