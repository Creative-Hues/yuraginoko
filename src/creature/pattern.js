// 模様:斑点・縞・網目・グラデーションの4「種類」。
// 生き物ごとに、種類ごとの濃さ(足すと1)を持つ。ふだんは1種類だけが 1。
// 環境で変わるときは、目標の種類の濃さを上げ、ほかの種類を同じ割合で薄くする
// (途中でほかの模様を通らず、今の模様が薄れながら、目標の模様が浮かんでくる)。
//
// 前は遺伝子 genes.pattern(0〜1 の数字を4つに区切る)だった。古いデータは、そのとき見えていた模様に置きかえて読む。
import { clamp } from '../util/math.js';

export const PATTERN_TYPES = ['spots', 'stripes', 'net', 'gradient'];
export const PATTERN_NAMES = { spots: '斑点', stripes: 'しま', net: '網目', gradient: 'グラデーション' };

const SETTLED = 0.99; // いちばん濃い模様がこれ以上なら、移り変わりは終わっている
const MIN_SHOWN = 0.01; // これより薄い模様は描かない・保存しない

const empty = () => Object.fromEntries(PATTERN_TYPES.map((k) => [k, 0]));

// 1種類だけの模様
export function solidPattern(kind) {
  const p = empty();
  p[PATTERN_TYPES.includes(kind) ? kind : PATTERN_TYPES[0]] = 1;
  return p;
}

// 古い数字の模様(0〜1)→ 濃さ。境目の近くでは、となりの模様が少し混ざっていた(前の見え方のまま)
export function patternFromValue(value) {
  const scaled = clamp(value) * PATTERN_TYPES.length;
  const index = Math.min(PATTERN_TYPES.length - 1, Math.floor(scaled));
  const frac = scaled - index;
  const edge = 0.12;
  let other = index;
  let amount = 0;
  if (frac > 1 - edge && index < PATTERN_TYPES.length - 1) {
    other = index + 1;
    amount = ((frac - (1 - edge)) / edge) * 0.5;
  } else if (frac < edge && index > 0) {
    other = index - 1;
    amount = ((edge - frac) / edge) * 0.5;
  }
  const p = empty();
  p[PATTERN_TYPES[index]] += 1 - amount;
  p[PATTERN_TYPES[other]] += amount;
  return p;
}

// 足して1にする(全部 0 なら null)
function normalized(p) {
  const sum = PATTERN_TYPES.reduce((s, k) => s + p[k], 0);
  if (!(sum > 0)) return null;
  for (const k of PATTERN_TYPES) p[k] /= sum;
  return p;
}

/**
 * 保存されていた模様を読む。
 * saved: { spots: 0.3, net: 0.7 } のような濃さ / legacy: 古い genes.pattern の数字 / どちらもなければ rng で1種類
 */
export function normalizePattern(saved, legacy, rng = Math.random) {
  if (saved && typeof saved === 'object') {
    const p = empty();
    for (const k of PATTERN_TYPES) {
      const v = saved[k];
      p[k] = typeof v === 'number' && Number.isFinite(v) ? clamp(v) : 0;
    }
    const ok = normalized(p);
    if (ok) return ok;
  }
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return patternFromValue(legacy);
  return solidPattern(PATTERN_TYPES[Math.min(PATTERN_TYPES.length - 1, Math.floor(rng() * PATTERN_TYPES.length))]);
}

// 保存する形(薄すぎるものは外し、小数3桁まで)
export function compactPattern(p) {
  const out = {};
  for (const k of PATTERN_TYPES) if (p[k] >= MIN_SHOWN) out[k] = Math.round(p[k] * 1000) / 1000;
  return Object.keys(out).length ? out : { [mainPattern(p)]: 1 };
}

// いちばん濃い模様(今の模様)
export function mainPattern(p) {
  let best = PATTERN_TYPES[0];
  for (const k of PATTERN_TYPES) if ((p?.[k] ?? 0) > (p?.[best] ?? 0)) best = k;
  return best;
}

// 描く模様:[{ type, amount }](薄すぎるものは除く)
export function patternLayers(p) {
  return PATTERN_TYPES.filter((k) => p[k] >= MIN_SHOWN).map((k) => ({ type: k, amount: p[k] }));
}

// 移り変わっている途中か
export function patternSettled(p) {
  return p[mainPattern(p)] >= SETTLED;
}

// kind の濃さを amount だけ上げ(1まで)、ほかを同じ割合で薄くする。p を直接変える。実際に上げた量を返す
export function movePattern(p, kind, amount) {
  if (!PATTERN_TYPES.includes(kind) || !(amount > 0)) return 0;
  const before = p[kind];
  const after = Math.min(1, before + amount);
  const rest = 1 - before;
  const scale = rest > 0 ? (1 - after) / rest : 0;
  for (const k of PATTERN_TYPES) if (k !== kind) p[k] *= scale;
  p[kind] = after;
  if (after >= 1 - 1e-9) {
    for (const k of PATTERN_TYPES) p[k] = 0;
    p[kind] = 1;
  }
  return after - before;
}

// 赤ちゃんの模様:両親どちらかの「今の模様」を、1種類だけで受け継ぐ
export function inheritPattern(a, b, rng) {
  const from = rng() < 0.5 ? a : b;
  return from ? mainPattern(from) : PATTERN_TYPES[Math.min(PATTERN_TYPES.length - 1, Math.floor(rng() * PATTERN_TYPES.length))];
}

// 突然変異:今とちがう種類のどれか
export function otherPattern(kind, rng) {
  const others = PATTERN_TYPES.filter((k) => k !== kind);
  return others[Math.min(others.length - 1, Math.floor(rng() * others.length))];
}
