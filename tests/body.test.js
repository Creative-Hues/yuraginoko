import { describe, expect, it, vi } from 'vitest';
import { angleDiff, bodyPoints, createBody, updateBody, BODY_WORLD_LENGTH } from '../src/creature/body.js';
import { startTurn } from '../src/creature/behavior.js';
import { Creature } from '../src/creature/creature.js';
import { GENE_KEYS } from '../src/creature/genes.js';
import { makeRng } from '../src/util/random.js';

const DT = 1 / 60;

describe('体の節とUターン', () => {
  it('まっすぐのときは、頭からしっぽまで体の長さぶん伸びている', () => {
    const body = createBody(0);
    const pts = bodyPoints(body, 0.5, 0.5);
    expect(pts[0].x).toBeCloseTo(0.5);
    expect(pts[0].x - pts[pts.length - 1].x).toBeCloseTo(BODY_WORLD_LENGTH);
  });

  it('頭が先に曲がり、しっぽは遅れてついてくる', () => {
    const body = createBody(0);
    for (let t = 0; t < 0.5; t += DT) updateBody(body, Math.PI * Math.min(1, t / 1.5), DT);
    const a = body.angles;
    expect(Math.abs(a[0])).toBeGreaterThan(Math.abs(a[a.length - 1]) + 0.3);
  });

  it('頭が1.5秒で向きを変えると、およそ2.5秒で体全体が反対を向く', () => {
    const body = createBody(0);
    for (let t = 0; t < 2.5; t += DT) updateBody(body, Math.PI * Math.min(1, t / 1.5), DT);
    for (const a of body.angles) expect(Math.abs(angleDiff(Math.PI, a))).toBeLessThan(0.25);
  });

  it('Uターンでは向きが反対になり、途中で奥行きも変わる', () => {
    // 乱数を固定して、毎回同じ動きにする(行動の切り替えや Uターンの長さに乱数を使っているため)
    const random = vi.spyOn(Math, 'random').mockImplementation(makeRng(2024));
    try {
      const genes = Object.fromEntries(GENE_KEYS.map((k) => [k, 0.5]));
      const c = new Creature({ id: 't', seed: 1, genes, x: 0.5, z: 0.3, heading: 0 });
      c.behavior.duration = 99; // 途中で別の行動に移らないように
      startTurn(c);
      const z0 = c.z;
      let maxDz = 0;
      for (let t = 0; t < 3; t += DT) {
        c.update(DT, t);
        maxDz = Math.max(maxDz, Math.abs(c.z - z0));
      }
      expect(Math.cos(c.heading)).toBeLessThan(-0.8);
      expect(maxDz).toBeGreaterThan(0.03);
    } finally {
      random.mockRestore();
    }
  });

  it('前の保存データ(左右の向き dir だけ)も読み込める', () => {
    const c = new Creature({ id: 'a', seed: 1, genes: {}, x: 0.4, z: 0.2, dir: -1 });
    expect(c.heading).toBeCloseTo(Math.PI);
    expect(c.toJSON().heading).toBeCloseTo(Math.PI);
  });
});
