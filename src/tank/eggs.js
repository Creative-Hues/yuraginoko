// 卵:交配すると、どちらかの親が砂の上に産む。渦を巻いたリボンのかたまり。
// 水槽を開いている間だけ育ち、EGG.HATCH_SECONDS でかえる。調整値は lifeConfig.js。
import { EGG } from '../creature/lifeConfig.js';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { makeId } from '../util/random.js';

const TAU = Math.PI * 2;
const APPEAR = 2.5; // 産まれた卵が、ふわっと見えてくるまで(秒)

function num(v, fallback, min = 0, max = 1) {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
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

  // x, z: 砂の上の位置、child: 生まれる子 { genes, quirks, mutations, parents }
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

  // 1つの卵を描く(奥行きの順に、植物や生き物と混ぜて描く)
  draw(ctx, geo, e, t) {
    const pos = geo.project(e.x, e.z);
    const r = EGG.SIZE * (geo.right - geo.left) * pos.scale;
    const appear = smoothstep(e.progress / APPEAR);
    if (appear <= 0) return;
    const ripe = smoothstep((e.progress / EGG.HATCH_SECONDS - 0.8) / 0.2); // かえる前は、少しふるえて明るくなる
    const H1 = e.hue * 360;
    const H2 = e.hue2 * 360;
    const cx = pos.x + Math.sin(t * 9 + e.x * 20) * r * 0.04 * ripe;
    const cy = pos.floorY - r * 0.28;

    // 渦巻き(中心から外へ 1.7 周)。上下につぶして、砂の上に寝かせる
    const pts = [];
    const turns = 1.7;
    for (let i = 0; i <= 40; i++) {
      const k = i / 40;
      const a = k * turns * TAU + e.x * 7;
      const rr = r * lerp(0.12, 1, k);
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.45 });
    }
    const ribbon = new Path2D();
    pts.forEach((p, i) => (i ? ribbon.lineTo(p.x, p.y) : ribbon.moveTo(p.x, p.y)));

    ctx.save();
    ctx.globalAlpha = appear;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 砂に落ちる影
    ctx.fillStyle = 'rgba(11,4,24,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, pos.floorY, r * 1.1, r * 0.3, 0, 0, TAU);
    ctx.fill();
    // 輪郭 → リボン
    const w = r * 0.32;
    ctx.strokeStyle = '#120a1c';
    ctx.lineWidth = w + Math.max(2, r * 0.12);
    ctx.stroke(ribbon);
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.3 + e.x * 11);
    ctx.strokeStyle = `hsla(${H2}, 95%, ${lerp(68, 80, ripe)}%, 0.85)`;
    ctx.lineWidth = w;
    ctx.stroke(ribbon);
    // リボンの中の小さな卵の粒
    ctx.fillStyle = `hsla(${H1}, 100%, ${lerp(80, 92, ripe * pulse)}%, 0.9)`;
    for (let i = 3; i < pts.length; i += 3) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, Math.max(0.8, w * 0.22), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  toData() {
    return this.list.map((e) => ({ ...e, child: JSON.parse(JSON.stringify(e.child)) }));
  }
}
