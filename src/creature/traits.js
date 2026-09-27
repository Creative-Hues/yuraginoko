// 特徴遺伝子(生まれつきの5項目:突起の数・泳ぎ方の激しさ・尾の長さ・触角の長さ・点滅する光模様)。
// 環境・エサ・触れ合いでは変わらない。変わるのは、子どもに受け継がれるときと突然変異のときだけ。
// 描画はしない。定義は genes.js の TRAIT_DEFS、調整値は lifeConfig.js の TRAITS。
import { TRAIT_DEFS, TRAIT_KEYS } from './genes.js';
import { TRAITS } from './lifeConfig.js';
import { clamp, lerp } from '../util/math.js';
import { makeRng } from '../util/random.js';

const { BLINK } = TRAITS;
const NUMERIC_KEYS = TRAIT_DEFS.filter((d) => !d.blink).map((d) => d.key);
const within = ([a, b], rng) => lerp(a, b, rng());
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// 点滅する光模様を持っているか
export function hasBlink(traits) {
  return (traits?.blink ?? 0) >= BLINK.HAS;
}

// 最初の2匹:数値の特徴はランダム、点滅する光模様は FIRST_CHANCE の確率で弱めに持つ
export function randomTraits(rng) {
  const t = {};
  for (const k of NUMERIC_KEYS) t[k] = rng();
  t.blink = rng() < BLINK.FIRST_CHANCE ? within(BLINK.FIRST, rng) : 0;
  return t;
}

// seed から決まる特徴(特徴遺伝子を持たない古いデータ用。毎回同じ結果になる)
export function traitsFromSeed(seed) {
  return randomTraits(makeRng(((Number(seed) || 0) ^ 0x7a17c) >>> 0));
}

/**
 * 保存されていた特徴遺伝子を読み込む。
 * - traits にあれば、それを使う
 * - 無ければ、古いデータの genes にある値(突起の数・泳ぎ方の激しさ)を引き継ぐ
 * - それも無ければ seed から決める(尾の長さ・触角の長さ・点滅する光模様)
 */
export function normalizeTraits(saved, oldGenes, seed) {
  const fromSeed = traitsFromSeed(seed);
  const t = {};
  for (const k of TRAIT_KEYS) {
    const v = isNum(saved?.[k]) ? saved[k] : isNum(oldGenes?.[k]) ? oldGenes[k] : fromSeed[k];
    t[k] = clamp(v);
  }
  return t;
}

// 数値の特徴を大きく振る:両親の中間 mid から JUMP だけ離す(はみ出す向きなら反対へ)
function jump(mid, rng) {
  const amount = within(TRAITS.JUMP, rng);
  let d = rng() < 0.5 ? -amount : amount;
  if (mid + d > 1 || mid + d < 0) d = -d;
  return clamp(mid + d);
}

// 点滅する光模様の受け継ぎ
function inheritBlink(a, b, rng) {
  const hasA = hasBlink(a);
  const hasB = hasBlink(b);
  if (hasA && hasB) {
    if (rng() >= BLINK.BOTH) return 0;
    const v = (a.blink + b.blink) / 2 + (rng() * 2 - 1) * TRAITS.MIX_JITTER;
    return clamp(v, BLINK.HAS, 1);
  }
  if (hasA || hasB) {
    if (rng() >= BLINK.ONE) return 0;
    return clamp((hasA ? a.blink : b.blink) * BLINK.ONE_SCALE, BLINK.HAS, 1);
  }
  return 0;
}

/**
 * 赤ちゃんの特徴遺伝子。両親 a, b は特徴遺伝子({ spikeCount, … })。
 * - 数値の特徴:両親の中間を、ほんの少しゆらす
 * - 点滅する光模様:両親とも持っていればほぼ必ず、片方だけなら半分の確率で受け継ぐ
 * - MUTATION_CHANCE の確率で、どれか1つに突然変異
 * 返す値:{ traits, mutation }(mutation は突然変異の記録。起きなければ null)
 * mutationChance: 突然変異の確率(ふだんは TRAITS.MUTATION_CHANCE。確認用に変えられる)
 */
export function inheritTraits(a, b, rng, mutationChance = TRAITS.MUTATION_CHANCE) {
  const pa = normalizeTraits(a);
  const pb = normalizeTraits(b);
  const traits = {};
  for (const k of NUMERIC_KEYS) traits[k] = clamp((pa[k] + pb[k]) / 2 + (rng() * 2 - 1) * TRAITS.MIX_JITTER);
  traits.blink = inheritBlink(pa, pb, rng);

  let mutation = null;
  if (rng() < mutationChance) {
    const key = TRAIT_KEYS[Math.min(TRAIT_KEYS.length - 1, Math.floor(rng() * TRAIT_KEYS.length))];
    if (key === 'blink') {
      const before = traits.blink;
      let change;
      if (!hasBlink(traits)) {
        change = 'appear';
        traits.blink = within(BLINK.APPEAR, rng);
      } else if (rng() < 0.5) {
        change = 'stronger';
        traits.blink = clamp(traits.blink + within(BLINK.CHANGE, rng));
      } else {
        change = 'weaker';
        traits.blink = clamp(traits.blink - within(BLINK.CHANGE, rng), BLINK.HAS, 1);
      }
      mutation = { kind: 'trait', key, change, delta: traits.blink - before };
    } else {
      const mid = (pa[key] + pb[key]) / 2;
      traits[key] = jump(mid, rng);
      mutation = { kind: 'trait', key, delta: traits[key] - mid };
    }
  }
  return { traits, mutation };
}

// 標本画面の「生まれつきの特徴」:[{ label, text }](例:{ label: '尾', text: '長い' })
export function traitLines(traits) {
  const t = normalizeTraits(traits);
  return TRAIT_DEFS.map((d) => {
    const v = t[d.key];
    let i;
    if (d.blink) i = v < BLINK.HAS ? 0 : v < 0.5 ? 1 : 2;
    else i = v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2;
    return { label: d.short, text: d.words[i] };
  });
}
