// 予期しないエラーが起きたとき、画面の端に内容を出す(iPhone ではコンソールが見られないため)。
// 同じ内容は1回だけ出す。
import { el } from './dom.js';

const shown = new Set();
let box = null;
let list = null;

function describe(err) {
  if (err instanceof Error) {
    const where = (err.stack ?? '').split('\n').slice(0, 4).join('\n');
    return { text: `${err.name}: ${err.message}`, where };
  }
  return { text: String(err), where: '' };
}

export function showError(err, context = '') {
  console.error(context, err);
  const { text, where } = describe(err);
  const key = `${context}|${text}`;
  if (shown.has(key)) return;
  shown.add(key);
  if (!box) {
    list = el('div', { class: 'error-list' });
    box = el('div', { id: 'error-box', role: 'status' }, [
      el('p', { class: 'error-lead', text: 'うまく動かなかったところがあります。この内容を送ってもらえると直せます。' }),
      list,
      el('button', {
        class: 'btn sub',
        type: 'button',
        text: 'とじる',
        onclick: () => {
          box.remove();
          box = null;
        },
      }),
    ]);
  }
  list.append(el('pre', { text: [context, text, where].filter(Boolean).join('\n') }));
  if (!box.isConnected) document.body.append(box);
}

// ページ全体の、拾われなかったエラーも出す
export function watchErrors() {
  window.addEventListener('error', (e) => showError(e.error ?? e.message, 'error'));
  window.addEventListener('unhandledrejection', (e) => showError(e.reason, 'promise'));
}
