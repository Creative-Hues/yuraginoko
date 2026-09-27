// 繁殖で生まれる赤ちゃんの遺伝子(描画はしない)。調整値は lifeConfig.js。
import { GENE_DEFS, mixGenes } from './genes.js';
import { MUTATION } from './lifeConfig.js';
import { inheritSensitivity } from './sensitivity.js';
import { inheritTraits } from './traits.js';
import { compactPattern, inheritPattern, otherPattern, solidPattern } from './pattern.js';
import { clamp, lerp, wrap01 } from '../util/math.js';

const WRAP = Object.fromEntries(GENE_DEFS.map((d) => [d.key, !!d.wrap]));

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const within = ([a, b], rng) => lerp(a, b, rng());

// 遺伝子 key を大きくずらす量。範囲の外へはみ出す向きなら、反対の向きにする
function bigShift(genes, key, rng) {
  const amount = within(MUTATION.SHIFT, rng);
  let delta = rng() < 0.5 ? -amount : amount;
  if (!WRAP[key]) {
    const v = genes[key];
    if (v + delta > 1 || v + delta < 0) delta = -delta;
  }
  return delta;
}

/**
 * 両親 a, b({ genes, pattern, traits, sensitivity })から、赤ちゃんの遺伝子・模様・特徴遺伝子・変異の記録を作る。
 * - 環境で変わる遺伝子は両親の値を混ぜ(ふだんの小さなゆらぎつき)、必ず MUTATION.COUNT の範囲の項目数だけ大きくずらす
 * - 模様は、両親どちらかの今の模様を1種類で受け継ぐ。変異に選ばれたら、ほかの種類になる
 * - 特徴遺伝子は両親から受け継ぎ、ときどき突然変異する(traits.js)
 * - 環境の受けやすさは、項目ごとに両親のどちらかを受け継ぐ(ときどき変わる。sensitivity.js)
 */
export function makeChild(a, b, rng) {
  const genes = mixGenes(a.genes, b.genes, rng, MUTATION.MIX_JITTER);
  let pattern = inheritPattern(a.pattern, b.pattern, rng);
  const [lo, hi] = MUTATION.COUNT;
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const mutations = [];
  const shifted = new Set();
  for (let i = 0; i < count; i++) {
    const keys = MUTATION.SHIFT_KEYS.filter((k) => !shifted.has(k));
    if (!keys.length) break;
    const key = pick(keys, rng);
    shifted.add(key);
    if (key === 'pattern') {
      const to = otherPattern(pattern, rng);
      mutations.push({ kind: 'pattern', key, from: pattern, to });
      pattern = to;
      continue;
    }
    const delta = bigShift(genes, key, rng);
    genes[key] = WRAP[key] ? wrap01(genes[key] + delta) : clamp(genes[key] + delta);
    mutations.push({ kind: 'gene', key, delta });
  }
  const { traits, mutation } = inheritTraits(a.traits, b.traits, rng);
  if (mutation) mutations.push(mutation);
  const sensitivity = inheritSensitivity(a.sensitivity, b.sensitivity, rng);
  return { genes, pattern: compactPattern(solidPattern(pattern)), traits, mutations, sensitivity };
}

// 親の写し(標本画面で親の姿を出すため)。祖父母までは持たない
export function parentSnapshot(c) {
  return {
    id: c.id,
    seed: c.seed,
    genes: c.savedGenes ? c.savedGenes() : { ...c.genes },
    ...(c.pattern ? { pattern: compactPattern(c.savedPattern ? c.savedPattern() : c.pattern) } : {}),
    traits: { ...(c.traits ?? {}) },
    growth: c.growth ?? 1,
  };
}
