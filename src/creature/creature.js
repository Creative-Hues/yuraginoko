// 生き物1匹。遺伝子と、水槽の中での位置・行動・触れ合い・食事の状態を持つ。
import {
  DIGEST_SECONDS,
  FOODS,
  MEAL_REST_SECONDS,
  applyTouchDrift,
  expressGenes,
  foodDrift,
  normalizeGenes,
  nudgeGenes,
  randomGenes,
} from './genes.js';
import { createBehavior, pauseBehavior, startSeek, stopSeek, updateBehavior } from './behavior.js';
import { bodyPoints, createBody, updateBody } from './body.js';
import { makeId, makeRng, randomSeed } from '../util/random.js';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { normalizeQuirks } from './breeding.js';
import { GROW } from './lifeConfig.js';

// 撫でたと数えるのに必要な、生き物の上をなぞった距離(px)
const STROKE_MIN_DIST = 24;
const GLOW_LIFE = 1.2; // 撫でた場所の光が消えるまで(秒)
const EXCRETE_PAUSE = 2; // 排泄するとき、その場で止まる時間(秒)

// 食事の段階:エサを選ぶ → 向かって食べる → 消化させる → 消化中 → 排泄させる → 休む → エサを選ぶ …
export const MEAL = {
  ready: 'ready', // エサを選べる
  seeking: 'seeking', // エサに向かっている
  fed: 'fed', // 食べ終わった(消化させられる)
  digesting: 'digesting', // 消化中(色がゆっくり変わる)
  digested: 'digested', // 消化し終わった(排泄させられる)
  resting: 'resting', // 1周して休んでいる
};

// 保存されていた食事の状態を読み込む。古いデータ(無い)や、壊れているときは「エサを選べる」から
function loadMeal(saved) {
  const stage = saved?.stage;
  const food = FOODS[saved?.food] ? saved.food : null;
  if (!MEAL[stage] || stage === MEAL.ready) return { stage: MEAL.ready };
  if (stage === MEAL.resting) {
    const restUntil = Number(saved.restUntil);
    return Number.isFinite(restUntil) ? { stage, restUntil } : { stage: MEAL.ready };
  }
  if (!food) return { stage: MEAL.ready };
  // 向かっている途中で閉じたときは、食べ終わったことにする
  if (stage === MEAL.seeking) return { stage: MEAL.fed, food };
  if (stage === MEAL.digesting) {
    const drift = saved.drift && typeof saved.drift === 'object' ? { ...saved.drift } : {};
    return { stage, food, drift, progress: clamp(Number(saved.progress) || 0) };
  }
  return { stage, food };
}

