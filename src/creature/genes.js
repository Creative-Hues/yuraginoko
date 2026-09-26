// 生き物の遺伝子の定義。
// 項目を足す・調整するときは、このファイルだけを直せばよいようにしてある。
//
// - 値はすべて 0〜1
// - wobble: 表示中に揺れる幅(基本値 ± wobble)。保存されるのは基本値だけ
// - period: 揺れの1往復のおおよその秒数
// - wrap:   true なら 0 と 1 がつながっている(色相など)
import { clamp, wrap01 } from '../util/math.js';
import { wave } from '../util/noise.js';

export const GENE_GROUPS = {
  shape: '形',
  color: '色と模様',
  motion: '動き',
};

export const GENE_DEFS = [
  // 形
  { key: 'bodyLength', group: 'shape', label: '体の長さ', low: '細長い', high: 'ずんぐり', wobble: 0.012, period: 29 },
  { key: 'spikeCount', group: 'shape', label: '突起の数', low: 'つるつる', high: 'トゲだらけ', wobble: 0.01, period: 37 },
  { key: 'spikeLength', group: 'shape', label: '突起の長さ', low: '短いこぶ', high: '長いひらひら', wobble: 0.015, period: 23 },
  { key: 'edgeRuffle', group: 'shape', label: '縁のうねり', low: 'まっすぐ', high: 'フリル状', wobble: 0.015, period: 19 },
  // 色と模様
  { key: 'hue', group: 'color', label: '基本の色', low: '色相 0°', high: '色相 360°', wobble: 0.01, period: 41, wrap: true },
  { key: 'hue2', group: 'color', label: '2つ目の色', low: '色相 0°', high: '色相 360°', wobble: 0.012, period: 31, wrap: true },
  { key: 'pattern', group: 'color', label: '模様の種類', low: '斑点', high: 'グラデーション', wobble: 0.012, period: 43 },
  { key: 'translucency', group: 'color', label: '透明度', low: '不透明', high: '透ける', wobble: 0.015, period: 17 },
  { key: 'glow', group: 'color', label: '光り方', low: '光らない', high: 'ぼんやり発光', wobble: 0.02, period: 13 },
  // 動き
  { key: 'crawlSpeed', group: 'motion', label: '這う速さ', low: 'のんびり', high: 'すいすい', wobble: 0.01, period: 53 },
  { key: 'floatiness', group: 'motion', label: '浮きやすさ', low: '底が好き', high: 'よく浮く', wobble: 0.01, period: 47 },
  { key: 'wriggliness', group: 'motion', label: 'うねりやすさ', low: 'おだやか', high: 'よくうねる', wobble: 0.01, period: 59 },
];

export const GENE_KEYS = GENE_DEFS.map((d) => d.key);

// pattern の値を4つに区切って模様を決める(0〜0.25 斑点、…、0.75〜1 グラデーション)
export const PATTERN_TYPES = ['spots', 'stripes', 'net', 'gradient'];

// 触れ合うたびに、遺伝子の基本値がほんの少し動く(1回あたりの量)
export const TOUCH_DRIFT = {
  stroke: { translucency: +0.005 }, // 撫でる → 透けていく
  flick: { spikeLength: -0.005 }, // 弾く → 突起が短くなっていく
};

// エサの種類(観察モードであげる)。消化すると、遺伝子の基本値が少しだけ動く。
// - hueToward: 基本の色(hue)を、この色相へ近いほうの回り方で寄せる
// - glow:      光り方(glow)を強くする(+1)
// - color / shine: エサの粒・ボタン・排泄の粒の見た目
// - digest: 消化中に体の中に見えるエフェクト(effect の種類は src/creature/digestEffects.js)
//     seep: 光がじわっとにじんで広がる / wave: 波が頭からしっぽへ流れる
//     sparkle: 小さな粒がぱちぱち弾ける / pulse: 体全体が脈を打つように明るくなる
export const FOODS = {
  red: { label: '赤いエサ', color: '#ff3b5c', hueToward: 0.0, digest: { effect: 'seep', color: '#ff3b5c' } },
  blue: { label: '青いエサ', color: '#3b7bff', hueToward: 0.62, digest: { effect: 'wave', color: '#3b9bff' } },
  yellow: { label: '黄色いエサ', color: '#ffd23b', hueToward: 0.16, digest: { effect: 'sparkle', color: '#ffe066' } },
  glow: { label: '光るエサ', color: '#c6ff3d', shine: true, glow: +1, digest: { effect: 'pulse', color: '#d8ff6a' } },
};
export const FOOD_KEYS = Object.keys(FOODS);

