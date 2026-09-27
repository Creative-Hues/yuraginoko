// 「今は誰?」画面。登録済みの人から選ぶか、新しく名前を入れる(名前の背景色も選べる)。
// すみに、控えめな「データの書き出し・読み込み」(まだ誰もいないときにも使える)。
import { colorOf, colorPicker, el, personaColor } from './dom.js';

export function renderWhoScreen(root, { personas, onPick, onCreate, onBack, onBackup }) {
  const input = el('input', {
    type: 'text',
    maxlength: '20',
    placeholder: 'なまえ',
    autocomplete: 'off',
    enterkeyhint: 'go',
    'aria-label': 'なまえ',
  });
  const go = el('button', { class: 'btn', type: 'submit', text: 'ひらく', disabled: true });
  // 新しい人の色(はじめは、今までどおり登録順の色)
  let color = personaColor(personas.length);
  const syncGo = () => {
    go.disabled = input.value.trim() === '';
    go.style.background = color;
  };
  input.addEventListener('input', syncGo);
  const form = el('form', { class: 'name-form' }, [input, go]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (name) onCreate(name, color);
  });
  const picker = colorPicker(color, (c) => {
    color = c;
    syncGo();
  });

  const choices =
    personas.length > 0 &&
    el(
      'div',
      { class: 'choices' },
      personas.map((p, i) =>
        el('button', {
          class: 'btn',
          type: 'button',
          text: p.name,
          style: { background: colorOf(p, i) },
          onclick: () => onPick(p),
        }),
      ),
    );

  const panel = el('div', { class: 'panel' }, [
    el('h1', { text: '今は誰?' }),
    choices,
    el('p', {
      text: personas.length ? 'ほかの名前で開くこともできます。' : '名前を入れると、その人の水槽ができます。',
    }),
    form,
    el('p', { class: 'color-label', text: '名前の色' }),
    picker,
    onBack && el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack })]),
    onBackup &&
      el('div', { class: 'backup-foot' }, [
        el('button', { class: 'quiet-btn', type: 'button', text: 'データの書き出し・読み込み', onclick: onBackup }),
      ]),
  ]);
  root.replaceChildren(panel);
  syncGo();
}
