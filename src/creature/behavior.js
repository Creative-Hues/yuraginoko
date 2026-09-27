// 生き物の行動
// - crawl   (這う)  : 基本。底をゆっくり進む。向きがわずかにゆらいで、奥行きもゆっくり変わる
// - rest    (休む)  : ときどき止まって、体だけゆっくり揺らす
// - float   (浮く)  : ときどき、ふわっと浮いてゆっくり沈む
// - wriggle (うねる): まれに、すばやく体を波打たせて進む
// - seek    (向かう): エサなど、決まった場所へまっすぐ向かう(startSeek で始め、stopSeek で終える)
// - dance   (繁殖)  : 頭の位置・向き・高さは social.js が決める。ここでは体の波だけを進める(startDance / stopDance)
// 向きを変えるときは、頭から先に曲がる Uターン(turn)をする。
//
// c.x, c.z は頭の位置(x: 左右 0〜1、z: 0 = 手前〜1 = 奥)、c.heading は頭の向き。
// c.pace は動きの速さの倍率(藻が多いときや、観察中はゆっくり。ふだん = 1)。
import { clamp, lerp, smoothstep } from '../util/math.js';
import { DEPTH_SPAN, angleDiff, normalizeAngle } from './body.js';
import { BREED } from './lifeConfig.js';

// 頭がここより外へ向かって進んだら折り返す(体が水槽からはみ出さないように)
const X_TURN_MIN = 0.28;
const X_TURN_MAX = 0.72;
const Z_MIN = 0.03;
const Z_MAX = 0.97;

// 行動ごとの体の波の大きさと速さ
const WAVE = {
  crawl: { amp: 0.035, speed: 1 },
  rest: { amp: 0.018, speed: 0.4 },
  float: { amp: 0.07, speed: 0.7 },
  wriggle: { amp: 0.2, speed: 5.5 },
  seek: { amp: 0.04, speed: 1.2 },
  dance: { amp: BREED.WAVE_AMP, speed: BREED.WAVE_SPEED },
};

const SEEK_REACH = 0.02; // 頭がこれより近づいたら、着いたとする

export function createBehavior() {
  return {
    mode: 'crawl',
    time: 0,
    duration: 5 + Math.random() * 8,
    speed: 0, // 実際の移動速度(なめらかに変わる)
    drift: (Math.random() - 0.5) * 0.6, // 奥/手前へのゆるい向き
    turn: null,
    liftTarget: 0,
    waveAmp: WAVE.crawl.amp,
  };
}

function enter(c, mode, g) {
  const b = c.behavior;
  b.mode = mode;
  b.time = 0;
  if (mode === 'crawl') {
    b.duration = 6 + Math.random() * 10;
    b.drift = (Math.random() - 0.5) * 0.6;
    if (Math.random() < 0.25) startTurn(c);
  } else if (mode === 'rest') {
    b.duration = 3 + Math.random() * 6;
  } else if (mode === 'float') {
    b.duration = 8 + Math.random() * 5;
    b.liftTarget = (0.25 + Math.random() * 0.4) * lerp(0.7, 1.2, g.floatiness);
  } else if (mode === 'wriggle') {
    b.duration = 1.2 + Math.random() * 1.2;
  }
}

// Uターンを始める。奥にいるときは手前へ、手前にいるときは奥へ回り込む
export function startTurn(c) {
  const b = c.behavior;
  if (b.turn) return;
  const toward = c.z > 0.5 ? -1 : 1;
  const side = toward * (Math.cos(c.heading) >= 0 ? 1 : -1);
  b.turn = {
    from: c.heading,
    to: c.heading + side * Math.PI,
    time: 0,
    duration: 1.3 + Math.random() * 0.6,
  };
}

// その場で seconds 秒ほどぴたりと止まる(向きも体の形も変えない)。止まったあとは、元の行動の続きから
export function pauseBehavior(c, seconds) {
  c.behavior.pause = seconds;
  c.behavior.speed = 0;
}

// 決まった場所 (x, z) へ向かい始める
export function startSeek(c, x, z) {
  const b = c.behavior;
  b.mode = 'seek';
  b.time = 0;
  b.turn = null;
  b.target = { x, z };
}

// 繁殖の動きを始める(位置・向き・高さは外から動かす)
export function startDance(c) {
  const b = c.behavior;
  b.mode = 'dance';
  b.time = 0;
  b.turn = null;
  b.target = null;
  b.pause = 0;
  b.speed = 0;
}

// 繁殖の動きをやめて、ふだんの這う動きに戻る(浮いていれば、ゆっくり底へ降りる)
export function stopDance(c) {
  if (c.behavior.mode === 'dance') enter(c, 'crawl', c.expressed ?? {});
}

export function stopSeek(c) {
  const b = c.behavior;
  b.target = null;
  if (b.mode === 'seek') {
    b.mode = 'rest';
    b.time = 0;
    b.duration = 2 + Math.random() * 3;
  }
}

// 向かっている場所までの距離(横幅と同じ尺度)。向かっていなければ Infinity
export function seekDistance(c) {
  const t = c.behavior.target;
  if (!t) return Infinity;
  return Math.hypot(t.x - c.x, (t.z - c.z) * DEPTH_SPAN);
}

