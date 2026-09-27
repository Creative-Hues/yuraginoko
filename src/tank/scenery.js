// 水槽の背景(水・岩・底・小石)。配置は水槽ごとの seed で決まり、水の色と底の見た目は環境(env)で変わる。
// 背景は環境が変わったときだけ描き直す。底の栄養と光る砂のまたたきは、毎フレーム drawSoilLive で重ねる。
import { clamp, lerp } from '../util/math.js';
import { wave } from '../util/noise.js';
import { makeRng } from '../util/random.js';
import { LIGHT_COLORS, NUTRIENT, SOILS } from './envConfig.js';

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

// 環境の光 → 光の筋の色相と、明るさ(暗い 0〜1 / 明るい 0〜1)
export function lightLook(env) {
  const light = LIGHT_COLORS[env?.light?.color] ?? LIGHT_COLORS.usual;
  const b = env?.light?.brightness ?? 0.5;
  return { light, dark: clamp((0.5 - b) * 2), bright: clamp((b - 0.5) * 2) };
}

export function renderScenery(ctx, geo, seed, env) {
  const { W, H, floorBack } = geo;
  const rng = makeRng(seed);
  const extra = makeRng((seed ^ 0x51a7e) >>> 0); // 土の種類ごとの飾り(いつもの配置の乱数を変えないように別にする)
  const soil = SOILS[env?.soil] ?? SOILS.sand;
  const { light, dark, bright } = lightLook(env);

  // 水(光の色で変わる。いつもの光:濃い藍 → 青緑)
  const water = ctx.createLinearGradient(0, 0, 0, floorBack + H * 0.05);
  water.addColorStop(0, light.water[0]);
  water.addColorStop(0.45, light.water[1]);
  water.addColorStop(1, light.water[2]);
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, W, H);

  // 底のあたりの、にじんだ明るさ
  const haze = ctx.createRadialGradient(W * 0.5, floorBack, 0, W * 0.5, floorBack, W * 0.6);
  const hazeColor = light.hue == null ? '60, 255, 210' : null;
  haze.addColorStop(0, hazeColor ? `rgba(${hazeColor}, 0.22)` : `hsla(${light.ray}, 100%, 60%, 0.22)`);
  haze.addColorStop(1, hazeColor ? `rgba(${hazeColor}, 0)` : `hsla(${light.ray}, 100%, 60%, 0)`);
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

  // 底(ベタ塗りを3段。色は土の種類で変わる)
  wavyEdge(ctx, W, H, floorBack, H * 0.01, rng() * 10);
  ctx.fillStyle = soil.floor[0];
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke();
  wavyEdge(ctx, W, H, lerp(floorBack, H, 0.4), H * 0.014, rng() * 10);
  ctx.fillStyle = soil.floor[1];
  ctx.fill();
  wavyEdge(ctx, W, H, lerp(floorBack, H, 0.78), H * 0.012, rng() * 10);
  ctx.fillStyle = soil.floor[2];
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
    ctx.strokeStyle = soil.ripple;
    ctx.lineWidth = lerp(1, 2.5, k);
    ctx.stroke();
  }

  // 砂粒
  for (let i = 0; i < 320; i++) {
    const k = rng();
    const y = lerp(floorBack + 4, H, k);
    const x = rng() * W;
    ctx.fillStyle = rng() < 0.55 ? soil.grains[0] : soil.grains[1];
    ctx.beginPath();
    ctx.arc(x, y, lerp(0.6, 2, k) * (0.6 + rng() * 0.6), 0, TAU);
    ctx.fill();
  }

  // 小石(影は1色だけ)。まるい苔や排泄の粒と見分けやすいように、灰色・茶色の地味な色で、控えめに描く
  const colors = ['#5b5560', '#6a5d52', '#4f4a55', '#71685c', '#5a5048', '#646068'];
  const pebbles = Array.from({ length: 16 }, () => ({
    x: rng(),
    z: rng(),
    r: 0.5 + rng(),
    c: colors[Math.floor(rng() * colors.length)],
  }));
  // 泥:ひびのような筋
  if (env?.soil === 'mud') drawMudCracks(ctx, geo, extra);
  // 小石の土:小石がたくさん
  if (env?.soil === 'pebble') {
    for (let i = 0; i < 40; i++) {
      pebbles.push({ x: extra(), z: extra(), r: 0.3 + extra() * 0.6, c: colors[Math.floor(extra() * colors.length)] });
    }
  }
  pebbles.sort((a, b) => b.z - a.z);
  for (const p of pebbles) {
    const pos = geo.project(p.x * 1.1 - 0.05, p.z);
    const r = geo.creatureSize * 0.06 * p.r * pos.scale;
    ctx.fillStyle = 'rgba(11,5,20,0.3)';
    ctx.beginPath();
    ctx.ellipse(pos.x + r * 0.35, pos.floorY + r * 0.4, r * 1.25, r * 0.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.floorY, r * 1.2, r * 0.75, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(11,5,20,0.45)';
    ctx.lineWidth = Math.max(0.8, 1.4 * pos.scale);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(pos.x - r * 0.4, pos.floorY - r * 0.3, r * 0.2, 0, TAU);
    ctx.fill();
  }

  // 光の明るさ:暗いほど全体が沈み、明るいほど光の色が薄くかかる
  if (dark > 0) {
    ctx.fillStyle = `rgba(4, 0, 14, ${dark * 0.5})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (bright > 0) {
    ctx.fillStyle = `hsla(${light.ray}, 90%, 80%, ${bright * 0.14})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawMudCracks(ctx, geo, rng) {
  const { W, H, floorBack } = geo;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 14; i++) {
    const k = rng();
    let x = rng() * W;
    let y = lerp(floorBack + 10, H - 6, k);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += lerp(8, 26, k) * (rng() < 0.5 ? -1 : 1) * (0.5 + rng());
      y += (rng() - 0.5) * lerp(3, 8, k);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(12, 3, 14, 0.6)';
    ctx.lineWidth = lerp(1, 2.5, k);
    ctx.stroke();
  }
}

// 毎フレーム重ねる底の様子:栄養のある場所が少し濃くなる、光る砂がまたたく
export function drawSoilLive(ctx, geo, env, nutrients, seed, t) {
  if (nutrients) {
    const { GRID_W: gw, GRID_H: gh, SHOW_MIN, DARKEN } = NUTRIENT;
    for (let iz = 0; iz < gh; iz++) {
      for (let ix = 0; ix < gw; ix++) {
        const v = nutrients.cells[iz * gw + ix];
        if (v < SHOW_MIN) continue;
        const z = (iz + 0.5) / gh;
        const pos = geo.project((ix + 0.5) / gw, z);
        const cellW = ((geo.right - geo.left) * lerp(0.9, 0.62, z)) / gw;
        const rx = cellW * 0.75;
        const ry = rx * lerp(0.4, 0.3, z);
        ctx.fillStyle = `rgba(20, 4, 24, ${v * DARKEN * 0.5})`;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.floorY, rx, ry, 0, 0, TAU);
        ctx.fill();
        // 真ん中ほど濃く
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.floorY, rx * 0.6, ry * 0.6, 0, 0, TAU);
        ctx.fill();
      }
    }
  }
  const sparkle = SOILS[env?.soil]?.sparkle;
  if (sparkle) {
    const rng = makeRng((seed ^ 0x6a11) >>> 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 46; i++) {
      const x = rng();
      const z = rng();
      const c = sparkle[i % sparkle.length];
      const a = wave(t / 4 + rng() * 10, i * 1.7);
      if (a <= 0.15) continue;
      const pos = geo.project(x * 1.1 - 0.05, z);
      const r = lerp(2.4, 1, z) * (0.7 + a * 0.5);
      ctx.fillStyle = `rgba(${c}, ${a * 0.7})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.floorY, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(${c}, ${a * 0.18})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.floorY, r * 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function renderVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.45, W / 2, H * 0.55, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(5,0,12,0)');
  g.addColorStop(1, 'rgba(5,0,12,0.4)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
