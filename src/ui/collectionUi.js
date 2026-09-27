// 図鑑の画面:人ごとの一覧と、1つの瞬間の詳しい画面、消すときの確認。
// 姿は残した瞬間のまま(静止画)。生き物そのものは水槽にいて、変わり続けている。
import { displayName, el } from './dom.js';
import { portrait, portraitColor } from '../creature/portrait.js';
import { COLOR_GROUPS, byGradient, colorGroupOf } from '../creature/colorGroup.js';
import { normalizeTraits, traitLines } from '../creature/traits.js';

const DRAW_PER_FRAME = 3; // 一覧の静止画を、1フレームに描く数(画面がすぐ開くように、少しずつ描く)

const SORTS = [
  { key: 'time', label: '残した順' },
  { key: 'color', label: '色の順' },
  { key: 'tank', label: '水槽ごと' },
];

// 選んでいる並べ替えと絞り込み(開いている間だけ覚える。保存はしない)
const view = { sort: 'time', group: 'all' };

const lookData = (m) => ({ ...(m.creature ?? {}), look: m.look });

export function formatDateTime(ms) {
  const d = new Date(ms);
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${mm}`;
}

// 写真のような額に入った姿。draw: false なら、あとで描く(色の点を仮に置く)
export function photo(m, w, h, extraClass = '', draw = true) {
  const frame = el('div', { class: `photo ${extraClass}`.trim() });
  const dot = () => el('span', { class: 'pic-dot', style: { background: portraitColor(lookData(m)) } });
  const paint = () => {
    const url = portrait(lookData(m), w, h);
    frame.replaceChildren(url ? el('img', { class: 'pic', src: url, alt: '', width: String(w), height: String(h) }) : dot());
  };
  if (draw) paint();
  else frame.append(dot());
  return { frame, paint };
}

/**
 * moments: その人の残した瞬間(残した順)
 * tanks:   その人の水槽 [{ id, label }](作った順)
 */
export function renderCollectionList(root, { persona, moments, tanks, onOpen, onBack }) {
  const cards = moments.map((m) => {
    const pic = photo(m, 150, 100, '', false);
    const node = el('button', { class: 'specimen-card', type: 'button', onclick: () => onOpen(m) }, [
      pic.frame,
      el('span', { class: 'specimen-name', text: displayName(m) }),
    ]);
    return { m, node, paint: pic.paint, group: colorGroupOf(m).key };
  });

  // 静止画を少しずつ描く(画面を離れたら止める)
  let next = 0;
  const drawSome = () => {
    if (!body.isConnected) return;
    for (let i = 0; i < DRAW_PER_FRAME && next < cards.length; i++) cards[next++].paint();
    if (next < cards.length) requestAnimationFrame(drawSome);
  };

  const present = COLOR_GROUPS.filter((g) => cards.some((c) => c.group === g.key));
  if (view.group !== 'all' && !present.some((g) => g.key === view.group)) view.group = 'all';

  const sortChips = SORTS.map((s) =>
    el('button', { class: 'chip', type: 'button', text: s.label, onclick: () => ((view.sort = s.key), apply()) }),
  );
  const groupChips = [{ key: 'all', label: 'すべて' }, ...present].map((g) =>
    el('button', { class: 'chip', type: 'button', onclick: () => ((view.group = g.key), apply()) }, [
      g.key === 'all' ? null : el('span', { class: 'group-dot', style: { background: `hsl(${g.dot}, 100%, 60%)` } }),
      el('span', { text: g.label }),
    ]),
  );
  const body = el('div', { class: 'collection-body' });

  // 並べ替え・絞り込み:カードは作り直さず、並べ直すだけ(描いた静止画はそのまま)
  function apply() {
    SORTS.forEach((s, i) => sortChips[i].setAttribute('aria-pressed', String(view.sort === s.key)));
    ['all', ...present.map((g) => g.key)].forEach((k, i) => groupChips[i].setAttribute('aria-pressed', String(view.group === k)));
    const shown = cards.filter((c) => view.group === 'all' || c.group === view.group);
    const grid = (list) => el('div', { class: 'specimen-grid' }, list.map((c) => c.node));
    if (view.sort === 'tank') {
      // 水槽の作った順。見つからない水槽(念のため)は最後に
      const order = tanks.map((t) => t.id);
      const rank = (c) => (order.includes(c.m.tankId) ? order.indexOf(c.m.tankId) : order.length);
      const sections = [];
      for (const r of [...new Set(shown.map(rank))].sort((a, b) => a - b)) {
        const list = shown.filter((c) => rank(c) === r);
        const label = tanks[r]?.label ?? list[0].m.tankLabel ?? '';
        sections.push(el('h2', { class: 'collection-tank', text: label }), grid(list));
      }
      body.replaceChildren(...sections);
    } else {
      const list = view.sort === 'color' ? [...shown].sort((a, b) => byGradient(a.m, b.m)) : shown;
      body.replaceChildren(grid(list));
    }
  }

  root.replaceChildren(
    el('div', { class: 'panel wide' }, [
      el('h1', { text: `${persona.name}の図鑑` }),
      moments.length
        ? el('div', { class: 'collection-tools' }, [
            el('div', { class: 'chip-row' }, sortChips),
            present.length > 1 ? el('div', { class: 'chip-row' }, groupChips) : null,
          ])
        : el('p', { text: '残した瞬間は、ここに並びます。観察しているときの「図鑑に残す」から残せます。' }),
      body,
      el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack })]),
    ]),
  );
  apply();
  requestAnimationFrame(drawSome);
}

// tankLabel: 残した水槽の名前、onVisit: 元の子が水槽にいるときだけ(今の姿を見に行く)
export function renderMomentDetail(root, { moment: m, tankLabel, onVisit, onEdit, onDelete, onBack }) {
  const c = m.creature ?? {};
  const info = el('div', { class: 'specimen-info' }, [
    el('h1', { class: 'specimen-title', text: displayName(m) }),
    m.note ? el('p', { class: 'specimen-note', text: m.note }) : null,
    el('p', {
      class: 'specimen-sensitivity',
      text: `生まれつきの特徴:${traitLines(normalizeTraits(c.traits, c.genes, c.seed))
        .map((l) => `${l.label} ${l.text}`)
        .join(' / ')}`,
    }),
    el('p', { class: 'specimen-date', text: `残した日:${formatDateTime(m.takenAt)}` }),
    tankLabel ? el('p', { class: 'specimen-date', text: `${tankLabel}で残しました` }) : null,
    // ボタンは縦に:もどる・なおす(同じ幅)/ 今の姿を見に行く(幅いっぱい)/ 図鑑から消す(控えめ)
    el('div', { class: 'detail-actions' }, [
      el('div', { class: 'detail-pair' }, [
        el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack }),
        el('button', { class: 'btn', type: 'button', text: 'なおす', onclick: onEdit, 'aria-label': '名前とメモをなおす' }),
      ]),
      onVisit ? el('button', { class: 'btn', type: 'button', text: '今の姿を見に行く', onclick: onVisit }) : null,
      el('button', { class: 'quiet-btn', type: 'button', text: '図鑑から消す', onclick: onDelete }),
    ]),
  ]);
  root.replaceChildren(el('div', { class: 'panel wide specimen-detail' }, [photo(m, 260, 173, 'large').frame, info]));
}

// 消す前の確認(1回だけ)
export function renderMomentDelete(root, { moment: m, onOk, onCancel }) {
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { text: '図鑑から消す' }),
      photo(m, 240, 160, 'lead').frame,
      el('p', { text: 'この瞬間を図鑑から消しますか? 水槽の子は、そのままです。' }),
      el('div', { class: 'row spread' }, [
        el('button', { class: 'btn sub', type: 'button', text: 'やめる', onclick: onCancel }),
        el('button', { class: 'btn', type: 'button', text: '消す', onclick: onOk }),
      ]),
    ]),
  );
}