export function updateBehavior(c, g, dt) {
  const b = c.behavior;
  const pace = c.pace ?? 1;

  // 止まっている間:動かず、底に降りて、体はゆっくり揺れるだけ
  if (b.pause > 0) {
    b.pause -= dt;
    b.speed = 0;
    c.lift += (0 - c.lift) * Math.min(1, dt * 2.5);
    b.waveAmp += (WAVE.rest.amp - b.waveAmp) * Math.min(1, dt * 3);
    c.phase += dt * WAVE.rest.speed * pace;
    return;
  }

  b.time += dt;
  // 繁殖中:体の波だけを進める(2匹の波は social.js でそろえる)
  if (b.mode === 'dance') {
    b.waveAmp += (WAVE.dance.amp - b.waveAmp) * Math.min(1, dt * 2);
    c.phase += dt * WAVE.dance.speed;
    return;
  }
  const seeking = b.mode === 'seek';

  // 次の行動へ(ゆっくりのときは、うねったり浮いたりも少なくなる)
  if (b.mode === 'crawl' || b.mode === 'rest') {
    const quiet = pace * pace;
    const floatChance = (0.004 + g.floatiness * 0.045) * dt * quiet;
    const wriggleChance = (0.001 + (c.traits?.wriggliness ?? 0.5) * 0.012) * dt * quiet; // 泳ぎ方の激しさ(特徴遺伝子)
    const r = Math.random();
    if (r < wriggleChance) enter(c, 'wriggle', g);
    else if (r < wriggleChance + floatChance) enter(c, 'float', g);
  }
  if (!seeking && b.time >= b.duration) {
    enter(c, b.mode === 'crawl' && Math.random() < 0.45 ? 'rest' : 'crawl', g);
  }

  // 水槽の端に近づいたら折り返す
  const cos = Math.cos(c.heading);
  if (!seeking && b.mode !== 'rest' && ((c.x < X_TURN_MIN && cos < 0) || (c.x > X_TURN_MAX && cos > 0))) startTurn(c);

  // 向き
  if (seeking) {
    // 向かう場所のほうへ、頭からゆっくり向きを変える
    const t = b.target;
    const want = Math.atan2((t.z - c.z) * DEPTH_SPAN, t.x - c.x);
    if (seekDistance(c) > SEEK_REACH) c.heading += angleDiff(want, c.heading) * Math.min(1, dt * 1.8);
  } else if (b.turn) {
    const t = b.turn;
    t.time += dt;
    const p = smoothstep(t.time / t.duration);
    c.heading = lerp(t.from, t.to, p);
    if (t.time >= t.duration) {
      c.heading = normalizeAngle(t.to);
      b.turn = null;
      b.drift = (Math.random() - 0.5) * 0.6;
    }
  } else {
    // 左右どちらかへ進みながら、奥/手前へ少しだけ向きをゆらす
    let d = b.drift;
    if (c.z < 0.15) d = 0.4;
    else if (c.z > 0.85) d = -0.4;
    d = clamp(d, -0.45, 0.45);
    const target = Math.cos(c.heading) >= 0 ? Math.asin(d) : Math.PI - Math.asin(d);
    c.heading += angleDiff(target, c.heading) * Math.min(1, dt * 0.8);
  }

  // 速さ
  const crawl = lerp(0.008, 0.028, g.crawlSpeed);
  let targetSpeed = 0;
  if (b.mode === 'crawl') targetSpeed = crawl;
  else if (b.mode === 'float') targetSpeed = crawl * 0.6;
  else if (b.mode === 'wriggle') targetSpeed = crawl * 3 + 0.03;
  if (b.turn) targetSpeed = Math.max(targetSpeed, 0.035);
  if (seeking) {
    // 近づくほどゆっくりになって、着いたら止まる
    const dist = seekDistance(c);
    targetSpeed = dist > SEEK_REACH ? Math.min(crawl * 1.4 + 0.02, dist * 1.2 + 0.01) : 0;
  }
  // エサに向かうときは、ゆっくりのときでもあまり遅くしない
  targetSpeed *= seeking ? Math.max(pace, 0.85) : pace;
  const accel = b.mode === 'wriggle' ? 4 : 0.8;
  b.speed += (targetSpeed - b.speed) * Math.min(1, dt * accel);

  // 移動(頭が進む。体は body.js でついてくる)
  c.x = clamp(c.x + Math.cos(c.heading) * b.speed * dt, 0.05, 0.95);
  c.z = clamp(c.z + (Math.sin(c.heading) * b.speed * dt) / DEPTH_SPAN, Z_MIN, Z_MAX);

  // 高さ
  const targetLift = b.mode === 'float' ? b.liftTarget * floatCurve(b.time / b.duration) : 0;
  c.lift += (targetLift - c.lift) * Math.min(1, dt * 2.5);

  // 体の波
  const w = WAVE[b.mode];
  b.waveAmp += (w.amp - b.waveAmp) * Math.min(1, dt * 3);
  c.phase += dt * w.speed * lerp(1, 1.6, g.crawlSpeed) * pace;
}

// 浮き上がりの形:すっと上がって、ゆっくり沈む
function floatCurve(p) {
  if (p < 0.3) return smoothstep(p / 0.3);
  return 1 - smoothstep((p - 0.3) / 0.7);
}