export class Creature {
  constructor(data) {
    this.id = data.id;
    this.seed = data.seed;
    this.genes = normalizeGenes(data.genes, makeRng(this.seed));
    // x, z は頭の位置。古い保存データ(dir で左右だけ持っていた)も読めるようにする
    this.x = clamp(data.x ?? 0.5, 0.05, 0.95);
    this.z = clamp(data.z ?? 0.5);
    this.heading = typeof data.heading === 'number' ? data.heading : data.dir === -1 ? Math.PI : 0;
    this.meal = loadMeal(data.meal);
    // 生まれてからの育ち具合(0 = 生まれたて〜1 = 大人)。古いデータには無いので、大人
    this.growth = typeof data.growth === 'number' && Number.isFinite(data.growth) ? clamp(data.growth) : 1;
    this.quirks = normalizeQuirks(data.quirks); // 変異で生えた特徴(にじみ・欠け・余分な突起)
    this.mutations = Array.isArray(data.mutations) ? data.mutations.filter((m) => m && typeof m === 'object').map((m) => ({ ...m })) : [];
    // 両親の写し(わかる場合)。標本画面で親の姿を出す
    this.parents = Array.isArray(data.parents) ? data.parents.filter((p) => p && typeof p === 'object' && p.genes).slice(0, 2) : [];
    this.bornAt = Number(data.bornAt) || null;

    // ここから下は保存しない(開き直すと、底を這うところから始まる)
    this.lift = 0;
    this.phase = Math.random() * 10;
    this.clock = Math.random() * 100; // 体の揺れ用の時計(ゆっくりのときは遅く進む)
    this.pace = 1; // 動きの速さの倍率
    this.behavior = createBehavior();
    this.body = createBody(this.heading);
    this.points = bodyPoints(this.body, this.x, this.z, this.size);
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
    this.meet = null; // 触れ合っている最中 { partner, t, seconds }
    this.shift = null; // 環境で変わっている途中 { drift, progress, seconds }
    this.shiftGlow = 0; // 変わる瞬間の、体の光(1 → 0)
    this.shiftGlowSeconds = 1;
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

  // 交配で生まれた赤ちゃん
  static born({ genes, quirks, mutations, parents, x, z, heading }) {
    return new Creature({
      id: makeId(),
      seed: randomSeed(),
      genes,
      quirks,
      mutations,
      parents,
      bornAt: Date.now(),
      growth: 0,
      x,
      z,
      heading: heading ?? (Math.random() < 0.5 ? Math.PI : 0),
    });
  }

  // 体の大きさ(大人 = 1)。育つにつれて、なめらかに大きくなる
  get size() {
    return lerp(GROW.BABY_SIZE, 1, smoothstep(this.growth));
  }

  get adult() {
    return this.growth >= 1;
  }

  update(dt, t) {
    this.clock += dt * this.pace;
    if (this.growth < 1) {
      this.growth = Math.min(1, this.growth + dt / GROW.SECONDS);
      this.onChange?.();
    }
    if (this.meet) {
      this.meet.t += dt;
      if (this.meet.t >= this.meet.seconds) this.meet = null;
    }
    this.expressed = expressGenes(this.genes, t, this.seed, this.expressed);
    updateBehavior(this, this.expressed, dt);
    if (!(this.behavior.pause > 0)) updateBody(this.body, this.heading, dt); // 止まっている間は、体の形もそのまま
    this.updateDigest(dt);
    this.updateShift(dt);

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

    this.points = bodyPoints(this.body, this.x, this.z, this.size * (1 - 0.12 * smoothstep(tc.cringe)), this.points);
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

  // ---- 環境による変化 ----

  // 遺伝子を drift だけ、seconds 秒かけて変える。体は glowSeconds 秒ふわっと光る
  shiftGenes(drift, seconds, glowSeconds) {
    this.finishShift();
    this.shift = { drift, progress: 0, seconds };
    this.shiftGlow = 1;
    this.shiftGlowSeconds = glowSeconds;
    this.onChange?.();
  }

  // 変わっている途中なら、残りをすぐに変えきる
  finishShift() {
    const s = this.shift;
    if (!s) return;
    nudgeGenes(this.genes, s.drift, 1 - s.progress);
    this.shift = null;
  }

  updateShift(dt) {
    this.shiftGlow = Math.max(0, this.shiftGlow - dt / this.shiftGlowSeconds);
    const s = this.shift;
    if (!s) return;
    const next = Math.min(1, s.progress + dt / s.seconds);
    nudgeGenes(this.genes, s.drift, next - s.progress);
    s.progress = next;
    if (next >= 1) this.shift = null;
    this.onChange?.();
  }

  // ---- 食事 ----

  // 休み終わっていれば「エサを選べる」に戻す。now はミリ秒の時刻
  refreshMeal(now = Date.now()) {
    if (this.meal.stage === MEAL.resting && now >= this.meal.restUntil) {
      this.meal = { stage: MEAL.ready };
      this.onChange?.();
    }
  }

  // 休みの進み具合(0 = 休み始め〜1 = 休み終わり)。休んでいなければ 1
  restProgress(now = Date.now()) {
    if (this.meal.stage !== MEAL.resting) return 1;
    return clamp(1 - (this.meal.restUntil - now) / (MEAL_REST_SECONDS * 1000));
  }

  // エサ (x, z) に向かい始める
  seekFood(food, x, z) {
    if (this.meal.stage !== MEAL.ready || !FOODS[food]) return false;
    this.meal = { stage: MEAL.seeking, food };
    startSeek(this, x, z);
    this.onChange?.();
    return true;
  }

  // エサを食べ終わった
  ate() {
    if (this.meal.stage !== MEAL.seeking) return;
    stopSeek(this);
    this.meal = { stage: MEAL.fed, food: this.meal.food };
    this.onChange?.();
  }

  digest() {
    if (this.meal.stage !== MEAL.fed) return false;
    const food = this.meal.food;
    this.meal = { stage: MEAL.digesting, food, drift: foodDrift(this.genes, food), progress: 0 };
    this.onChange?.();
    return true;
  }

  // 消化中は、数秒かけて遺伝子の基本値を少しずつ動かす
  updateDigest(dt) {
    const m = this.meal;
    if (m.stage !== MEAL.digesting) return;
    const next = Math.min(1, m.progress + dt / DIGEST_SECONDS);
    nudgeGenes(this.genes, m.drift, next - m.progress);
    m.progress = next;
    if (next >= 1) this.meal = { stage: MEAL.digested, food: m.food };
    this.onChange?.();
  }

  // 排泄させて、休みに入る。その場で少し止まって、体がきゅっと縮む。
  // 粒を出す場所(しっぽの先)と、押し出す向き、食べたエサを返す
  excrete(now = Date.now()) {
    if (this.meal.stage !== MEAL.digested) return null;
    const food = this.meal.food;
    this.meal = { stage: MEAL.resting, restUntil: now + MEAL_REST_SECONDS * 1000 };
    this.touch.cringe = 1;
    pauseBehavior(this, EXCRETE_PAUSE);
    this.onChange?.();
    const tail = this.points[this.points.length - 1];
    const before = this.points[this.points.length - 2];
    const len = Math.hypot(tail.x - before.x, tail.z - before.z) || 1;
    return { x: tail.x, z: tail.z, dx: (tail.x - before.x) / len, dz: (tail.z - before.z) / len, food };
  }

  // 保存する遺伝子(変わっている途中なら、変わりきったあとの値)
  savedGenes() {
    const genes = { ...this.genes };
    if (this.shift) nudgeGenes(genes, this.shift.drift, 1 - this.shift.progress);
    return genes;
  }

  toJSON() {
    return {
      id: this.id,
      seed: this.seed,
      genes: this.savedGenes(),
      x: this.x,
      z: this.z,
      heading: this.heading,
      meal: this.meal.drift ? { ...this.meal, drift: { ...this.meal.drift } } : { ...this.meal },
      growth: this.growth,
      quirks: this.quirks.map((q) => ({ ...q })),
      mutations: this.mutations.map((m) => ({ ...m })),
      parents: this.parents.map((p) => ({ ...p, genes: { ...p.genes }, quirks: (p.quirks ?? []).map((q) => ({ ...q })) })),
      bornAt: this.bornAt,
    };
  }
}
