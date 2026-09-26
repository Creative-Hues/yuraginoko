// 生き物1匹。遺伝子と、水槽の中での位置・行動・触れ合いの状態を持つ。
import { applyTouchDrift, expressGenes, normalizeGenes, randomGenes } from './genes.js';
import { createBehavior, updateBehavior } from './behavior.js';
import { bodyPoints, createBody, updateBody } from './body.js';
import { makeId, makeRng, randomSeed } from '../util/random.js';
import { clamp, smoothstep } from '../util/math.js';

// 撫でたと数えるのに必要な、生き物の上をなぞった距離(px)
const STROKE_MIN_DIST = 24;
const GLOW_LIFE = 1.2; // 撫でた場所の光が消えるまで(秒)

export class Creature {
  constructor(data) {
    this.id = data.id;
    this.seed = data.seed;
    this.genes = normalizeGenes(data.genes, makeRng(this.seed));
    // x, z は頭の位置。古い保存データ(dir で左右だけ持っていた)も読めるようにする
    this.x = clamp(data.x ?? 0.5, 0.05, 0.95);
    this.z = clamp(data.z ?? 0.5);
    this.heading = typeof data.heading === 'number' ? data.heading : data.dir === -1 ? Math.PI : 0;

    // ここから下は保存しない(開き直すと、底を這うところから始まる)
    this.lift = 0;
    this.phase = Math.random() * 10;
    this.behavior = createBehavior();
    this.body = createBody(this.heading);
    this.points = bodyPoints(this.body, this.x, this.z);
    this.expressed = expressGenes(this.genes, 0, this.seed);
    this.touch = {
      clear: 0, // 一時的に透ける量
      sinceStroke: 99,
      strokeDist: 0,
      glows: [], // 撫でた場所の光 { u, age }
      waveBoost: 0, // 撫でたときの、体のゆるい波
      waveOrigin: 0.5,
      shrink: 0, // 突起の縮み(ばねのように戻る)
      shrinkVel: 0,
      cringe: 0, // 体のすくみ
    };
    this.screen = null; // 描画時に画面上の体の形が入る(当たり判定用)
    this.canvas = null; // 描画用の下書きキャンバス
    this.scratch = null;
    this.onChange = null;
  }

  static create(opts = {}) {
    const seed = randomSeed();
    return new Creature({
      id: makeId(),
      seed,
      genes: randomGenes(makeRng(seed)),
      x: opts.x ?? 0.3 + Math.random() * 0.4,
      z: opts.z ?? Math.random(),
      heading: Math.random() < 0.5 ? Math.PI : 0,
    });
  }

  update(dt, t) {
    this.expressed = expressGenes(this.genes, t, this.seed, this.expressed);
    updateBehavior(this, this.expressed, dt);
    updateBody(this.body, this.heading, dt);

    const tc = this.touch;
    tc.sinceStroke += dt;
    if (tc.sinceStroke > 0.5) tc.clear = Math.max(0, tc.clear - dt * 0.45);
    tc.waveBoost = Math.max(0, tc.waveBoost - dt * 0.6);
    tc.cringe = Math.max(0, tc.cringe - dt * 0.8);
    // ばね:きゅっと縮んで、少し弾むように戻る
    tc.shrinkVel += (-14 * tc.shrink - 4.5 * tc.shrinkVel) * dt;
    tc.shrink += tc.shrinkVel * dt;
    for (const g of tc.glows) g.age += dt;
    if (tc.glows.length && tc.glows[0].age > GLOW_LIFE) tc.glows = tc.glows.filter((g) => g.age < GLOW_LIFE);

    this.points = bodyPoints(this.body, this.x, this.z, 1 - 0.12 * smoothstep(tc.cringe), this.points);
  }

  // 撫でている最中。dist は指が動いた距離(px)、u は触れた体の場所(0 = しっぽ〜1 = 頭)
  stroke(dist, u = 0.5) {
    const tc = this.touch;
    tc.clear = clamp(tc.clear + dist * 0.02);
    tc.sinceStroke = 0;
    tc.strokeDist += dist;
    tc.waveBoost = 1;
    tc.waveOrigin = u;
    const last = tc.glows[tc.glows.length - 1];
    if (!last || last.age > 0.15 || Math.abs(last.u - u) > 0.1) tc.glows.push({ u, age: 0 });
  }

  // 指が離れたとき。十分なぞっていれば、1回撫でたとして遺伝子を少し動かす
  endStroke() {
    const counted = this.touch.strokeDist >= STROKE_MIN_DIST;
    this.touch.strokeDist = 0;
    if (counted && applyTouchDrift(this.genes, 'stroke')) this.onChange?.();
  }

  flick() {
    const tc = this.touch;
    tc.shrink = 1;
    tc.shrinkVel = 0;
    tc.cringe = 1;
    if (applyTouchDrift(this.genes, 'flick')) this.onChange?.();
  }

  toJSON() {
    return {
      id: this.id,
      seed: this.seed,
      genes: { ...this.genes },
      x: this.x,
      z: this.z,
      heading: this.heading,
    };
  }
}
