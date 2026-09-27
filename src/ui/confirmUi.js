// 消す前の確認(やわらかい言い方で。ボタンは「やめる」と、okText)。
import { el } from './dom.js';

// lead: 上に出すもの(姿など)、lines: 説明の文
export function renderConfirm(root, { title, lead = null, lines = [], okText = '消す', cancelText = 'やめる', onOk, onCancel }) {
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { class: 'soft', text: title }),
      lead,
      ...lines.map((text) => el('p', { text })),
      el('div', { class: 'row spread' }, [
        el('button', { class: 'btn sub', type: 'button', text: cancelText, onclick: () => onCancel() }),
        el('button', { class: 'btn', type: 'button', text: okText, onclick: () => onOk() }),
      ]),
    ]),
  );
}
