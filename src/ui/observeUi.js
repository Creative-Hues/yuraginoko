// 観察モードのボタン:もどる、エサ(4種)、消化させる、排泄させる。
// 今の食事の段階に合うボタンだけを出す。1周したあとは、エサのボタンが薄くなってゆっくり戻る。
import { el } from './dom.js';
import { FOODS, FOOD_KEYS } from '../creature/genes.js';
import { MEAL } from '../creature/creature.js';
import { lerp } from '../util/math.js';

const REST_OPACITY = 0.25; // 休み始めのボタンの濃さ

export function createObserveUi(root, { onBack, onFood, onDigest, onExcrete }) {
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
  root.replaceChildren(back, bar);

  let shown = '';
  let opacity = -1;

  return {
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    // 生き物の今の段階に合わせて、ボタンを出し分ける(変わったときだけ書き換える)
    update(creature, now = Date.now()) {
      const stage = creature.meal.stage;
      const resting = stage === MEAL.resting;
      const key = resting ? 'resting' : stage;
      if (key !== shown) {
        shown = key;
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
    },
  };
}
