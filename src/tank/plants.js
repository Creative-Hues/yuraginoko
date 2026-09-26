// 水槽の植物。植える・動かす・抜く・育てる。
// 位置は水槽の中の座標(x: 左右 0〜1、z: 0 = 手前〜1 = 奥)、
// growth は育ち具合(0 = 芽が出たところ、1 = 大きい、2 = とても大きい。フェーズ3の最初の保存データは 0〜1)。
// 植物は水槽を開いている間だけ育つ。調整値は envConfig.js にまとめてある。
import { clamp } from '../util/math.js';
import { makeId, randomSeed } from '../util/random.js';
import { PLANTS, PLANT_GROWTH, PLANT_LIMIT, PLANT_MAX_GROWTH } from './envConfig.js';

// 植えられる範囲(水槽の端に埋もれないように)
export const PLANT_X = [0.04, 0.96];
export const PLANT_Z = [0.02, 0.98];

// 育ち具合 → 段階(芽・小さい・大きい・とても大きい)
export function plantStage(growth) {
  if (growth >= PLANT_MAX_GROWTH) return 'huge';
  if (growth >= 1) return 'large';
  if (growth >= PLANT_GROWTH.SMALL_AT) return 'small';
  return 'sprout';
}

function place(x, z) {
  return { x: clamp(x, PLANT_X[0], PLANT_X[1]), z: clamp(z, PLANT_Z[0], PLANT_Z[1]) };
}

function loadPlant(p) {
  if (!p || !PLANTS[p.kind] || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  return {
    id: typeof p.id === 'string' ? p.id : makeId(),
    kind: p.kind,
    ...place(p.x, p.z),
    growth: clamp(Number(p.growth) || 0, 0, PLANT_MAX_GROWTH),
    seed: Number.isFinite(p.seed) ? p.seed : randomSeed(),
  };
}

export class Plants {
  // saved: 保存されていた植物の配列(読めないものは飛ばす)
  constructor(saved) {
    this.list = (Array.isArray(saved) ? saved : []).map(loadPlant).filter(Boolean).slice(0, PLANT_LIMIT);
  }

  get count() {
    return this.list.length;
  }

  get full() {
    return this.list.length >= PLANT_LIMIT;
  }

  // 植える(芽から)。上限のときは null
  add(kind, x, z, growth = 0) {
    if (this.full || !PLANTS[kind]) return null;
    const plant = { id: makeId(), kind, ...place(x, z), growth: clamp(growth, 0, PLANT_MAX_GROWTH), seed: randomSeed() };
    this.list.push(plant);
    return plant;
  }

  move(plant, x, z) {
    Object.assign(plant, place(x, z));
  }

  remove(plant) {
    const i = this.list.indexOf(plant);
    if (i < 0) return false;
    this.list.splice(i, 1);
    return true;
  }

  // seconds 秒ぶん育てる。その場所の栄養があるほど早く育ち、育つぶん栄養を使う。育ったら true。
  // 芽 → 大きい(0 → 1)は SECONDS、大きい → とても大きい(1 → 2)は HUGE_SECONDS かけて育つ
  grow(seconds, nutrients) {
    const { SECONDS, HUGE_SECONDS, NUTRIENT_BOOST, NUTRIENT_USE } = PLANT_GROWTH;
    let changed = false;
    for (const p of this.list) {
      if (p.growth >= PLANT_MAX_GROWTH) continue;
      const n = nutrients ? nutrients.at(p.x, p.z) : 0;
      const until = p.growth < 1 ? 1 : PLANT_MAX_GROWTH; // 段の境目で一度止める
      const inc = Math.min(until - p.growth, (seconds / (p.growth < 1 ? SECONDS : HUGE_SECONDS)) * (1 + NUTRIENT_BOOST * n));
      p.growth = until - (p.growth + inc) < 1e-9 ? until : p.growth + inc; // 小数の誤差で境目に届かないことがないように
      nutrients?.take(p.x, p.z, inc * NUTRIENT_USE);
      changed = true;
    }
    return changed;
  }

  toData() {
    return this.list.map((p) => ({ ...p, growth: Math.round(p.growth * 10000) / 10000 }));
  }
}
