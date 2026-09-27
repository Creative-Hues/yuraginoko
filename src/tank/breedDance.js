// 繁殖の動き(描画はしない)。調整値は lifeConfig.js の BREED。
//
//   並ぶ(nestle)  : 頭としっぽを逆向きにして、横腹を寄せて並ぶ(A の頭のそばに B のしっぽ)
//   昇る(rise)    : 並んだまま丸まって1つの輪になり、回りながらふわっと昇る
//   とどまる(hover): 水槽の高さの真ん中あたりで、少しゆっくり回る
//   沈む(sink)    : 回りながら、らせん状に底へ降りる
//   ほどける(unwind): 底に着いたら、輪がほどけるように離れる
//
// 頭としっぽを逆向きにして並んだ2匹は、つぶれた輪と同じ形なので、そのまま丸めて回すと「2匹で1つの輪」になる。
// 輪は底と同じ面(左右 x と奥行き z)に描くので、回るたびに片方が手前、片方が奥になって入れ替わる。
// ここでは頭の位置・向き・高さだけを決め、体は body.js の「節の鎖」がついてくる(Uターンと同じ仕組み)。
import { BODY_WORLD_LENGTH, DEPTH_SPAN, angleDiff } from '../creature/body.js';
import { BREED } from '../creature/lifeConfig.js';
import { clamp, lerp, smoothstep } from '../util/math.js';

const TAU = Math.PI * 2;
export const DANCE_PHASES = Object.keys(BREED.PHASES); // nestle → rise → hover → sink → unwind
export const DANCE_SECONDS = Object.values(BREED.PHASES).reduce((s, v) => s + v, 0);

/**
 * 2匹の並び方を決める。front: 手前側で並ぶ子、sign: 回る向き(1 = 左回り、-1 = 右回り)。
 * 手前の子は、今いる側(左右)に頭を向けて並ぶ(近いほうへ向かえるように)
 */
export function planDance(a, b) {
  const front = a.z <= b.z ? a : b;
  const back = front === a ? b : a;
  const cx = clamp((a.x + b.x) / 2, ...BREED.CENTER_X);
  const cz = clamp((a.z + b.z) / 2, ...BREED.CENTER_Z);
  const sign = front.x >= cx ? 1 : -1;
  const size = ((a.size ?? 1) + (b.size ?? 1)) / 2;
  const L = BODY_WORLD_LENGTH * size; // 体の長さ(横幅と同じ尺度)
  return {
    a,
    b,
    front,
    back,
    cx,
    cz,
    sign,
    L,
    R: (BREED.RING * L) / TAU, // 輪の半径
    phase: 'nestle',
    t: 0, // 今の段階に入ってからの秒数
    elapsed: 0, // 並び始めてからの秒数
    turn: 0, // 輪の回った角度
    bubble: BREED.BUBBLE_EVERY * 0.5,
  };
}

// 横腹を寄せて並んだときの、頭の位置と向き
export function nestlePose(d, c) {
  const k = c === d.front ? 1 : -1;
  const dz = BREED.SIDE / 2 / DEPTH_SPAN;
  return {
    x: d.cx + k * d.sign * d.L * 0.5,
    z: d.cz - k * dz,
    heading: d.sign * k > 0 ? 0 : Math.PI,
  };
}

// 輪の上の、頭の位置と向き(手前の子は輪の手前側から、奥の子は反対側から回り始める)
function ringPose(d, c) {
  const phi = (c === d.front ? -Math.PI / 2 : Math.PI / 2) + d.sign * d.turn;
  return {
    x: d.cx + Math.cos(phi) * d.R,
    z: d.cz + (Math.sin(phi) * d.R) / DEPTH_SPAN,
    heading: phi + (d.sign * Math.PI) / 2,
  };
}

// ほどけるとき:輪の外へ向かって、それぞれ離れていく
function unwindPose(d, c) {
  const ring = ringPose(d, c);
  const out = Math.atan2((ring.z - d.cz) * DEPTH_SPAN, ring.x - d.cx);
  const reach = d.R + d.L * 0.6;
  return {
    x: clamp(d.cx + Math.cos(out) * reach, 0.1, 0.9),
    z: clamp(d.cz + (Math.sin(out) * reach) / DEPTH_SPAN, 0.04, 0.96),
    heading: out + (d.sign * Math.PI) / 4,
  };
}

function blend(p, q, k) {
  return { x: lerp(p.x, q.x, k), z: lerp(p.z, q.z, k), heading: p.heading + angleDiff(q.heading, p.heading) * k };
}

// 今の段階での、回る速さ・高さ・輪への丸まり具合(0 = 並んだまま〜1 = 輪)・落ち着き(触角を下げる)
function phaseLook(d) {
  const P = BREED.PHASES;
  const k = clamp(d.t / P[d.phase]);
  switch (d.phase) {
    case 'nestle':
      return { spin: 0, lift: 0, curl: 0, calm: smoothstep(k) };
    case 'rise':
      return { spin: BREED.SPIN * smoothstep(k * 3), lift: BREED.RISE_LIFT * smoothstep(k), curl: smoothstep(k * 2.5), calm: 1 };
    case 'hover':
      return { spin: lerp(BREED.SPIN, BREED.HOVER_SPIN, smoothstep(k * 3)), lift: BREED.RISE_LIFT, curl: 1, calm: 1 };
    case 'sink':
      return { spin: lerp(BREED.HOVER_SPIN, BREED.SPIN, smoothstep(k * 3)), lift: BREED.RISE_LIFT * (1 - smoothstep(k)), curl: 1, calm: 1 };
    default: // unwind
      return { spin: BREED.SPIN * (1 - smoothstep(k * 2)), lift: 0, curl: 1, calm: 1 - smoothstep(k) };
  }
}

/**
 * dt 秒進める。2匹の頭の位置・向き・高さを動かし、体の波をそろえる。
 * 最後まで終わったら true。泡を出すときは d.bubbled = true にする
 */
export function stepDance(d, dt) {
  d.t += dt;
  d.elapsed += dt;
  while (d.t >= BREED.PHASES[d.phase]) {
    const i = DANCE_PHASES.indexOf(d.phase);
    if (i >= DANCE_PHASES.length - 1) return true;
    d.t -= BREED.PHASES[d.phase];
    d.phase = DANCE_PHASES[i + 1];
  }
  const look = phaseLook(d);
  d.turn += look.spin * dt;
  const follow = 1 - Math.exp(-(d.phase === 'nestle' || d.phase === 'unwind' ? 2.5 : 6) * dt);
  for (const c of [d.a, d.b]) {
    let target;
    if (d.phase === 'unwind') target = blend(ringPose(d, c), unwindPose(d, c), smoothstep(d.t / BREED.PHASES.unwind));
    else target = blend(nestlePose(d, c), ringPose(d, c), look.curl);
    c.x += (target.x - c.x) * follow;
    c.z += (target.z - c.z) * follow;
    c.heading += angleDiff(target.heading, c.heading) * follow;
    c.lift += (look.lift - c.lift) * Math.min(1, dt * 3);
    c.breed.calm = look.calm;
  }
  // 2匹の体の波をそろえる
  d.b.phase = d.a.phase;
  d.b.behavior.waveAmp = d.a.behavior.waveAmp;
  // 回っている間は、ときどき小さな泡
  if (d.phase === 'rise' || d.phase === 'hover' || d.phase === 'sink') {
    d.bubble -= dt;
    if (d.bubble <= 0) {
      d.bubble = BREED.BUBBLE_EVERY * (0.7 + Math.random() * 0.6);
      d.bubbled = true;
    }
  }
  return false;
}
