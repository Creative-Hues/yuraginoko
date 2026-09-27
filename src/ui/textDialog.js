// 名前や説明文を入れる小さな画面(水槽の名前・標本の名前と説明文)。どの欄も空欄でよい。
import { el } from './dom.js';

// fields: [{ key, label, value, multiline, maxlength, placeholder }]
// lead: 入力欄の上に出すもの(生き物の姿など)、extra: 入力欄の下に出すもの(設定など)、after: 画面のいちばん下に出すもの
export function renderTextDialog(root, { title, lead, extra, after, fields, okText = 'きめる', cancelText = 'もどる', onOk, onCancel }) {
  const inputs = {};
  const rows = fields.map((f) => {
    const input = el(f.multiline ? 'textarea' : 'input', {
      class: 'text-input',
      maxlength: String(f.maxlength ?? (f.multiline ? 200 : 20)),
      placeholder: f.placeholder ?? '',
      autocomplete: 'off',
      rows: f.multiline ? '3' : null,
      type: f.multiline ? null : 'text',
      'aria-label': f.label,
    });
    input.value = f.value ?? '';
    inputs[f.key] = input;
    return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: f.label }), input]);
  });
  const form = el('form', { class: 'text-form' }, [
    ...rows,
    extra,
    el('div', { class: 'row spread' }, [
      el('button', { class: 'btn sub', type: 'button', text: cancelText, onclick: () => onCancel() }),
      el('button', { class: 'btn', type: 'submit', text: okText }),
    ]),
  ]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onOk(Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value.trim()])));
  });
  root.replaceChildren(el('div', { class: 'panel' }, [el('h1', { text: title }), lead, form, after]));
}
