// 水槽の一覧。別の人の水槽へ移動する。
import { el, personaColor } from './dom.js';

export function renderTankList(root, { personas, currentId, onPick, onAdd, onClose }) {
  const panel = el('div', { class: 'panel' }, [
    el('h1', { text: '水槽' }),
    el(
      'div',
      { class: 'choices' },
      personas.map((p, i) =>
        el('button', {
          class: p.id === currentId ? 'btn current' : 'btn',
          type: 'button',
          text: p.name,
          style: { background: personaColor(i) },
          onclick: () => onPick(p),
        }),
      ),
    ),
    el('div', { class: 'row spread' }, [
      el('button', { class: 'btn sub', type: 'button', text: 'ほかの人', onclick: onAdd }),
      el('button', { class: 'btn sub', type: 'button', text: 'とじる', onclick: onClose }),
    ]),
  ]);
  root.replaceChildren(panel);
}
