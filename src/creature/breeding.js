// 交配で生まれる赤ちゃんの遺伝子と特徴(描画はしない)。調整値は lifeConfig.js。
import { GENE_DEFS, mixGenes } from './genes.js';
import { MUTATION, QUIRKS, QUIRK_KEYS } from './lifeConfig.js';
import { clamp, lerp, wrap01 } from '../util/math.js';

const WRAP = Object.fromEntries(GENE_DEFS.map((d) => [d.key, !!d.wrap]));

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const within = ([a, b], rng) => lerp(a, b, rng());

// 新しい特徴を1つ作る。位置と形はこの時に決まり、あとは変わらない
export function makeQuirk(rng, type = pick(QUIRK_KEYS, rng)) {
  const def = QUIRKS[type];
  const q = { type, u: within(def.u, rng), size: within(def.size, rng), seed: Math.floor(rng() * 1e9) };
  if (def.forms) q.form = pick(def.forms, rng);
  return q;
}

// 保存されていた特徴を読み込む。知らない種類や壊れているものは外す
export function normalizeQuirks(saved) {
  if (!Array.isArray(saved)) return [];
  const out = [];
  for (const q of saved) {
    const def = QUIRKS[q?.type];
    if (!def) continue;
    const n = (v, [a, b]) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : (a + b) / 2);
    const quirk = { ...q, u: n(q.u, [0, 1]), size: n(q.size, def.size), seed: Number(q.seed) >>> 0 };
    if (def.forms && !def.forms.includes(quirk.form)) quirk.form = def.forms[0];
    out.push(quirk);
  }
  return out.slice(0, MUTATION.MAX_QUIRKS);
}

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
 * 両親 a, b({ genes, quirks })から、赤ちゃんの遺伝子・特徴・変異の記録を作る。
 * - 遺伝子は両親の値を混ぜる(ふだんの小さなゆらぎつき)
 * - 親の特徴は、1つずつ MUTATION.INHERIT の確率で受け継ぐ
 * - そのうえで必ず MUTATION.COUNT の範囲の項目数だけ、大きくずらす(遺伝子の大ずれ、または新しい特徴)
 */
export function makeChild(a, b, rng) {
  const genes = mixGenes(a.genes, b.genes, rng, MUTATION.MIX_JITTER);
  const quirks = [];
  for (const q of [...(a.quirks ?? []), ...(b.quirks ?? [])]) {
    if (quirks.length < MUTATION.MAX_QUIRKS && rng() < MUTATION.INHERIT) quirks.push({ ...q });
  }

  const [lo, hi] = MUTATION.COUNT;
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const mutations = [];
  const shifted = new Set();
  for (let i = 0; i < count; i++) {
    const keys = MUTATION.SHIFT_KEYS.filter((k) => !shifted.has(k));
    const wantQuirk = rng() < MUTATION.QUIRK_CHANCE;
    if ((wantQuirk && quirks.length < MUTATION.MAX_QUIRKS) || !keys.length) {
      // 特徴がいっぱいのときは、いちばん古い特徴と入れかえる
      const q = makeQuirk(rng);
      if (quirks.length >= MUTATION.MAX_QUIRKS) quirks.shift();
      quirks.push(q);
      mutations.push({ kind: 'quirk', type: q.type });
      continue;
    }
    const key = pick(keys, rng);
    const delta = bigShift(genes, key, rng);
    genes[key] = WRAP[key] ? wrap01(genes[key] + delta) : clamp(genes[key] + delta);
    shifted.add(key);
    mutations.push({ kind: 'gene', key, delta });
  }
  return { genes, quirks, mutations };
}

// 親の写し(標本画面で親の姿を出すため)。祖父母までは持たない
export function parentSnapshot(c) {
  return {
    id: c.id,
    seed: c.seed,
    genes: c.savedGenes ? c.savedGenes() : { ...c.genes },
    quirks: (c.quirks ?? []).map((q) => ({ ...q })),
    growth: c.growth ?? 1,
  };
}
