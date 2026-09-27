// 観察モードのボタン:もどる、この子のこと(標本・別の水槽へ)、この瞬間を残す(図鑑へ)、エサ(4種)、消化させる、排泄させる。
// 今の食事の段階に合うボタンだけを出す。1周したあとは、エサのボタンが薄くなってゆっくり戻る。
// 上の真ん中には、控えめな一言の欄(生き物:いま受けている影響・繁殖の準備・受けやすさ / 卵:「たまご」とようす)。
import { el } from './dom.js';
import { FOODS, FOOD_KEYS } from '../creature/genes.js';
import { MEAL } from '../creature/creature.js';
import { lerp } from '../util/math.js';

const REST_OPACITY = 0.25; // 休み始めのボタンの濃さ

export function createObserveUi(root, { onBack, onFood, onDigest, onExcrete, onCare, onKeep }) {
  const foodButtons = FOOD_KEYS.map((key) =>
    el('button', { class: 'meal-btn', type: 'button', onclick: () => onFood(key) }, [
      el('span', { class: 'food-dot', style: { background: FOODS[key].color } }),
      el('span', { text: FOODS[key].label }),
    ]),
  );
  const foods = el('div', { class: 'meal-group' }, foodButtons);
  const digest = el('button', { class: 'meal-btn', type: 'button', text: '消化させる', onclick: () => onDigest() });
  const excrete = el('button', { class: 'meal-btn', type: 'button', text: '排泄させる', onclick: () => onExcrete() });
  const bar = el('div', { class: 'meal-bar' }, [foods, digest, excrete]);
  const back = el('button', { class: 'pill', type: 'button', text: 'もどる', onclick: () => onBack() });
  const care = el('button', { class: 'pill right', type: 'button', text: 'この子のこと', onclick: () => onCare() });
  const keep = el('button', { class: 'pill right second', type: 'button', text: 'この瞬間を残す', onclick: () => onKeep() });
  const info = el('div', { class: 'observe-info', 'aria-live': 'polite' });
  root.replaceChildren(back, care, keep, info, bar);

  let shown = '';
  let opacity = -1;
  let infoKey = '';

  // 一言の欄を書き換える(変わったときだけ)。lines: [{ text, cls }]
  const setInfo = (lines) => {
    const key = JSON.stringify(lines);
    if (key === infoKey) return;
    infoKey = key;
    info.replaceChildren(...lines.map((l) => el('p', { class: l.cls ?? '', text: l.text })));
    info.hidden = !lines.length;
  };

  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    // 生き物の今の段階に合わせて、ボタンを出し分ける(変わったときだけ書き換える)。
    // note: { now: いま受けている影響の名前, ready: 繁殖の準備ができている, sensitivity: 受けやすさの行 }
    update(creature, note = {}, now = Date.now()) {
      const stage = creature.meal.stage;
      const resting = stage === MEAL.resting;
      const key = resting ? 'resting' : stage;
      if (key !== shown) {
        shown = key;
        care.hidden = false;
        keep.hidden = false;
        bar.hidden = false;
        const showFoods = stage === MEAL.ready || resting;
        foods.hidden = !showFoods;
        digest.hidden = stage !== MEAL.fed;
        excrete.hidden = stage !== MEAL.digested;
        for (const b of foodButtons) b.disabled = resting;
      }
      const next = resting ? Math.round(lerp(REST_OPACITY, 1, creature.restProgress(now)) * 100) / 100 : 1;
      if (next !== opacity) {
        opacity = next;
        foods.style.opacity = String(next);
      }
      const lines = [];
      if (note.now?.length) lines.push({ text: `いま:${note.now.join('・')}` });
      if (note.ready) lines.push({ text: '繁殖の準備ができている', cls: 'ready' });
      if (note.sensitivity?.length) lines.push({ text: note.sensitivity.join(' / '), cls: 'sub' });
      setInfo(lines);
    },
    // 卵を見ているとき:「たまご」と、ようすの一言だけ
    updateEgg(mood) {
      if (shown !== 'egg') {
        shown = 'egg';
        care.hidden = true;
        keep.hidden = true;
        bar.hidden = true;
      }
      setInfo([
        { text: 'たまご', cls: 'title' },
        { text: mood, cls: '' },
      ]);
    },
  };
}
