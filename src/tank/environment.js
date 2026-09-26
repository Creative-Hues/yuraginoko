// 水槽の環境(土・光・水流)と底の栄養、環境による遺伝子の変化。
// 調整値は envConfig.js にまとめてある。
import { GENE_DEFS } from '../creature/genes.js';
import { DEPTH_SPAN } from '../creature/body.js';
import { clamp, wrap01 } from '../util/math.js';
import {
  CURRENT_EFFECT,
  DEFAULT_ENV,
  ENV_CHANGE,
  LIGHT_BRIGHTNESS,
  LIGHT_COLORS,
  NUTRIENT,
  PLANTS,
  PLANT_REACH,
  SOILS,
  STAGE_EFFECT,
} from './envConfig.js';
import { plantStage } from './plants.js';

const WRAP = Object.fromEntries(GENE_DEFS.map((d) => [d.key, !!d.wrap]));
const GENE_INDEX = Object.fromEntries(GENE_DEFS.map((d, i) => [d.key, i]));

function num(v, fallback, min = 0, max = 1) {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
}

// 保存されていた環境を読み込む。足りない項目や知らない値は初期値にする(環境のない古いデータは、初期の環境で開く)
export function normalizeEnv(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const d = DEFAULT_ENV;
  return {
    ...s, // 知らない項目も消さずに残す
    soil: SOILS[s.soil] ? s.soil : d.soil,
    light: {
      color: LIGHT_COLORS[s.light?.color] ? s.light.color : d.light.color,
      brightness: num(s.light?.brightness, d.light.brightness),
    },
    current: {
      strength: num(s.current?.strength, d.current.strength),
      dir: s.current?.dir === -1 ? -1 : 1,
    },
  };
}

export function copyEnv(env) {
  return { ...env, light: { ...env.light }, current: { ...env.current } };
}

// ---- 底の栄養 ----
const NW = NUTRIENT.GRID_W;
const NH = NUTRIENT.GRID_H;

export class Nutrients {
  // saved: 保存されていた { w, h, cells }(無い・形が違うときは栄養なしから始める)
  constructor(saved) {
    this.cells = new Float32Array(NW * NH);
    if (saved && saved.w === NW && saved.h === NH && saved.cells?.length === NW * NH) {
      for (let i = 0; i < this.cells.length; i++) {
        const v = saved.cells[i];
        this.cells[i] = typeof v === 'number' && Number.isFinite(v) ? clamp(v) : 0;
      }
    }
  }

  // 水槽の中の位置 (x, z) → マスの番号
  index(x, z) {
    const ix = clamp(Math.floor(x * NW), 0, NW - 1);
    const iz = clamp(Math.floor(z * NH), 0, NH - 1);
    return iz * NW + ix;
  }

  at(x, z) {
    return this.cells[this.index(x, z)];
  }

  add(x, z, amount) {
    const i = this.index(x, z);
    this.cells[i] = clamp(this.cells[i] + amount);
  }

  // 使う。実際に使えた量を返す
  take(x, z, amount) {
    const i = this.index(x, z);
    const used = Math.min(this.cells[i], amount);
    this.cells[i] -= used;
    return used;
  }

  toData() {
    return { w: NW, h: NH, cells: Array.from(this.cells, (v) => Math.round(v * 1000) / 1000) };
  }
}

// ---- 環境による遺伝子の変化 ----
// 1秒ごとに accumulateExposure で「どの効果に、どれだけ当てはまっていたか」を記録し、
// ENV_CHANGE.INTERVAL 秒ごとに exposureDrift でまとめて変える量を求める。

// 生き物の体の真ん中の位置
function middle(creature) {
  const pts = creature.points;
  return pts?.length ? pts[Math.floor(pts.length / 2)] : { x: creature.x, z: creature.z };
}

// 近くにある植物の種類ごとの強さ(同じ種類が何本あっても、いちばん強いものだけ)
export function nearbyPlants(creature, plants) {
  const m = middle(creature);
  const near = {};
  for (const p of plants) {
    const strength = STAGE_EFFECT[plantStage(p.growth)];
    if (!(strength > 0)) continue;
    if (Math.hypot(p.x - m.x, (p.z - m.z) * DEPTH_SPAN) > PLANT_REACH) continue;
    near[p.kind] = Math.max(near[p.kind] ?? 0, strength);
  }
  return near;
}

const MODES = ['up', 'down', 'toward'];

// 今この瞬間に当てはまっている効果を、exposure(Map)に「強さ × 秒数」で足す
export function accumulateExposure(exposure, creature, env, plants, seconds) {
  const add = (effect, strength) => {
    if (!effect || !(strength > 0)) return;
    for (const mode of MODES) {
      for (const [key, target] of Object.entries(effect[mode] ?? {})) {
        const id = `${mode}:${key}:${target}`;
        const e = exposure.get(id) ?? { mode, key, target, amount: 0 };
        e.amount += strength * seconds;
        exposure.set(id, e);
      }
    }
  };
  add(SOILS[env.soil]?.effect, 1);
  const light = LIGHT_COLORS[env.light.color];
  if (light && light.hue != null) add({ toward: { hue: light.hue } }, 1);
  const b = env.light.brightness;
  add(LIGHT_BRIGHTNESS.dark, clamp((0.5 - b) * 2));
  add(LIGHT_BRIGHTNESS.bright, clamp((b - 0.5) * 2));
  add(CURRENT_EFFECT, env.current.strength);
  for (const [kind, strength] of Object.entries(nearbyPlants(creature, plants))) add(PLANTS[kind]?.effect, strength);
}

// 生き物ごとに決まった、目標の値のずれ(-1〜1)
function jitter(seed, key) {
  const s = Math.sin((seed % 100003) * 0.0007 + (GENE_INDEX[key] ?? 0) * 7.77 + 1.3) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// この生き物にとっての目標の値
export function targetFor(creature, key, target) {
  const v = target + jitter(creature.seed ?? 0, key) * ENV_CHANGE.TARGET_JITTER;
  return WRAP[key] ? wrap01(v) : clamp(v);
}

// 記録した当てはまり具合から、まとめて変える量({ 遺伝子: 変化量 })を求める。genes にはまだ反映しない。
// どの効果も、この生き物の目標の値を通り過ぎない
export function exposureDrift(creature, exposure) {
  const { INTERVAL, STEP } = ENV_CHANGE;
  const work = { ...creature.genes };
  const drift = {};
  for (const e of exposure.values()) {
    if (typeof work[e.key] !== 'number' || !(e.amount > 0)) continue;
    const k = (STEP * e.amount) / INTERVAL;
    let d = targetFor(creature, e.key, e.target) - work[e.key];
    if (WRAP[e.key]) d -= Math.round(d); // 近いほうの回り方(-0.5〜0.5)
    if ((e.mode === 'up' && d <= 0) || (e.mode === 'down' && d >= 0)) continue;
    const delta = Math.sign(d) * Math.min(Math.abs(d), k);
    if (delta === 0) continue;
    const v = work[e.key] + delta;
    work[e.key] = WRAP[e.key] ? wrap01(v) : clamp(v);
    drift[e.key] = (drift[e.key] ?? 0) + delta;
  }
  return drift;
}
