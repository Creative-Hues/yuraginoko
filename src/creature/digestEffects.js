// 消化中に体の中に見えるエフェクト。どのエサがどれを使うかは genes.js の FOODS[...].digest で決める。
// 新しい種類を足すときは、EFFECTS に関数を1つ足す。
//
// 各関数は (ctx, body, color, p) を受け取る。
// - body: { path(体の形), point(u, v), length(体の長さ), height(体の厚み), seed }
//     point は体の表面上の点(u: 0 = しっぽ〜1 = 頭、v: -1 = 背中〜+1 = 足)
// - p: 消化の進み具合(0〜1)
// 描く前に体の形で切り抜いてある。色はふつうに重ね(色が白っぽく飛ばないように)、
// 光らせたいところだけ lighter で明るくする。
import { FOODS } from './genes.js';
import { clamp, lerp, smoothstep } from '../util/math.js';

const TAU = Math.PI * 2;

function hash(seed, i) {
  const s = Math.sin(seed * 0.0001 + i * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// 16進の色 → "r, g, b"
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function glowDot(ctx, x, y, r, c, a) {
  if (r <= 0 || a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${c}, ${a})`);
  g.addColorStop(0.6, `rgba(${c}, ${a * 0.6})`);
  g.addColorStop(1, `rgba(${c}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function lighter(ctx, fn) {
  ctx.globalCompositeOperation = 'lighter';
  fn();
  ctx.globalCompositeOperation = 'source-over';
}

export const EFFECTS = {
  // 体の真ん中から、光がじわっとにじんで広がり、ゆっくり引いていく
  seep(ctx, body, color, p) {
    const c = rgb(color);
    const a = Math.sin(Math.PI * p);
    const spread = smoothstep(clamp(p * 1.6));
    const mid = body.point(0.5, 0.1);
    const r = body.length * lerp(0.1, 0.7, spread);
    glowDot(ctx, mid.x, mid.y, r, c, 0.75 * a);
    // にじみの縁に、少しむらをつける
    for (let i = 0; i < 6; i++) {
      const q = body.point(0.5 + (hash(body.seed, i) - 0.5) * 0.85 * spread, hash(body.seed, i + 9) * 1.2 - 0.6);
      glowDot(ctx, q.x, q.y, body.height * lerp(0.3, 0.9, spread), c, 0.5 * a);
    }
    lighter(ctx, () => glowDot(ctx, mid.x, mid.y, r * 0.35, c, 0.35 * a));
  },

  // 波が頭からしっぽへ3回流れる
  wave(ctx, body, color, p) {
    const c = rgb(color);
    const passes = 3;
    for (let k = 0; k < passes; k++) {
      const local = p * (passes + 0.6) - k * 1.05; // 少しずつ重ねて流す
      if (local <= 0 || local >= 1) continue;
      const u = 1.05 - local * 1.1; // 頭 → しっぽ
      const a = Math.sin(Math.PI * local);
      const band = (du, w, alpha) => {
        const top = body.point(u + du, -1.4);
        const bot = body.point(u + du, 1.4);
        ctx.strokeStyle = `rgba(${c}, ${alpha})`;
        ctx.lineWidth = body.height * w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bot.x, bot.y);
        ctx.stroke();
      };
      band(0.07, 0.4, 0.35 * a); // 後ろに尾を引く
      band(0, 0.6, 0.7 * a);
      lighter(ctx, () => band(0, 0.18, 0.5 * a)); // 波の芯
    }
  },

  // 小さな粒が、体の中のあちこちでふくらんで、ぱちっと弾ける
  sparkle(ctx, body, color, p) {
    const c = rgb(color);
    const count = 24;
    for (let i = 0; i < count; i++) {
      const start = hash(body.seed, 20 + i) * 0.75;
      const local = (p - start) / 0.25;
      if (local <= 0 || local >= 1) continue;
      const q = body.point(0.12 + hash(body.seed, 40 + i) * 0.76, hash(body.seed, 60 + i) * 1.4 - 0.7);
      const r = body.height * lerp(0.13, 0.2, hash(body.seed, 80 + i));
      if (local < 0.55) {
        // ふくらむ
        const k = local / 0.55;
        ctx.fillStyle = `rgba(${c}, ${0.95 * k})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r * lerp(0.3, 1, k), 0, TAU);
        ctx.fill();
        lighter(ctx, () => glowDot(ctx, q.x, q.y, r * 1.8, c, 0.4 * k));
      } else {
        // 弾ける:光の線が外へ飛ぶ
        const k = (local - 0.55) / 0.45;
        lighter(ctx, () => glowDot(ctx, q.x, q.y, r * 2.2, c, 0.5 * (1 - k)));
        ctx.strokeStyle = `rgba(${c}, ${1 - k})`;
        ctx.lineWidth = Math.max(1, r * 0.4);
        ctx.lineCap = 'round';
        for (let j = 0; j < 6; j++) {
          const ang = (j / 6) * TAU + i;
          const r0 = r * lerp(0.5, 1.8, k);
          const r1 = r * lerp(1.1, 2.8, k);
          ctx.beginPath();
          ctx.moveTo(q.x + Math.cos(ang) * r0, q.y + Math.sin(ang) * r0);
          ctx.lineTo(q.x + Math.cos(ang) * r1, q.y + Math.sin(ang) * r1);
          ctx.stroke();
        }
      }
    }
  },

  // 体全体が、ゆっくり脈を打つように3回明るくなる
  pulse(ctx, body, color, p) {
    const c = rgb(color);
    const beat = 0.5 - 0.5 * Math.cos(p * 3 * TAU);
    const a = beat * Math.pow(Math.sin(Math.PI * p), 0.4);
    ctx.fillStyle = `rgba(${c}, ${0.45 * a})`;
    ctx.fill(body.path);
    const mid = body.point(0.5, 0);
    lighter(ctx, () => glowDot(ctx, mid.x, mid.y, body.length * 0.55, c, 0.55 * a));
  },
};

export const DIGEST_EFFECT_TYPES = Object.keys(EFFECTS);

// 消化中のエフェクトを描く。体の形で切り抜く
export function drawDigestEffect(ctx, body, foodKey, p) {
  const def = FOODS[foodKey]?.digest;
  const fn = def && EFFECTS[def.effect];
  if (!fn || p <= 0 || p >= 1) return;
  ctx.save();
  ctx.clip(body.path);
  fn(ctx, body, def.color, p);
  ctx.restore();
}