export const DIGEST_STEP = 0.08; // 1回の消化で、基本値が動く量
export const DIGEST_SECONDS = 4; // 消化で色が変わりきるまで(秒)
export const MEAL_REST_SECONDS = 60; // エサ → 消化 → 排泄 の1周のあと、休む時間(秒)

const DEF_BY_KEY = Object.fromEntries(GENE_DEFS.map((d) => [d.key, d]));

function fit(def, v) {
  return def?.wrap ? wrap01(v) : clamp(v);
}

export function randomGenes(rng) {
  const genes = {};
  for (const def of GENE_DEFS) genes[def.key] = rng();
  return genes;
}

// 保存されていた遺伝子を読み込む。
// 後から項目が増えたときは、足りない項目だけ乱数で補う(古いデータもそのまま使える)。
export function normalizeGenes(saved, rng) {
  const genes = { ...(saved ?? {}) };
  for (const def of GENE_DEFS) {
    const v = genes[def.key];
    genes[def.key] = typeof v === 'number' && Number.isFinite(v) ? fit(def, v) : rng();
  }
  return genes;
}

// 揺らぎを加えた「今この瞬間の値」を返す。t は秒、seed は個体ごとの数。
export function expressGenes(genes, t, seed, out = {}) {
  const base = (seed % 10007) * 0.37;
  for (let i = 0; i < GENE_DEFS.length; i++) {
    const def = GENE_DEFS[i];
    const n = wave(t / def.period, base + i * 7.13);
    out[def.key] = fit(def, genes[def.key] + n * def.wobble);
  }
  return out;
}

// 基本値の変化 drift({ key: 変化量 })を k 倍して、genes に直接反映する。変化があれば true。
export function nudgeGenes(genes, drift, k = 1) {
  let changed = false;
  for (const [key, delta] of Object.entries(drift)) {
    if (!DEF_BY_KEY[key] || typeof delta !== 'number') continue;
    const before = genes[key];
    genes[key] = fit(DEF_BY_KEY[key], before + delta * k);
    if (genes[key] !== before) changed = true;
  }
  return changed;
}

// 触れ合いによる基本値の変化を、genes に直接反映する。変化があれば true。
export function applyTouchDrift(genes, kind) {
  const drift = TOUCH_DRIFT[kind];
  return drift ? nudgeGenes(genes, drift) : false;
}

// エサを1回消化したときの基本値の変化(genes にはまだ反映しない)
export function foodDrift(genes, foodKey) {
  const food = FOODS[foodKey];
  const drift = {};
  if (!food) return drift;
  if (typeof food.hueToward === 'number') {
    let d = food.hueToward - genes.hue;
    d -= Math.round(d); // 近いほうの回り方(-0.5〜0.5)
    drift.hue = clamp(d, -DIGEST_STEP, DIGEST_STEP);
  }
  if (food.glow) drift.glow = Math.min(DIGEST_STEP, 1 - genes.glow);
  return drift;
}

// 模様の値から、主な模様と、境目付近で混ざりかけている隣の模様を求める
export function patternMix(value) {
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
  return { main: PATTERN_TYPES[index], other: PATTERN_TYPES[other], amount };
}

// (後のフェーズの交配用)2つの遺伝子から子の遺伝子を作る
export function mixGenes(a, b, rng, mutation = 0.03) {
  const child = {};
  for (const def of GENE_DEFS) {
    const pick = rng() < 0.5 ? a[def.key] : b[def.key];
    child[def.key] = fit(def, pick + (rng() * 2 - 1) * mutation);
  }
  return child;
}
