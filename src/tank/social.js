// 生き物どうしの交流:ときどき2匹が近づいて、頭を向け合い、触角を触れ合わせる。
// 交流の回数は2匹の組み合わせごとに数えて保存する(交配は tank.js で判定する)。
// 水槽を開いている間だけ進む。調整値は lifeConfig.js の MEET。
import { MEAL } from '../creature/creature.js';
import { pauseBehavior, startSeek, stopSeek } from '../creature/behavior.js';
import { DEPTH_SPAN } from '../creature/body.js';
import { MEET } from '../creature/lifeConfig.js';
import { clamp, lerp } from '../util/math.js';

const between = ([a, b], rng) => lerp(a, b, rng());

export function pairKey(a, b) {
  const ids = [a.id ?? a, b.id ?? b].map(String).sort();
  return `${ids[0]}|${ids[1]}`;
}

// 頭どうしの距離(横幅と同じ尺度)
function headGap(a, b) {
  return Math.hypot(a.x - b.x, (a.z - b.z) * DEPTH_SPAN);
}

export class Social {
  // saved: 保存されていた { pairs: { "idA|idB": 回数 } }
  constructor(saved, rng = Math.random) {
    this.pairs = {};
    for (const [k, v] of Object.entries(saved?.pairs ?? {})) {
      const n = Math.floor(Number(v));
      if (typeof k === 'string' && k.includes('|') && n > 0) this.pairs[k] = n;
    }
    this.rng = rng;
    // ここから下は保存しない
    this.timer = between(MEET.FIRST_WAIT, rng); // 次の交流を探し始めるまで(秒)
    this.approach = null; // 近づいている2匹 { a, b, time }
  }

  count(a, b) {
    return this.pairs[pairKey(a, b)] ?? 0;
  }

  reset(a, b) {
    delete this.pairs[pairKey(a, b)];
  }

  // 水槽からいなくなった子の組を消す
  forget(c) {
    for (const k of Object.keys(this.pairs)) if (k.split('|').includes(String(c.id))) delete this.pairs[k];
    if (this.approach && (this.approach.a === c || this.approach.b === c)) this.cancel();
  }

  // 交流できる子:大人で、エサに向かっておらず、止まっておらず、触れ合い中でもない
  static free(c) {
    return c.adult && !c.leaving && !c.meet && c.meal.stage !== MEAL.seeking && !(c.behavior.pause > 0) && c.behavior.mode !== 'seek';
  }

  // 近づくのをやめる(エサに向かい始めた子の行き先は、そのままにする)
  cancel() {
    const ap = this.approach;
    this.approach = null;
    if (!ap) return;
    for (const c of [ap.a, ap.b]) if (c.meal.stage !== MEAL.seeking) stopSeek(c);
    this.timer = between(MEET.INTERVAL, this.rng);
  }

  // 触れ合った2匹を返す(なければ null)
  update(dt, creatures) {
    const ap = this.approach;
    if (ap) {
      const gone = !creatures.includes(ap.a) || !creatures.includes(ap.b);
      const busy = [ap.a, ap.b].some((c) => c.leaving || c.meal.stage === MEAL.seeking);
      ap.time += dt;
      if (gone || busy || ap.time > MEET.GIVE_UP) {
        this.cancel();
        return null;
      }
      if (headGap(ap.a, ap.b) < MEET.REACH) {
        this.touch(ap.a, ap.b);
        return [ap.a, ap.b];
      }
      this.steer(ap.a, ap.b);
      this.steer(ap.b, ap.a);
      return null;
    }
    this.timer -= dt;
    if (this.timer > 0) return null;
    this.timer = between(MEET.INTERVAL, this.rng);
    const free = creatures.filter(Social.free);
    if (free.length < 2) return null;
    const i = Math.floor(this.rng() * free.length);
    let j = Math.floor(this.rng() * (free.length - 1));
    if (j >= i) j++;
    this.approach = { a: free[i], b: free[j], time: 0 };
    this.steer(free[i], free[j], true);
    this.steer(free[j], free[i], true);
    return null;
  }

  // c の行き先を「相手の頭の、こちら側に少し離れた所」にする(頭が向かい合うように)
  steer(c, other, start = false) {
    let dx = c.x - other.x;
    let dz = (c.z - other.z) * DEPTH_SPAN;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const x = clamp(other.x + dx * MEET.GAP * 0.5, 0.08, 0.92);
    const z = clamp(other.z + (dz * MEET.GAP * 0.5) / DEPTH_SPAN, 0.04, 0.96);
    if (start || c.behavior.mode !== 'seek') startSeek(c, x, z);
    else c.behavior.target = { x, z };
  }

  // 触れ合う:その場で止まって、触角を相手へ伸ばす。回数を1つ数える
  touch(a, b) {
    this.approach = null;
    this.timer = between(MEET.INTERVAL, this.rng);
    for (const [c, other] of [
      [a, b],
      [b, a],
    ]) {
      stopSeek(c);
      pauseBehavior(c, MEET.TOUCH_SECONDS);
      c.meet = { partner: other, t: 0, seconds: MEET.TOUCH_SECONDS };
    }
    const k = pairKey(a, b);
    this.pairs[k] = (this.pairs[k] ?? 0) + 1;
  }

  toData() {
    return { pairs: { ...this.pairs } };
  }
}
