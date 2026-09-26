// 変異で生えた特徴(にじみ・欠け・余分な突起)の描き方。drawCreature から呼ぶ。
// 種類と幅は lifeConfig.js の QUIRKS。位置と形は特徴ごとの seed で決まり、揺れ以外は変わらない。
//
// b(体の情報):
//   point(u, v)  体の表面上の点(u = 0 しっぽ〜1 頭、v = -1 背中〜+1 足)
//   tangent(u)   しっぽ → 頭 方向の向き
//   path         体の形(Path2D)
//   Ls, bodyH, lw, H1, H2, bodyA, outline, t
import { lerp } from '../util/math.js';

const TAU = Math.PI * 2;

function hash(seed, i) {
  const s = Math.sin((seed % 100003) * 0.0013 + i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function outlinedPath(ctx, path, fill, outline, lw) {
  ctx.strokeStyle = outline;
  ctx.lineWidth = lw;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
}

// 余分な突起(体の後ろに描く:根元が体に隠れるように)
function drawSprout(ctx, q, b) {
  const hue = (b.H2 + lerp(-50, 50, hash(q.seed, 1)) + 360) % 360;
  const sway = Math.sin(b.t * 1.2 + q.seed) * 0.12;
  const dir = b.tangent(q.u).x >= 0 ? 1 : -1; // 頭の向き(画面の左右)
  if (q.form === 'tail') {
    // しっぽの先から、ゆらゆらした糸
    const base = b.point(0.02, 0);
    const tg = b.tangent(0.04);
    const len = b.Ls * 0.22 * q.size;
    const path = new Path2D();
    path.moveTo(base.x, base.y);
    const n = 8;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const wob = Math.sin(b.t * 2 + k * 5 + q.seed) * len * 0.12 * k;
      path.lineTo(base.x - tg.x * len * k - tg.y * wob, base.y - tg.y * len * k + tg.x * wob);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = b.outline;
    ctx.lineWidth = b.Ls * 0.03 + b.lw;
    ctx.stroke(path);
    ctx.strokeStyle = `hsla(${hue}, 100%, 66%, ${Math.max(b.bodyA, 0.6)})`;
    ctx.lineWidth = b.Ls * 0.03;
    ctx.stroke(path);
    return;
  }
  const base = b.point(q.u, -0.85);
  const long = q.form === 'horn' ? 0.2 : 0.34;
  const len = b.Ls * long * q.size;
  const w = b.Ls * (q.form === 'horn' ? 0.05 : 0.08) * q.size;
  const a = -Math.PI / 2 + dir * lerp(-0.5, 0.5, hash(q.seed, 2)) + sway;
  const tip = { x: base.x + Math.cos(a) * len, y: base.y + Math.sin(a) * len };
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const path = new Path2D();
  path.moveTo(base.x - nx * w * 0.5, base.y - ny * w * 0.5);
  path.quadraticCurveTo(base.x + Math.cos(a) * len * 0.6 - nx * w * 0.3, base.y + Math.sin(a) * len * 0.6 - ny * w * 0.3, tip.x, tip.y);
  path.quadraticCurveTo(base.x + Math.cos(a) * len * 0.6 + nx * w * 0.3, base.y + Math.sin(a) * len * 0.6 + ny * w * 0.3, base.x + nx * w * 0.5, base.y + ny * w * 0.5);
  path.closePath();
  outlinedPath(ctx, path, `hsla(${hue}, 100%, 62%, ${Math.max(b.bodyA, 0.6)})`, b.outline, b.lw);
  // 先の小さな玉
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, Math.max(1, w * 0.45), 0, TAU);
  ctx.fillStyle = `hsl(${(hue + 30) % 360}, 100%, 78%)`;
  ctx.fill();
}

// 欠け:体の縁を小さく切り取り、切り口にも輪郭線を描く
function drawNotch(ctx, q, b) {
  const v = hash(q.seed, 3) < 0.7 ? -1.05 : 1.05; // 多くは背中側
  const p = b.point(q.u, v);
  const r = b.bodyH * 0.3 * q.size;
  const cx = p.x + (hash(q.seed, 4) - 0.5) * r * 0.4;
  const cy = p.y + v * r * 0.25;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000'; // 半透明の色のままだと、切り取りきれない
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.clip(b.path);
  ctx.beginPath();
  ctx.arc(cx, cy, r + b.lw * 0.5, 0, TAU);
  ctx.strokeStyle = b.outline;
  ctx.lineWidth = b.lw;
  ctx.stroke();
  ctx.restore();
}

// にじみ:体の色が、輪郭の外へぼんやり流れ出す(水に絵の具がにじむように、縁から外へ小さなしみが連なる)
function drawSmudge(ctx, q, b) {
  const side = hash(q.seed, 5) < 0.8 ? -1 : 1; // 多くは背中側
  const hue = b.H1; // 体の色がにじみ出す
  const R = b.bodyH * 0.32 * lerp(0.8, 1.2, q.size);
  const drift = Math.sin(b.t * 0.4 + q.seed) * 0.01;
  ctx.save();
  // 縁の輪郭をぼかして、そこから溶け出しているように見せる
  const edge = b.point(q.u, side);
  const er = R * 1.1;
  const eg = ctx.createRadialGradient(edge.x, edge.y, 0, edge.x, edge.y, er);
  eg.addColorStop(0, `hsla(${hue}, 100%, 55%, ${Math.max(0.6, b.bodyA)})`);
  eg.addColorStop(0.6, `hsla(${hue}, 100%, 55%, ${Math.max(0.6, b.bodyA) * 0.7})`);
  eg.addColorStop(1, `hsla(${hue}, 100%, 55%, 0)`);
  ctx.fillStyle = eg;
  ctx.fillRect(edge.x - er, edge.y - er, er * 2, er * 2);
  for (let i = 0; i < 6; i++) {
    const k = i / 5; // 0 = 縁の上 → 1 = いちばん外
    const u = q.u + (hash(q.seed, 10 + i) - 0.5) * 0.12 + drift;
    const p = b.point(u, side * lerp(0.95, 1.6, k));
    const r = R * lerp(1, 0.45, k);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    const a = lerp(0.75, 0.3, k) * Math.max(0.5, b.bodyA);
    g.addColorStop(0, `hsla(${hue}, 100%, 58%, ${a})`);
    g.addColorStop(0.55, `hsla(${hue}, 100%, 58%, ${a * 0.6})`);
    g.addColorStop(1, `hsla(${hue}, 100%, 58%, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }
  ctx.restore();
}

// 体を塗る前(突起と同じ段):余分な突起
export function drawQuirksBehind(ctx, quirks, b) {
  for (const q of quirks) if (q.type === 'sprout') drawSprout(ctx, q, b);
}

// 輪郭を描いたあと:欠け → にじみ(触角より前)
export function drawQuirksOver(ctx, quirks, b) {
  for (const q of quirks) if (q.type === 'notch') drawNotch(ctx, q, b);
  for (const q of quirks) if (q.type === 'smudge') drawSmudge(ctx, q, b);
}
