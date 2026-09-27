// データの書き出し・読み込みの画面。公開版への引っ越しや、機種変更のときの控えに使う。
import { el } from './dom.js';

// 「〇人の、水槽〇個・標本〇個・図鑑〇枚」
export const describeCounts = (c) => `${c.people}人の、水槽${c.tanks}個・標本${c.specimens}個・図鑑${c.moments}枚`;

// counts: 今のデータの数(空なら書き出すボタンは出さない)。onPickFile(file)
export function renderBackupMenu(root, { counts, empty, onExport, onPickFile, onBack }) {
  const input = el('input', { type: 'file', accept: '.json,application/json', class: 'file-input', 'aria-label': 'ファイルを選ぶ' });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onPickFile(file);
  });
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { class: 'soft', text: 'データの書き出し・読み込み' }),
      el('p', { class: 'quiet', text: '別のアドレスで開くときや、機種を変えるときに、今のデータを持っていけます。' }),
      el('section', { class: 'backup-part' }, [
        el('h2', { text: '書き出す' }),
        empty
          ? el('p', { text: 'まだ書き出すデータはありません。' })
          : el('p', { text: `${describeCounts(counts)}を、1つのファイルにします。` }),
        empty ? null : el('div', { class: 'row' }, [el('button', { class: 'btn', type: 'button', text: '書き出す', onclick: () => onExport() })]),
      ]),
      el('section', { class: 'backup-part' }, [
        el('h2', { text: '読み込む' }),
        el('p', { text: '書き出したファイルを選ぶと、中身をお見せします。' }),
        el('div', { class: 'row' }, [el('label', { class: 'btn' }, ['ファイルを選ぶ', input])]),
      ]),
      el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: () => onBack() })]),
    ]),
  );
}

// 読み込むファイルの中身。empty: 今のデータが空(そのまま読み込む)
export function renderImportPreview(root, { counts, empty, onImport, onAdd, onReplace, onCancel }) {
  const choices = empty
    ? [el('button', { class: 'btn', type: 'button', text: '読み込む', onclick: () => onImport() })]
    : [
        el('button', { class: 'btn', type: 'button', text: '今のデータに追加する', onclick: () => onAdd() }),
        el('button', { class: 'btn', type: 'button', text: '今のデータと入れかえる', onclick: () => onReplace() }),
      ];
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { class: 'soft', text: 'データを読み込む' }),
      el('p', { text: `${describeCounts(counts)}が入っています。` }),
      empty
        ? null
        : el('p', { class: 'quiet', text: '追加するときは、同じものがすでにあれば今あるほうを残します。同じ名前の人は1人にまとめます。' }),
      el('div', { class: 'row backup-choices' }, choices),
      el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: 'やめる', onclick: () => onCancel() })]),
    ]),
  );
}

// 読み込めなかったとき(今のデータには何もしていない)
export function renderImportFailed(root, { onBack }) {
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { class: 'soft', text: 'このファイルは読み込めませんでした' }),
      el('p', { text: '今のデータは、そのままです。' }),
      el('p', { class: 'quiet', text: 'このゲームで書き出したファイルを選んでみてください。' }),
      el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: () => onBack() })]),
    ]),
  );
}
