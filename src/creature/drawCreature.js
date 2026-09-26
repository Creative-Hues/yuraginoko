// 生き物の描画(横から見た姿)。
// グラフィティ調:太い輪郭線、ベタ塗り、模様はくっきり。体の一部は半透明。
//
// 体は、画面に写した節の並び pts(しっぽ → 頭)に沿って描く。
// 節が曲がって手前や奥を向くと、そのぶん体が縮んで見える(Uターンの立体感)。
// 体の形は「節ごとの楕円をつなげた形」で作るので、曲がっても重なっても輪郭が崩れない。
import { patternMix } from './genes.js';
import { clamp, lerp, smoothstep } from '../util/math.js';

const TAU = Math.PI * 2;
const OUTLINE_SAMPLES = 44;

// 個体ごとに決まった「ばらつき」(0〜1)。突起や斑点の位置に使う
function hash(seed, i) {
  const s = Math.sin(seed * 0.0001 + i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 背骨を作る。pts: [{ x, y(足もとの高さ), s(奥行きによる縮尺) }](しっぽ → 頭)
 * 返す各節: { x, y(体の中心), top(背中までの厚み), bot(足までの厚み), floor(足もと) }
 */
function buildSpine(c, pts, L, bodyH, t) {
  const tc = c.touch;
  const amp = c.behavior.waveAmp * L;
  const ph = c.phase * Math.PI;
  const swell = 1 + 0.12 * smoothstep(tc.cringe);
  const n = pts.length;
  const spine = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1); // 0 = しっぽ、1 = 頭
    const p = pts[i];
    const env = 0.35 + 0.65 * (1 - u);
    const prof = Math.pow(Math.sin(Math.PI * clamp(u * 0.96 + 0.02)), 0.6) * lerp(0.45, 1, smoothstep(u * 1.4));
    const h = bodyH * p.s * swell;
    // 撫でた場所から広がる、ゆるい波
    const du = Math.abs(u - tc.waveOrigin);
    const extra = tc.waveBoost * L * p.s * 0.08 * Math.sin(t * 6 - du * 10) * Math.max(0, 1 - du * 1.4);
    spine[i] = {
      x: p.x,
      y: p.y - h * 0.42 + Math.sin(ph - u * 5.5) * amp * p.s * env * 0.5 + extra,
      top: h * 0.58 * prof,
      bot: h * 0.42 * prof,
      floor: p.y,
    };
  }
  return spine;
}

function sample(spine, u) {
  const n = spine.length;
  const f = clamp(u) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  const a = spine[i];
  const b = spine[i + 1];
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    top: lerp(a.top, b.top, k),
    bot: lerp(a.bot, b.bot, k),
    floor: lerp(a.floor, b.floor, k),
  };
}

// 体の表面上の点。u = 0(しっぽ)〜1(頭)、v = -1(背中)〜 +1(足)
function bodyPoint(spine, u, v) {
  const p = sample(spine, u);
  return { x: p.x, y: p.y + v * (v < 0 ? p.top : p.bot) };
}

