// 水槽の背景(水・岩・砂の底・小石)。水槽ごとの seed で決まる飾りで、保存も編集もしない。
// フェーズ3で置物や環境の編集を作るときは、ここの色や配置を env から受け取る形にする。
import { lerp } from '../util/math.js';
import { makeRng } from '../util/random.js';

const TAU = Math.PI * 2;
const INK = '#0b0514';

function blob(cx, baseY, w, h, rng) {
  const p = new Path2D();
  p.moveTo(cx - w / 2, baseY + 6);
  p.bezierCurveTo(cx - w * 0.5, baseY - h * 0.6, cx - w * (0.3 + rng() * 0.15), baseY - h * 1.05, cx - w * 0.05, baseY - h);
  p.bezierCurveTo(cx + w * (0.2 + rng() * 0.2), baseY - h * 0.95, cx + w * 0.52, baseY - h * 0.5, cx + w / 2, baseY + 6);
  p.closePath();
  return p;
}

function wavyEdge(ctx, W, H, y0, amp, phase) {
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let i = 0; i <= 32; i++) {
    const x = (i / 32) * W;
    ctx.lineTo(x, y0 + Math.sin(i * 0.7 + phase) * amp + Math.sin(i * 1.9 + phase * 2) * amp * 0.4);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
}

export function renderScenery(ctx, geo, seed) {
  const { W, H, floorBack } = geo;
  const rng = makeRng(seed);

  // 水(濃い藍 → 青緑)
  const water = ctx.createLinearGradient(0, 0, 0, floorBack + H * 0.05);
  water.addColorStop(0, '#1a0848');
  water.addColorStop(0.45, '#123a86');
  water.addColorStop(1, '#0a6b73');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, W, H);

  // 底のあたりの、にじんだ明るさ
  const haze = ctx.createRadialGradient(W * 0.5, floorBack, 0, W * 0.5, floorBack, W * 0.6);
  haze.addColorStop(0, 'rgba(60, 255, 210, 0.22)');
  haze.addColorStop(1, 'rgba(60, 255, 210, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, H);

  // 遠くの岩(水に沈んだ色)
  ctx.lineJoin = 'round';
  for (let i = 0; i < 6; i++) {
    const rock = blob(rng() * W, floorBack, W * (0.1 + rng() * 0.16), H * (0.1 + rng() * 0.16), rng);
    ctx.fillStyle = '#2a2a80';
    ctx.fill(rock);
    ctx.strokeStyle = 'rgba(11,5,20,0.4)';
    ctx.lineWidth = 2.5;
    ctx.stroke(rock);
  }

  // 近くの岩(左右の端に大きく。影は1色だけ、ハイライトは1本)
  const nearRocks = [
    { cx: W * (0.02 + rng() * 0.08), w: W * (0.22 + rng() * 0.08), h: H * (0.3 + rng() * 0.15) },
    { cx: W * (0.9 + rng() * 0.08), w: W * (0.2 + rng() * 0.1), h: H * (0.25 + rng() * 0.2) },
    { cx: W * (0.3 + rng() * 0.4), w: W * (0.1 + rng() * 0.06), h: H * (0.12 + rng() * 0.08) },
  ];
  for (const r of nearRocks) {
    const rock = blob(r.cx, floorBack + H * 0.02, r.w, r.h, rng);
    ctx.fillStyle = '#35195e';
    ctx.fill(rock);
    ctx.save();
    ctx.clip(rock);
    ctx.fillStyle = '#220d42';
    ctx.beginPath();
    ctx.ellipse(r.cx + r.w * 0.45, floorBack, r.w * 0.5, r.h * 1.2, 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.stroke(rock);
    ctx.beginPath();
    ctx.moveTo(r.cx - r.w * 0.3, floorBack - r.h * 0.55);
    ctx.quadraticCurveTo(r.cx - r.w * 0.22, floorBack - r.h * 0.85, r.cx - r.w * 0.02, floorBack - r.h * 0.88);
    ctx.strokeStyle = '#7b52c9';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 砂の底(ベタ塗りを3段)
  wavyEdge(ctx, W, H, floorBack, H * 0.01, rng() * 10);
  ctx.fillStyle = '#5a2170';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke();
  wavyEdge(ctx, W, H, lerp(floorBack, H, 0.4), H * 0.014, rng() * 10);
  ctx.fillStyle = '#4a1a60';
  ctx.fill();
  wavyEdge(ctx, W, H, lerp(floorBack, H, 0.78), H * 0.012, rng() * 10);
  ctx.fillStyle = '#381250';
  ctx.fill();

  // 風紋
  ctx.lineCap = 'round';
  for (let i = 0; i < 34; i++) {
    const k = rng();
    const y = lerp(floorBack + 8, H - 4, k);
    const x = rng() * W;
    const w = lerp(14, 60, k);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x, y - lerp(2, 6, k), x + w / 2, y);
    ctx.strokeStyle = 'rgba(150, 80, 190, 0.55)';
    ctx.lineWidth = lerp(1, 2.5, k);
    ctx.stroke();
  }

  // 砂粒
  for (let i = 0; i < 320; i++) {
    const k = rng();
    const y = lerp(floorBack + 4, H, k);
    const x = rng() * W;
    ctx.fillStyle = rng() < 0.55 ? 'rgba(200, 140, 230, 0.55)' : 'rgba(15, 4, 30, 0.6)';
    ctx.beginPath();
    ctx.arc(x, y, lerp(0.6, 2, k) * (0.6 + rng() * 0.6), 0, TAU);
    ctx.fill();
  }

  // 小石(影は1色だけ)
  const colors = ['#7a3fc0', '#2f8a9a', '#c0407e', '#86a832', '#3f4fc0', '#e0a33a'];
  const pebbles = Array.from({ length: 16 }, () => ({
    x: rng(),
    z: rng(),
    r: 0.5 + rng(),
    c: colors[Math.floor(rng() * colors.length)],
  }));
  pebbles.sort((a, b) => b.z - a.z);
  for (const p of pebbles) {
    const pos = geo.project(p.x * 1.1 - 0.05, p.z);
    const r = geo.creatureSize * 0.06 * p.r * pos.scale;
    ctx.fillStyle = 'rgba(11,5,20,0.55)';
    ctx.beginPath();
    ctx.ellipse(pos.x + r * 0.35, pos.floorY + r * 0.4, r * 1.25, r * 0.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.floorY, r * 1.2, r * 0.75, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.2, 2.5 * pos.scale);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(pos.x - r * 0.4, pos.floorY - r * 0.3, r * 0.2, 0, TAU);
    ctx.fill();
  }
}

export function renderVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.45, W / 2, H * 0.55, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(5,0,12,0)');
  g.addColorStop(1, 'rgba(5,0,12,0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
