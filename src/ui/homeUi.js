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

  const actions = el('div', { class: 'home-actions' }, [
    el('button', { class: 'btn', type: 'button', text: '標本にする', onclick: () => selected && onSpecimen(selected) }),
    el('button', { class: 'btn', type: 'button', text: '新しい水槽へ', onclick: () => selected && onNewTank(selected) }),
    ...targets.map((t) => el('button', { class: 'btn', type: 'button', text: `${t.label}へ`, onclick: () => selected && onMove(selected, t.id) })),
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
    el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: crowded ? 'あとで決める' : 'やめる', onclick: () => onLater() })]),
  ]);
  root.replaceChildren(panel);
  sync();
}
