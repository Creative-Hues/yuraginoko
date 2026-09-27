// 生き物ごとの「環境の受けやすさ」(光の色・明るさ・土・植物・水流それぞれ 受けやすい/ふつう/受けにくい)。
// 同じ水槽でも、みんなが同じ姿にそろっていかないようにする。描画はしない。調整値は envConfig.js の SENSITIVITY。
import { SENSITIVITY, SENSITIVITY_KEYS } from '../tank/envConfig.js';
import { makeRng } from '../util/random.js';

const LEVEL_KEYS = Object.keys(SENSITIVITY.LEVELS);
const LIMITS = { high: SENSITIVITY.HIGH_COUNT, low: SENSITIVITY.LOW_COUNT };

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const within = ([a, b], rng) => a + Math.floor(rng() * (b - a + 1));
const keysAt = (s, level) => SENSITIVITY_KEYS.filter((k) => s[k] === level);

// 受けやすい・受けにくいの数が決まりに合っているか
function fits(s) {
  return Object.entries(LIMITS).every(([level, [lo, hi]]) => {
    const n = keysAt(s, level).length;
    return n >= lo && n <= hi;
  });
}

// 決まりの数からはみ出したところだけを直す
function fitCounts(s, rng) {
  for (const [level, [lo, hi]] of Object.entries(LIMITS)) {
    const other = level === 'high' ? 'low' : 'high';
    while (keysAt(s, level).length > hi) s[pick(keysAt(s, level), rng)] = 'normal';
    while (keysAt(s, level).length < lo) {
      const normals = keysAt(s, 'normal');
      s[pick(normals.length ? normals : keysAt(s, other), rng)] = level;
    }
  }
  return s;
}

// 受けやすいものが HIGH_COUNT 個、受けにくいものが LOW_COUNT 個、残りはふつう
export function randomSensitivity(rng) {
  const keys = [...SENSITIVITY_KEYS];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const high = within(SENSITIVITY.HIGH_COUNT, rng);
  const low = within(SENSITIVITY.LOW_COUNT, rng);
  const s = {};
  keys.forEach((k, i) => (s[k] = i < high ? 'high' : i < high + low ? 'low' : 'normal'));
  return fitCounts(s, rng);
}

// seed から決まる受けやすさ(受けやすさを持たない古いデータ用。毎回同じ結果になる)
export function sensitivityFromSeed(seed) {
  return randomSensitivity(makeRng(((Number(seed) || 0) ^ 0x5e1b7) >>> 0));
}

// 保存されていた受けやすさを読み込む。無い・壊れている・数が合わないときは seed から決める
export function normalizeSensitivity(saved, seed) {
  if (saved && typeof saved === 'object') {
    const s = {};
    for (const k of SENSITIVITY_KEYS) s[k] = LEVEL_KEYS.includes(saved[k]) ? saved[k] : null;
    if (SENSITIVITY_KEYS.every((k) => s[k]) && fits(s)) return s;
  }
  return sensitivityFromSeed(seed);
}

// 赤ちゃん:項目ごとに両親のどちらかを受け継ぎ、INHERIT_CHANGE の確率で別の段階に変わる
export function inheritSensitivity(a, b, rng) {
  const s = {};
  for (const k of SENSITIVITY_KEYS) {
    const from = (rng() < 0.5 ? a : b)?.[k];
    let level = LEVEL_KEYS.includes(from) ? from : 'normal';
    if (rng() < SENSITIVITY.INHERIT_CHANGE) level = pick(LEVEL_KEYS.filter((l) => l !== level), rng);
    s[k] = level;
  }
  return fitCounts(s, rng);
}

// その項目の倍率
export function sensitivityScale(s, kind) {
  return SENSITIVITY.LEVELS[s?.[kind]]?.scale ?? 1;
}

// 表示用:「受けやすい:光の色・土」「受けにくい:水流」(ふつうは出さない)
export function sensitivityLines(s) {
  return ['high', 'low']
    .map((level) => {
      const names = keysAt(s ?? {}, level).map((k) => SENSITIVITY.KINDS[k]);
      return names.length ? `${SENSITIVITY.LEVELS[level].label}:${names.join('・')}` : null;
    })
    .filter(Boolean);
}
