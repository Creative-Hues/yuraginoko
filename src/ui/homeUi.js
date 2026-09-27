// 「すみかを決める」画面:水槽の子から1匹を選んで、標本にするか、別の水槽へ移す。
// 5匹になったときに出る。4匹以下のときも、観察モードの「この子のこと」から開ける。
import { el } from './dom.js';
import { portrait, portraitColor } from '../creature/portrait.js';

function picture(data, w, h) {
  const url = portrait(data, w, h);
  return url
    ? el('img', { class: 'pic', src: url, alt: '', width: String(w), height: String(h) })
    : el('span', { class: 'pic-dot', style: { background: portraitColor(data) } });
}

/**
 * creatures: [{ id, data(保存データ), newborn }]
 * targets:   移せる水槽 [{ id, label }](同じ人の、空きがある水槽)
 * crowded:   5匹いる(「あとで決める」を出す)
 */
export function renderHomeChoice(root, { creatures, selectedId, targets, crowded, onSpecimen, onNewTank, onMove, onLater }) {
  let selected = creatures.some((c) => c.id === selectedId) ? selectedId : crowded ? null : creatures[0]?.id ?? null;

  const cards = creatures.map((c) =>
    el(
      'button',
      {
        class: 'pick-card',
        type: 'button',
        'aria-pressed': 'false',
        onclick: () => {
          selected = c.id;
          sync();
        },
      },
      [picture(c.data, 150, 100), c.newborn ? el('span', { class: 'badge', text: '生まれたばかり' }) : null],
    ),
  );

  // それぞれの選び方に、短い説明を添える(違いがわかるように)
  const action = (label, desc, onclick) =>
    el('button', { class: 'btn action-btn', type: 'button', onclick }, [
      el('span', { class: 'action-label', text: label }),
      el('span', { class: 'action-desc', text: desc }),
    ]);
  const actions = el('div', { class: 'home-actions' }, [
    action('標本にする', '水槽から離れて、結晶の中で今の姿のまま残ります', () => selected && onSpecimen(selected)),
    action('新しい水槽へ', '新しい水槽で、このまま暮らし続けます', () => selected && onNewTank(selected)),
    ...targets.map((t) => action(`${t.label}へ`, 'その水槽で、このまま暮らし続けます', () => selected && onMove(selected, t.id))),
  ]);
  const note = el('p', { class: 'home-note' });

  function sync() {
    creatures.forEach((c, i) => cards[i].setAttribute('aria-pressed', String(c.id === selected)));
    for (const b of actions.children) b.disabled = !selected;
    note.textContent = selected ? 'この子をどうするか、えらんでください。' : 'まず1匹えらんでください。';
  }

  const panel = el('div', { class: 'panel wide' }, [
    el('h1', { text: crowded ? 'すみかを決める' : 'この子のこと' }),
    el('p', {
      text: crowded
        ? `1つの水槽で暮らせるのは4匹までです。どの子がどこで暮らすか、決めましょう。`
        : '標本にしたり、別の水槽へ移したりできます。',
    }),
    el('div', { class: 'pick-grid' }, cards),
    note,
    actions,
    el('p', { class: 'home-hint', text: '今の姿を残すだけなら、観察の「図鑑に残す」でできます。' }),
    el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: crowded ? 'あとで決める' : 'やめる', onclick: () => onLater() })]),
  ]);
  root.replaceChildren(panel);
  sync();
}
