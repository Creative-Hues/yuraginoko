// 生き物どうしの交流と繁殖。
// - 交流:ときどき2匹が近づいて、頭を向け合い、触角を触れ合わせる。回数は2匹の組み合わせごとに数えて保存する
// - 繁殖:交流が MATE.MEETS 回たまった「準備ができた」2匹が、ときどき近づいて並び、輪になって回りながら昇って沈む
//   (動きは breedDance.js)。途中で邪魔されずに最後まで終わったら、tank.js が卵を産むかどうかを決める
// 水槽を開いている間だけ進む。調整値は lifeConfig.js の MEET・MATE・BREED。
import { MEAL } from '../creature/creature.js';
import { pauseBehavior, startDance, startSeek, stopDance, stopSeek } from '../creature/behavior.js';
import { DEPTH_SPAN } from '../creature/body.js';
import { BREED, MATE, MEET } from '../creature/lifeConfig.js';
import { clamp, lerp } from '../util/math.js';
import { nestlePose, planDance, stepDance } from './breedDance.js';

const between = ([a, b], rng) => lerp(a, b, rng());

export function pairKey(a, b) {
  const ids = [a.id ?? a, b.id ?? b].map(String).sort();
  return `${ids[0]}|${ids[1]}`;
}

// 頭どうしの距離(横幅と同じ尺度)
function headGap(a, b) {
  return Math.hypot(a.x - b.x, (a.z - b.z) * DEPTH_SPAN);
}

