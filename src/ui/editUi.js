// 環境編集モードの帯(画面の上):タブ「植物/土/光/水流」と、それぞれの中身。
// 底の砂をタップしやすいように、帯は水面の側に置く。
import { el } from './dom.js';
import { LIGHT_COLORS, LIGHT_COLOR_KEYS, PLANTS, PLANTABLE_KEYS, PLANT_LIMIT, SOILS, SOIL_KEYS } from '../tank/envConfig.js';

const TABS = [
  ['plants', '植物'],
  ['soil', '土'],
  ['light', '光'],
  ['current', '水流'],
];

function chip(text, swatch, onclick) {
  return el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick }, [
    swatch ? el('span', { class: 'food-dot', style: { background: swatch } }) : null,
    el('span', { text }),
  ]);
}

function slider(low, high, oninput) {
  const input = el('input', { type: 'range', min: '0', max: '100', step: '1', class: 'edit-range' });
  input.addEventListener('input', () => oninput(Number(input.value) / 100));
  return { input, node: el('label', { class: 'edit-slider' }, [el('span', { text: low }), input, el('span', { text: high })]) };
}

function press(button, on) {
  const v = String(!!on);
  if (button.getAttribute('aria-pressed') !== v) button.setAttribute('aria-pressed', v);
}

export function createEditUi(root, { onKind, onRemove, onSoil, onLightColor, onBrightness, onStrength, onDir }) {
  // 植物
  const kindButtons = Object.fromEntries(PLANTABLE_KEYS.map((k) => [k, chip(PLANTS[k].label, PLANTS[k].colors[0], () => onKind(k))]));
  const count = el('span', { class: 'edit-note' });
  const removeBtn = el('button', { class: 'chip remove', type: 'button', onclick: () => onRemove() });
  const plants = el('div', { class: 'edit-panel' }, [...Object.values(kindButtons), count, removeBtn]);

  // 土
  const soilButtons = Object.fromEntries(SOIL_KEYS.map((k) => [k, chip(SOILS[k].label, SOILS[k].floor[0], () => onSoil(k))]));
  const soil = el('div', { class: 'edit-panel' }, Object.values(soilButtons));

  // 光
  const colorButtons = Object.fromEntries(
    LIGHT_COLOR_KEYS.map((k) => [
      k,
      el('button', {
        class: 'color-dot',
        type: 'button',
        'aria-label': LIGHT_COLORS[k].label,
        'aria-pressed': 'false',
        style: { background: LIGHT_COLORS[k].swatch },
        onclick: () => onLightColor(k),
      }),
    ]),
  );
  const brightness = slider('暗い', '明るい', onBrightness);
  const light = el('div', { class: 'edit-panel' }, [...Object.values(colorButtons), brightness.node]);

  // 水流
  const left = chip('← 左へ', null, () => onDir(-1));
  const right = chip('右へ →', null, () => onDir(1));
  const strength = slider('おだやか', '強い', onStrength);
  const current = el('div', { class: 'edit-panel' }, [left, right, strength.node]);

  const panels = { plants, soil, light, current };
  const tabButtons = {};
  let tab = 'plants';
  const selectTab = (key) => {
    tab = key;
    for (const [k, b] of Object.entries(tabButtons)) press(b, k === key);
    for (const [k, p] of Object.entries(panels)) p.hidden = k !== key;
  };
  for (const [key, label] of TABS) {
    tabButtons[key] = el('button', { class: 'edit-tab', type: 'button', text: label, onclick: () => selectTab(key) });
  }
  const bar = el('div', { class: 'edit-bar' }, [el('div', { class: 'edit-tabs' }, Object.values(tabButtons)), ...Object.values(panels)]);
  root.replaceChildren(bar);
  selectTab(tab);

  let last = '';
  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    // 今の環境と選んでいるものに合わせる(変わったときだけ書き換える)
    update({ env, plantCount, kind, selected }) {
      const full = plantCount >= PLANT_LIMIT;
      const key = JSON.stringify([env, plantCount, kind, selected?.id ?? null, selected?.kind ?? null]);
      if (key === last) return;
      last = key;

      for (const [k, b] of Object.entries(kindButtons)) {
        press(b, k === kind && !full);
        b.disabled = full;
      }
      count.textContent = full ? `${PLANT_LIMIT}本まで植えられます` : kind ? `砂の上をタップ(${plantCount} / ${PLANT_LIMIT})` : `${plantCount} / ${PLANT_LIMIT}`;
      removeBtn.hidden = !selected;
      if (selected) removeBtn.textContent = `${PLANTS[selected.kind]?.label ?? ''}を抜く`;

      for (const [k, b] of Object.entries(soilButtons)) press(b, k === env.soil);
      for (const [k, b] of Object.entries(colorButtons)) press(b, k === env.light.color);
      // 動かしている最中のスライダーは書き換えない
      if (document.activeElement !== brightness.input) brightness.input.value = String(Math.round(env.light.brightness * 100));
      if (document.activeElement !== strength.input) strength.input.value = String(Math.round(env.current.strength * 100));
      press(left, env.current.dir === -1);
      press(right, env.current.dir === 1);
    },
  };
}
