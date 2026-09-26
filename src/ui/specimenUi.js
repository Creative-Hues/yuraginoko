// 標本の画面:人ごとの一覧と、1つの標本の詳しい画面。
// 姿は標本にした瞬間のまま(静止画)。結晶の光だけが、CSS でごくゆっくりゆらぐ。
import { el } from './dom.js';
import { portrait, portraitColor } from '../creature/portrait.js';

function crystal(data, w, h, extraClass = '') {
  const url = portrait(data, w, h);
  const inner = url
    ? el('img', { class: 'pic', src: url, alt: '', width: String(w), height: String(h) })
    : el('span', { class: 'pic-dot', style: { background: portraitColor(data) } });
  return el('div', { class: `crystal ${extraClass}`.trim() }, [inner, el('span', { class: 'crystal-light' })]);
}

const displayName = (s) => s.name || 'なまえはまだ';

function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function renderSpecimenList(root, { persona, specimens, onOpen, onBack }) {
  const grid = specimens.length
    ? el(
        'div',
        { class: 'specimen-grid' },
        specimens.map((s) =>
          el('button', { class: 'specimen-card', type: 'button', onclick: () => onOpen(s) }, [
            crystal(s.creature, 150, 100),
            el('span', { class: 'specimen-name', text: displayName(s) }),
          ]),
        ),
      )
    : el('p', { text: '標本にした子は、ここに並びます。' });
  root.replaceChildren(
    el('div', { class: 'panel wide' }, [
      el('h1', { text: '標本' }),
      el('p', { class: 'specimen-owner', text: persona.name }),
      grid,
      el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack })]),
    ]),
  );
}

export function renderSpecimenDetail(root, { specimen: s, onEdit, onBack }) {
  const parents = s.creature?.parents ?? [];
  const info = el('div', { class: 'specimen-info' }, [
    el('h1', { class: 'specimen-title', text: displayName(s) }),
    s.note ? el('p', { class: 'specimen-note', text: s.note }) : null,
    parents.length
      ? el('div', { class: 'parents' }, [
          el('span', { class: 'field-label', text: '親' }),
          el(
            'div',
            { class: 'parent-row' },
            parents.map((p) => crystal(p, 120, 80, 'small')),
          ),
        ])
      : null,
    el('p', { class: 'specimen-date', text: `標本にした日:${formatDate(s.madeAt)}` }),
    el('div', { class: 'row spread' }, [
      el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack }),
      el('button', { class: 'btn', type: 'button', text: 'なおす', onclick: onEdit, 'aria-label': '名前と説明をなおす' }),
    ]),
  ]);
  root.replaceChildren(el('div', { class: 'panel wide specimen-detail' }, [crystal(s.creature, 300, 200, 'large'), info]));
}