// 頭から行き先までの距離(横幅と同じ尺度)
function gapTo(c, spot) {
  return Math.hypot(c.x - spot.x, (c.z - spot.z) * DEPTH_SPAN);
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
    this.breedTimer = between(BREED.FIRST_WAIT, rng); // 次の繁殖を探し始めるまで(秒)
    this.approach = null; // 近づいている2匹 { kind: 'meet' | 'breed', a, b, time, dance }
    this.breeding = null; // 繁殖の動きの最中(breedDance.js の planDance)
  }

  count(a, b) {
    return this.pairs[pairKey(a, b)] ?? 0;
  }

  // 繁殖の準備ができている組か
  ready(a, b) {
    return this.count(a, b) >= MATE.MEETS;
  }

  // c と繁殖の準備ができている相手が、この中にいるか
  hasReadyPartner(c, creatures) {
    return creatures.some((o) => o !== c && this.ready(c, o));
  }

  reset(a, b) {
    delete this.pairs[pairKey(a, b)];
  }

  // 水槽からいなくなった子の組を消す
  forget(c) {
    for (const k of Object.keys(this.pairs)) if (k.split('|').includes(String(c.id))) delete this.pairs[k];
    if (this.approach && (this.approach.a === c || this.approach.b === c)) this.cancel();
    if (this.breeding && (this.breeding.a === c || this.breeding.b === c)) this.stopBreeding();
  }

  // 交流・繁殖を始められる子:大人で、エサに向かっておらず、止まっておらず、触れ合い中・寄り添い中でもない
  static free(c) {
    return (
      c.adult && !c.leaving && !c.meet && !c.breed && c.meal.stage !== MEAL.seeking && !(c.behavior.pause > 0) && c.behavior.mode !== 'seek'
    );
  }

  // 近づくのをやめる(エサに向かい始めた子の行き先は、そのままにする)
  cancel() {
    const ap = this.approach;
    this.approach = null;
    if (!ap) return;
    for (const c of [ap.a, ap.b]) if (c.meal.stage !== MEAL.seeking) stopSeek(c);
    if (ap.kind === 'breed') this.breedTimer = between(BREED.INTERVAL, this.rng);
    else this.timer = between(MEET.INTERVAL, this.rng);
  }

  // 繁殖の動きをやめて、ふだんの動きに戻る(準備ができた状態はそのまま。浮いていれば、ゆっくり降りる)
  stopBreeding() {
    const br = this.breeding;
    this.breeding = null;
    if (!br) return;
    for (const c of [br.a, br.b]) {
      c.breed = null;
      stopDance(c);
    }
    this.breedTimer = between(BREED.INTERVAL, this.rng);
  }

  /**
   * 進める。起きたことを返す(なければ null)
   * - { type: 'met', a, b }:触れ合った(回数を1つ数えた)
   * - { type: 'bred', a, b }:寄り添いが最後まで終わった
   * canBreed: 繁殖を始めてよいか(5匹の間は false)
   */
  update(dt, creatures, canBreed = true) {
    const done = this.updateBreeding(dt, creatures);
    if (done) return done;

    const ap = this.approach;
    if (ap) return this.updateApproach(dt, ap, creatures);

    this.timer -= dt;
    this.breedTimer -= dt;
    const free = creatures.filter(Social.free);

    // 繁殖:準備ができた組のうち、2匹とも手が空いている組
    if (this.breedTimer <= 0 && !this.breeding) {
      this.breedTimer = between(BREED.INTERVAL, this.rng);
      if (canBreed) {
        const pairs = [];
        for (let i = 0; i < free.length; i++) {
          for (let j = i + 1; j < free.length; j++) if (this.ready(free[i], free[j])) pairs.push([free[i], free[j]]);
        }
        if (pairs.length) {
          const [a, b] = pairs[Math.floor(this.rng() * pairs.length)];
          this.startApproach('breed', a, b);
          return null;
        }
      }
    }

    // 交流
    if (this.timer > 0) return null;
    this.timer = between(MEET.INTERVAL, this.rng);
    if (free.length < 2) return null;
    const i = Math.floor(this.rng() * free.length);
    let j = Math.floor(this.rng() * (free.length - 1));
    if (j >= i) j++;
    this.startApproach('meet', free[i], free[j]);
    return null;
  }

  startApproach(kind, a, b) {
    this.approach = { kind, a, b, time: 0, dance: kind === 'breed' ? planDance(a, b) : null };
    a.disturbed = false;
    b.disturbed = false;
    this.steer(this.approach, true);
  }

  updateApproach(dt, ap, creatures) {
    const gone = !creatures.includes(ap.a) || !creatures.includes(ap.b);
    const busy = [ap.a, ap.b].some((c) => c.leaving || c.meal.stage === MEAL.seeking || (ap.kind === 'breed' && c.disturbed));
    ap.time += dt;
    if (gone || busy || ap.time > (ap.kind === 'breed' ? BREED.GIVE_UP : MEET.GIVE_UP)) {
      this.cancel();
      return null;
    }
    if (ap.kind === 'breed') {
      if ([ap.a, ap.b].every((c) => gapTo(c, nestlePose(ap.dance, c)) < BREED.REACH)) {
        this.startBreeding(ap.dance);
        return null;
      }
    } else if (headGap(ap.a, ap.b) < MEET.REACH) {
      this.touch(ap.a, ap.b);
      return { type: 'met', a: ap.a, b: ap.b };
    }
    this.steer(ap);
    return null;
  }

  // 行き先を決める。交流:相手の頭の、こちら側に少し離れた所(頭が向かい合うように)/ 繁殖:横腹を寄せて並ぶ所
  steer(ap, start = false) {
    const go = (c, spot) => {
      if (start || c.behavior.mode !== 'seek') startSeek(c, spot.x, spot.z);
      else c.behavior.target = { x: spot.x, z: spot.z };
    };
    if (ap.kind === 'breed') {
      for (const c of [ap.a, ap.b]) go(c, nestlePose(ap.dance, c));
      return;
    }
    for (const [c, other] of [
      [ap.a, ap.b],
      [ap.b, ap.a],
    ]) {
      let dx = c.x - other.x;
      let dz = (c.z - other.z) * DEPTH_SPAN;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const x = clamp(other.x + dx * MEET.GAP * 0.5, 0.08, 0.92);
      const z = clamp(other.z + (dz * MEET.GAP * 0.5) / DEPTH_SPAN, 0.04, 0.96);
      go(c, { x, z });
    }
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

  // 並び始める:ここから先の頭の位置・向き・高さは breedDance.js が決める
  startBreeding(dance) {
    this.approach = null;
    this.breeding = dance;
    for (const [c, other] of [
      [dance.a, dance.b],
      [dance.b, dance.a],
    ]) {
      stopSeek(c);
      startDance(c);
      c.breed = { partner: other, calm: 0 };
    }
  }

  // 繁殖の動きを進める。底に着いて離れるところまで終わったら { type: 'bred' }
  updateBreeding(dt, creatures) {
    const br = this.breeding;
    if (!br) return null;
    const { a, b } = br;
    const broken = [a, b].some((c) => !creatures.includes(c) || c.leaving || c.disturbed || c.meal.stage === MEAL.seeking || !c.breed);
    if (broken) {
      this.stopBreeding();
      return null;
    }
    if (!stepDance(br, dt)) return null;
    this.stopBreeding();
    return { type: 'bred', a, b };
  }

  toData() {
    return { pairs: { ...this.pairs } };
  }
}
