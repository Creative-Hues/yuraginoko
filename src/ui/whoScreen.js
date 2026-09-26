// 「今は誰?」画面。登録済みの人から選ぶか、新しく名前を入れる。
import { el, personaColor } from './dom.js';

export function renderWhoScreen(root, { personas, onPick, onCreate, onBack }) {
  const input = el('input', {
    type: 'text',
    maxlength: '20',
    placeholder: 'なまえ',
    autocomplete: 'off',
    enterkeyhint: 'go',
    'aria-label': 'なまえ',
  });
  const go = el('button', { class: 'btn', type: 'submit', text: 'ひらく', disabled: true });
  input.addEventListener('input', () => {
    go.disabled = input.value.trim() === '';
  });
  const form = el('form', { class: 'name-form' }, [input, go]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (name) onCreate(name);
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
          style: { background: personaColor(i) },
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
    onBack && el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack })]),
  ]);
  root.replaceChildren(panel);
}