// 画面上での、しっぽ → 頭 方向の向き(長さ1)
function tangent(spine, u) {
  const a = sample(spine, u - 0.04);
  const b = sample(spine, u + 0.04);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// 節ごとの楕円をつなげた、体の形。grow で外側へふくらませ、ruffle で縁を波打たせる
function bodyShape(spine, { grow = 0, ruffleAmp = 0, ruffleFreq = 1, shift = 0 } = {}) {
  const path = new Path2D();
  let prev = sample(spine, 0);
  for (let s = 0; s <= OUTLINE_SAMPLES; s++) {
    const u = s / OUTLINE_SAMPLES;
    const p = sample(spine, u);
    const next = sample(spine, Math.min(1, u + 1 / OUTLINE_SAMPLES));
    const r = Math.sin(u * ruffleFreq * Math.PI + shift) * ruffleAmp;
    const topY = p.y - p.top - grow - r;
    const botY = Math.min(p.y + p.bot + grow * 0.4 + Math.abs(r) * 0.3, p.floor + grow * 0.2);
    const ry = Math.max(0.5, (botY - topY) / 2);
    const spacing = Math.max(Math.abs(next.x - p.x), Math.abs(p.x - prev.x));
    const rx = Math.max(spacing * 0.8, ry * 0.55) + grow;
    const cy = (topY + botY) / 2;
    path.moveTo(p.x + rx, cy);
    path.ellipse(p.x, cy, rx, ry, 0, 0, TAU);
    prev = p;
  }
  return path;
}

// 形の外側だけに輪郭を描く(形の内側に線が入らないように、下書きキャンバスで切り抜く)
function drawOutline(ctx, scratch, shape, grownShape, color) {
  const sctx = scratch.getContext('2d');
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, scratch.width, scratch.height);
  sctx.setTransform(ctx.getTransform());
  sctx.fillStyle = color;
  sctx.fill(grownShape);
  sctx.globalCompositeOperation = 'destination-out';
  sctx.fill(shape);
  sctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

// 外側に輪郭をつけた太い線(触角やエラに使う)
function outlinedLine(ctx, a, b, width, color, outline, lw) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = width + lw * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawPattern(ctx, type, spine, c, L, bodyH, color, alpha) {
  if (alpha <= 0.01) return;
  const seed = c.seed;
  ctx.globalAlpha = alpha;
  if (type === 'spots') {
    const count = 7 + Math.floor(hash(seed, 1) * 6);
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const p = bodyPoint(spine, 0.08 + hash(seed, 10 + i) * 0.84, hash(seed, 30 + i) * 1.8 - 1);
      const r = bodyH * lerp(0.07, 0.19, hash(seed, 50 + i));
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
  } else if (type === 'stripes') {
    const count = 6 + Math.floor(hash(seed, 2) * 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = L * lerp(0.025, 0.045, hash(seed, 3));
    ctx.lineCap = 'butt';
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      const a = bodyPoint(spine, u - 0.03, -1.3);
      const b = bodyPoint(spine, u + 0.03, 1.3);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  } else if (type === 'net') {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, L * 0.014);
    for (let i = -2; i < 12; i++) {
      const u0 = i / 10;
      for (const d of [0.22, -0.22]) {
        ctx.beginPath();
        for (let s = 0; s <= 4; s++) {
          const p = bodyPoint(spine, u0 + (d * s) / 4, -1.2 + (s / 4) * 2.4);
          if (s === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }
  } else if (type === 'gradient') {
    const tail = sample(spine, 0);
    const head = sample(spine, 1);
    const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.fillRect(Math.min(tail.x, head.x) - L, Math.min(tail.y, head.y) - L, Math.abs(head.x - tail.x) + L * 2, Math.abs(head.y - tail.y) + L * 2);
  }
  ctx.globalAlpha = 1;
}

// 突起(背中のひらひら)の形を計算する
function spikeShapes(c, spine, g, L, t) {
  const n = Math.round(g.spikeCount * 22);
  const shrink = 1 - 0.65 * clamp(c.touch.shrink, -0.25, 1);
  const shapes = [];
  for (let j = 0; j < n; j++) {
    const h1 = hash(c.seed, 100 + j);
    const h2 = hash(c.seed, 200 + j);
    const u = lerp(0.12, 0.84, (j + 0.5) / n) + (h1 - 0.5) * 0.03;
    const base = bodyPoint(spine, u, -0.9);
    const hx = tangent(spine, u).x; // 頭の向き(画面の左右)
    const ends = 0.55 + 0.45 * Math.sin(Math.PI * u);
    const len = L * (0.05 + 0.42 * g.spikeLength) * (0.75 + 0.5 * h2) * ends * shrink;
    const baseW = L * lerp(0.075, 0.036, g.spikeCount) * lerp(0.85, 1.25, h1);
    const sway = Math.sin(t * 1.1 + j * 0.9 + c.phase * 0.6) * (0.08 + 0.3 * g.spikeLength);
    // しっぽ側へなびく
    const ang = -Math.PI / 2 - hx * (0.3 + 0.35 * (1 - u)) + sway;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const nx = -dy;
    const ny = dx;
    const curl = Math.sin(t * 1.5 + j * 1.3) * 0.3 * g.spikeLength;
    shapes.push({
      base,
      tip: { x: base.x + dx * len, y: base.y + dy * len },
      mid: { x: base.x + dx * len * 0.55 + nx * len * curl, y: base.y + dy * len * 0.55 + ny * len * curl },
      nx,
      ny,
      w: Math.min(baseW, len * 0.9 + L * 0.01),
    });
  }
  return shapes;
}

/**
 * @param ctx      描画先(画面と同じ座標で描けるように設定済み)
 * @param scratch  輪郭用の下書きキャンバス(ctx のキャンバスと同じ大きさ)
 * @param c        Creature
 * @param pts      画面に写した節(しっぽ → 頭)
 * @param L        手前にいるときの体の長さ(px)。太さや突起の基準
 * @param t        時間(秒)
 * @param pixelScale  shadowBlur 用の拡大率(shadowBlur は座標変換の影響を受けないため)
 * @returns 背骨(当たり判定用)
 */
export function drawCreature(ctx, scratch, c, pts, L, t, pixelScale = 1) {
  const g = c.expressed;
  const tc = c.touch;
  const H1 = g.hue * 360;
  const H2 = g.hue2 * 360;
  const sAvg = pts.reduce((sum, p) => sum + p.s, 0) / pts.length;
  const Ls = L * sAvg;
  const aspect = lerp(4.4, 1.9, g.bodyLength);
  const bodyH = (L / aspect) * 1.25;
  const spine = buildSpine(c, pts, L, bodyH, t);
  const lw = Math.max(2, Ls * 0.04);

  const clear = tc.clear;
  const bodyA = lerp(0.97, 0.42, g.translucency) * (1 - 0.65 * clear);
  const lineA = lerp(1, 0.7, g.translucency) * (1 - 0.35 * clear);
  const skirtA = lerp(0.55, 0.25, g.translucency) * (1 - 0.5 * clear);
  const outline = `hsla(${H1}, 80%, 7%, ${lineA})`;

  const ruffleFreq = 4 + g.edgeRuffle * 11;
  const shift = c.phase * 0.7;
  const bodyBase = { ruffleAmp: g.edgeRuffle * bodyH * sAvg * 0.06, ruffleFreq, shift };
  const bodyPath = bodyShape(spine, bodyBase);
  const skirtBase = {
    grow: bodyH * sAvg * (0.08 + 0.2 * g.edgeRuffle),
    ruffleAmp: g.edgeRuffle * bodyH * sAvg * 0.2,
    ruffleFreq: ruffleFreq * 1.6,
    shift: shift * 1.3,
  };
  const skirtPath = bodyShape(spine, skirtBase);
  const spikes = spikeShapes(c, spine, g, Ls, t);
  const headDir = tangent(spine, 0.95).x;

  ctx.lineJoin = 'round';

  // ぼんやり発光
  const glowA = g.glow > 0.12 ? smoothstep((g.glow - 0.12) / 0.88) * (0.75 + 0.25 * Math.sin(t * 0.9 + c.seed)) : 0;
  if (glowA > 0) {
    ctx.save();
    ctx.shadowColor = `hsla(${H2}, 100%, 65%, ${glowA})`;
    ctx.shadowBlur = Ls * 0.4 * glowA * pixelScale;
    ctx.fillStyle = `hsla(${H2}, 100%, 60%, ${0.3 * glowA})`;
    ctx.fill(skirtPath);
    ctx.restore();
  }

  // 縁のひらひら(体の後ろ、半透明)
  ctx.fillStyle = `hsla(${H2}, 95%, 58%, ${skirtA})`;
  ctx.fill(skirtPath);
  drawOutline(ctx, scratch, skirtPath, bodyShape(spine, { ...skirtBase, grow: skirtBase.grow + lw * 0.6 }), `hsla(${H1}, 80%, 7%, ${lineA * 0.6})`);

  // エラ(しっぽ側の小さな房)
  const gill = bodyPoint(spine, 0.2, -0.8);
  const gillShrink = 1 - 0.5 * clamp(tc.shrink, -0.25, 1);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 - headDir * 0.2 + (i - 2) * 0.35 + Math.sin(t * 1.3 + i) * 0.08;
    const len = Ls * 0.09 * gillShrink;
    outlinedLine(ctx, gill, { x: gill.x + Math.cos(a) * len, y: gill.y + Math.sin(a) * len }, Ls * 0.02, `hsla(${H2}, 100%, 70%, ${Math.max(bodyA, 0.5)})`, outline, lw * 0.5);
  }

  // 突起(根元は体の色、先は2つ目の色で透ける)
  for (const s of spikes) {
    const grad = ctx.createLinearGradient(s.base.x, s.base.y, s.tip.x, s.tip.y);
    grad.addColorStop(0, `hsla(${H1}, 100%, 54%, ${bodyA})`);
    grad.addColorStop(0.55, `hsla(${H2}, 100%, 62%, ${bodyA * 0.95})`);
    grad.addColorStop(1, `hsla(${H2}, 100%, 74%, ${bodyA * 0.55})`);
    ctx.beginPath();
    ctx.moveTo(s.base.x - s.nx * s.w * 0.5, s.base.y - s.ny * s.w * 0.5);
    ctx.quadraticCurveTo(s.mid.x - s.nx * s.w * 0.35, s.mid.y - s.ny * s.w * 0.35, s.tip.x, s.tip.y);
    ctx.quadraticCurveTo(s.mid.x + s.nx * s.w * 0.35, s.mid.y + s.ny * s.w * 0.35, s.base.x + s.nx * s.w * 0.5, s.base.y + s.ny * s.w * 0.5);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = lw * 0.5;
    ctx.stroke();
  }

  // 体
  ctx.fillStyle = `hsla(${H1}, 100%, 55%, ${bodyA})`;
  ctx.fill(bodyPath);

  // 模様(体の形で切り抜く。境目の値では2つの模様が混ざりかける)
  const mix = patternMix(g.pattern);
  const patA = lerp(1, 0.6, g.translucency) * (1 - 0.5 * clear);
  const patColor = `hsl(${H2}, 100%, 60%)`;
  ctx.save();
  ctx.clip(bodyPath);
  drawPattern(ctx, mix.main, spine, c, Ls, bodyH * sAvg, patColor, patA * (1 - mix.amount));
  if (mix.amount > 0) drawPattern(ctx, mix.other, spine, c, Ls, bodyH * sAvg, patColor, patA * mix.amount);
  ctx.restore();

  // ハイライト(1本だけの明るい線)
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const p = bodyPoint(spine, 0.35 + (i / 8) * 0.42, -0.55);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = `hsla(${H1}, 100%, 92%, ${0.75 * bodyA})`;
  ctx.lineWidth = Ls * 0.025;
  ctx.lineCap = 'round';
  ctx.stroke();

  // 輪郭
  drawOutline(ctx, scratch, bodyPath, bodyShape(spine, { ...bodyBase, grow: lw }), outline);

  // 触角(頭の2本)。弾くと少し引っ込む
  const hornLen = Ls * 0.15 * (1 - 0.45 * clamp(tc.shrink, -0.25, 1));
  for (const [u, lean] of [
    [0.86, 0.35],
    [0.92, 0.65],
  ]) {
    const b = bodyPoint(spine, u, -0.85);
    const a = -Math.PI / 2 + headDir * lean + Math.sin(t * 0.8 + u * 9) * 0.1;
    const tip = { x: b.x + Math.cos(a) * hornLen, y: b.y + Math.sin(a) * hornLen };
    outlinedLine(ctx, b, tip, Ls * 0.035, `hsla(${H2}, 100%, 62%, ${Math.max(bodyA, 0.6)})`, outline, lw * 0.6);
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, Ls * 0.022, 0, TAU);
    ctx.fillStyle = `hsl(${H1}, 100%, 75%)`;
    ctx.fill();
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 撫でた場所がふわっと光る
  for (const gl of tc.glows) {
    const k = gl.age / 1.2;
    if (k >= 1) continue;
    const p = bodyPoint(spine, gl.u, -0.3);
    const r = bodyH * sAvg * (0.55 + k * 0.7);
    const a = 0.45 * Math.sin(Math.PI * Math.min(1, k * 3)) * (1 - k);
    const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    rg.addColorStop(0, `hsla(${H2}, 100%, 82%, ${a})`);
    rg.addColorStop(0.5, `hsla(${H2}, 100%, 65%, ${a * 0.45})`);
    rg.addColorStop(1, `hsla(${H2}, 100%, 60%, 0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }

  // 突起の先がほのかに光る
  if (glowA > 0 && spikes.length) {
    ctx.fillStyle = `hsla(${H2}, 100%, 70%, ${0.6 * glowA})`;
    for (const s of spikes) {
      ctx.beginPath();
      ctx.arc(s.tip.x, s.tip.y, Math.max(1.2, s.w * 0.45), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  return spine;
}
