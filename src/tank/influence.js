// 「何から影響を受けているか」の文章づくり(描画はしない)。
// 文章は envConfig.js の effect の定義と EFFECT_WORDS、genes.js の FOODS から作るので、
// 植物や土を増やしたときは、一覧や一言にも自動で並ぶ。
import { FOODS, FOOD_KEYS, patternMix } from '../creature/genes.js';
import {
  CURRENT_EFFECT,
  CURRENT_NAMES,
  EFFECT_WORDS,
  INFLUENCE_MIN,
  LIGHT_BRIGHTNESS,
  LIGHT_COLORS,
  LIGHT_COLOR_KEYS,
  NO_EFFECT_TEXT,
  PATTERN_NAMES,
  PLANTS,
  PLANT_KEYS,
  SOILS,
  SOIL_KEYS,
} from './envConfig.js';
import { EFFECT_MODES, activeSources, lightEffect } from './environment.js';

const FROM_FOOD_NOTE = 'エサのあとに生えることがある';

// 効果 → 「突起が増える」「透けやすくなる、光り方が強くなる」など。中身がなければ「変化なし」
export function effectText(effect) {
  const words = [];
  for (const mode of EFFECT_MODES) {
    for (const [key, target] of Object.entries(effect?.[mode] ?? {})) {
      let w = EFFECT_WORDS[key]?.[mode];
      if (!w) continue;
      if (w.includes('{pattern}')) w = w.replace('{pattern}', PATTERN_NAMES[patternMix(target).main] ?? '');
      if (!words.includes(w)) words.push(w);
    }
  }
  return words.length ? words.join('、') : NO_EFFECT_TEXT;
}

// エサの効き方を、環境と同じ形の効果にする(genes.js の foodDrift と同じ向き)
export function foodEffect(food) {
  const effect = {};
  if (typeof food?.hueToward === 'number') effect.toward = { hue: food.hueToward };
  if (food?.glow) effect.up = { glow: 1 };
  return effect;
}

// 同じ文章になるものを1行にまとめる:[{ label: '赤い花草・青い花草', text, note }]
function group(items) {
  const rows = [];
  for (const { label, text, note = '' } of items) {
    const row = rows.find((r) => r.text === text && r.note === note);
    if (row) row.labels.push(label);
    else rows.push({ labels: [label], text, note });
  }
  return rows.map((r) => ({ label: r.labels.join('・'), text: r.text, note: r.note }));
}

// 環境編集モードの「影響の一覧」:[{ title, rows: [{ label, text, note }] }]
export function influenceList() {
  return [
    { title: 'エサ', rows: group(FOOD_KEYS.map((k) => ({ label: FOODS[k].label, text: effectText(foodEffect(FOODS[k])) }))) },
    {
      title: '光の色',
      rows: group(LIGHT_COLOR_KEYS.map((k) => ({ label: LIGHT_COLORS[k].label, text: effectText(lightEffect(LIGHT_COLORS[k])) }))),
    },
    { title: '明るさ', rows: group(Object.values(LIGHT_BRIGHTNESS).map((b) => ({ label: b.label, text: effectText(b.effect) }))) },
    { title: '土', rows: group(SOIL_KEYS.map((k) => ({ label: SOILS[k].label, text: effectText(SOILS[k].effect) }))) },
    {
      title: '植物',
      rows: group(
        PLANT_KEYS.map((k) => ({ label: PLANTS[k].label, text: effectText(PLANTS[k].effect), note: PLANTS[k].fromFood ? FROM_FOOD_NOTE : '' })),
      ),
    },
    { title: '水流', rows: [{ label: CURRENT_NAMES.label, text: effectText(CURRENT_EFFECT), note: '' }] },
  ];
}

// ---- 環境編集モードの、タブごとの一言 ----
export function plantHint(kind) {
  const p = PLANTS[kind];
  return p ? `${p.label}:${effectText(p.effect)}` : '';
}

export function soilHint(soil) {
  const s = SOILS[soil];
  return s ? `${s.label}:${effectText(s.effect)}` : '';
}

export function lightHint(env) {
  const light = LIGHT_COLORS[env.light.color];
  const parts = [`${light?.label ?? ''}:${effectText(lightEffect(light))}`];
  const b = env.light.brightness;
  const side = b < 0.5 - INFLUENCE_MIN / 2 ? LIGHT_BRIGHTNESS.dark : b > 0.5 + INFLUENCE_MIN / 2 ? LIGHT_BRIGHTNESS.bright : null;
  if (side) parts.push(`${side.label}:${effectText(side.effect)}`);
  return parts.join(' / ');
}

export function currentHint(env) {
  const on = env.current.strength > INFLUENCE_MIN;
  return `水流:${on ? effectText(CURRENT_EFFECT) : NO_EFFECT_TEXT}`;
}

// ---- 観察中の「いま受けている影響」 ----
// 名前の一覧(例:['赤い光', '光る砂', 'トゲ草'])。明るさ・水流は、ある程度効いているときだけ
export function nowInfluences(creature, env, plants) {
  const names = [];
  for (const s of activeSources(creature, env, plants)) {
    if ((s.kind === 'brightness' || s.kind === 'current') && s.strength <= INFLUENCE_MIN) continue;
    if (s.name && !names.includes(s.name)) names.push(s.name);
  }
  return names;
}
