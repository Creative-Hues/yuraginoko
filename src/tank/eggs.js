// 卵:繁殖がうまくいくと、どちらかの親が砂の上に産む。やわらかい色の、ふつうの楕円形の卵。
// 水槽を開いている間だけ育ち、EGG.HATCH_SECONDS でかえる。かえる直前は、ゆっくりゆれる。調整値は lifeConfig.js。
import { EGG } from '../creature/lifeConfig.js';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { makeId } from '../util/random.js';

const TAU = Math.PI * 2;
const APPEAR = 2.5; // 産まれた卵が、ふわっと見えてくるまで(秒)

function num(v, fallback, min = 0, max = 1) {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
}

// かえるまでの進み具合(0〜1)
export function eggProgress(e) {
  return clamp(e.progress / EGG.HATCH_SECONDS);
}

// 観察中に出す、卵のようす(数字は出さない)
export function eggMood(e) {
  const p = eggProgress(e);
  return (EGG.MOODS.find((m) => p < m.until) ?? EGG.MOODS[EGG.MOODS.length - 1]).text;
}

// 卵の大きさ(画面上)。w: 半分の幅、h: 高さ
function eggSize(geo, e) {
  const { scale } = geo.project(e.x, e.z);
  const r = EGG.SIZE * (geo.right - geo.left) * scale;
  return { w: r * 0.5, h: r * 1.3 };
}

// 卵の形(底の真ん中 (0, 0) から上へ。上のほうが少し細い)
function eggPath(w, h) {
  const k = 0.5523;
  const b1 = h * 0.44; // いちばん太い所までの高さ
  const b2 = h - b1;
  const p = new Path2D();
  p.moveTo(0, 0);
  p.bezierCurveTo(w * k, 0, w, -b1 * (1 - k), w, -b1);
  p.bezierCurveTo(w, -b1 - b2 * k, w * k * 0.85, -h, 0, -h);
  p.bezierCurveTo(-w * k * 0.85, -h, -w, -b1 - b2 * k, -w, -b1);
  p.bezierCurveTo(-w, -b1 * (1 - k), -w * k, 0, 0, 0);
  p.closePath();
  return p;
}

export class Eggs {
  // saved: 保存されていた卵の配列(壊れているものは外す)
  constructor(saved) {
    this.list = [];
    for (const e of Array.isArray(saved) ? saved : []) {
      if (!e?.child?.genes) continue;
      this.list.push({
        ...e,
        id: e.id ?? makeId(),
        x: num(e.x, 0.5),
        z: num(e.z, 0.5),
        progress: num(e.progress, 0, 0, Infinity),
        hue: num(e.hue, 0.5),
        hue2: num(e.hue2, 0.5),
      });
    }
  }

  get count() {
    return this.list.length;
  }

  // x, z: 砂の上の位置、child: 生まれる子 { genes, traits, mutations, parents, sensitivity }
  lay(x, z, mother, child) {
    const egg = {
      id: makeId(),
      x: clamp(x, 0.06, 0.94),
      z: clamp(z, 0.02, 0.98),
      progress: 0,
      hue: mother.genes.hue,
      hue2: mother.genes.hue2,
      child,
    };
    this.list.push(egg);
    return egg;
  }

  // seconds 秒ぶん育てて、かえった卵を返す(一覧からは外す)
  update(seconds) {
    if (!this.list.length) return [];
    const hatched = [];
    for (const e of this.list) {
      e.progress += seconds;
      if (e.progress >= EGG.HATCH_SECONDS) hatched.push(e);
    }
    if (hatched.length) this.list = this.list.filter((e) => !hatched.includes(e));
    return hatched;
  }

  // 観察モードでカメラを向ける所(卵の真ん中。水槽の座標)
  center(geo, e) {
    const pos = geo.project(e.x, e.z);
    return { x: pos.x, y: pos.floorY - eggSize(geo, e).h * 0.5 };
  }

  // 画面上の (x, y) に触れている卵(手前を優先)。pad: 指の余白
  at(geo, x, y, pad = 0) {
    const list = [...this.list].sort((a, b) => a.z - b.z);
    for (const e of list) {
      const pos = geo.project(e.x, e.z);
      const { w, h } = eggSize(geo, e);
      if (Math.abs(x - pos.x) <= w + pad && y >= pos.floorY - h - pad && y <= pos.floorY + pad) return e;
    }
    return null;
  }

  // 1つの卵を描く(奥行きの順に、植物や生き物と混ぜて描く)
  draw(ctx, geo, e, t) {
    const appear = smoothstep(e.progress / APPEAR);
    if (appear <= 0) return;
    const pos = geo.project(e.x, e.z);
    const { w, h } = eggSize(geo, e);
    const H1 = e.hue * 360;
    const H2 = e.hue2 * 360;
    const seed = e.x * 97 + e.z * 31;

    // かえる直前:底を支点に、ゆっくり左右にゆれる(ゆれては少し休む)
    const p = eggProgress(e);
    const near = p < EGG.WOBBLE_FROM ? 0 : lerp(0.4, 1, (p - EGG.WOBBLE_FROM) / (1 - EGG.WOBBLE_FROM));
    const rest = Math.max(0, Math.sin(t * 0.9 + seed));
    const tilt = near * rest * 0.13 * Math.sin(t * 3.4 + seed);

    ctx.save();
    ctx.globalAlpha = appear;
    // 砂に落ちる影
    ctx.fillStyle = 'rgba(11,4,24,0.35)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.floorY, w * 1.25, w * 0.35, 0, 0, TAU);
    ctx.fill();

    ctx.translate(pos.x, pos.floorY - h * 0.04);
    ctx.rotate(tilt);
    const shape = eggPath(w, h);
    // やわらかい色(上ほど明るい)
    const g = ctx.createLinearGradient(0, -h, 0, 0);
    g.addColorStop(0, `hsl(${H1}, 45%, 90%)`);
    g.addColorStop(1, `hsl(${H1}, 38%, 76%)`);
    ctx.fillStyle = g;
    ctx.fill(shape);
    // 2つ目の色の、ごく薄い小さな点
    ctx.save();
    ctx.clip(shape);
    ctx.fillStyle = `hsla(${H2}, 40%, 62%, 0.3)`;
    for (let i = 0; i < 5; i++) {
      const u = Math.sin(seed + i * 12.9898) * 43758.5453;
      const v = Math.sin(seed + i * 78.233) * 12345.678;
      const fx = (u - Math.floor(u)) * 2 - 1;
      const fy = v - Math.floor(v);
      ctx.beginPath();
      ctx.arc(fx * w * 0.6, -h * (0.15 + fy * 0.7), Math.max(0.6, w * 0.09), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // 細めの輪郭
    ctx.strokeStyle = 'rgba(18, 10, 28, 0.75)';
    ctx.lineWidth = Math.max(1.2, w * 0.14);
    ctx.stroke(shape);
    // ほんの少しのつや
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(-w * 0.38, -h * 0.66, w * 0.16, h * 0.1, -0.35, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  toData() {
    return this.list.map((e) => ({ ...e, child: JSON.parse(JSON.stringify(e.child)) }));
  }
}
