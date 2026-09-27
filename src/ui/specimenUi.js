// 標本の画面:人ごとの一覧と、1つの標本の詳しい画面。
// 姿は標本にした瞬間のまま(静止画)。結晶の光だけが、CSS でごくゆっくりゆらぐ。
import { displayName, el } from './dom.js';
import { portrait, portraitColor } from '../creature/portrait.js';
import { normalizeSensitivity, sensitivityLines } from '../creature/sensitivity.js';
import { normalizeTraits, traitLines } from '../creature/traits.js';

function crystal(data, w, h, extraClass = '') {
  const url = portrait(data, w, h);
  const inner = url
    ? el('img', { class: 'pic', src: url, alt: '', width: String(w), height: String(h) })
    : el('span', { class: 'pic-dot', style: { background: portraitColor(data) } });
  return el('div', { class: `crystal ${extraClass}`.trim() }, [inner, el('span', { class: 'crystal-light' })]);
}

function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// onDelete(ids): 自分の標本のときだけ(「えらんで消す」を出す)。
// selecting・selected: えらぶモードで開く(消す確認から「やめる」で戻ったとき、えらんだものはそのまま)
export function renderSpecimenList(root, { persona, specimens, onOpen, onDelete, onBack, selecting = false, selected = [] }) {
  const picked = new Set(selected.filter((id) => specimens.some((s) => s.id === id)));
  let choosing = selecting && !!onDelete;

  const toggle = (s) => {
    if (picked.has(s.id)) picked.delete(s.id);
    else picked.add(s.id);
    sync();
  };
  const cards = specimens.map((s) => ({
    s,
    card: el('button', { class: 'specimen-card', type: 'button', onclick: () => (choosing ? toggle(s) : onOpen(s)) }, [
      crystal(s.creature, 150, 100),
      el('span', { class: 'specimen-name', text: displayName(s) }),
      el('span', { class: 'pick-mark', text: '✓', 'aria-hidden': 'true' }),
    ]),
  }));

  const lead = el('p', { class: 'quiet', text: '消す標本をえらんでください。' });
  const deleteBtn = el('button', { class: 'btn', type: 'button', onclick: () => picked.size && onDelete([...picked]) });
  const chooseRow = el('div', { class: 'row spread' }, [
    el('button', {
      class: 'btn sub',
      type: 'button',
      text: 'やめる',
      onclick: () => {
        choosing = false;
        picked.clear();
        sync();
      },
    }),
    deleteBtn,
  ]);
  const normalRow = el('div', { class: 'row spread' }, [
    onDelete && specimens.length
      ? el('button', {
          class: 'quiet-btn',
          type: 'button',
          text: 'えらんで消す',
          onclick: () => {
            choosing = true;
            sync();
          },
        })
      : el('span'),
    el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack }),
  ]);

  function sync() {
    for (const { s, card } of cards) {
      card.classList.toggle('choosing', choosing);
      card.setAttribute('aria-pressed', String(choosing && picked.has(s.id)));
    }
    lead.hidden = !choosing;
    chooseRow.hidden = !choosing;
    normalRow.hidden = choosing;
    deleteBtn.textContent = `${picked.size}個を消す`;
    deleteBtn.disabled = picked.size === 0;
  }

  const grid = specimens.length
    ? el(
        'div',
        { class: 'specimen-grid' },
        cards.map((c) => c.card),
      )
    : el('p', { text: '標本にした子は、ここに並びます。' });
  root.replaceChildren(el('div', { class: 'panel wide' }, [el('h1', { text: `${persona.name}の標本` }), lead, grid, chooseRow, normalRow]));
  sync();
}

// onEdit: 自分の標本のときだけ(ほかの人の標本は見るだけ)
export function renderSpecimenDetail(root, { specimen: s, onEdit, onBack }) {
  const parents = s.creature?.parents ?? [];
  const info = el('div', { class: 'specimen-info' }, [
    el('h1', { class: 'specimen-title', text: displayName(s) }),
    s.note ? el('p', { class: 'specimen-note', text: s.note }) : null,
    // 環境の受けやすさ(古い標本は、その子の seed から出す。水槽にいたときと同じになる)
    ...sensitivityLines(normalizeSensitivity(s.creature?.sensitivity, s.creature?.seed)).map((text) =>
      el('p', { class: 'specimen-sensitivity', text }),
    ),
    // 生まれつきの特徴(特徴遺伝子。古い標本は、その子の genes と seed から出す)
    el('p', {
      class: 'specimen-sensitivity',
      text: `生まれつきの特徴:${traitLines(normalizeTraits(s.creature?.traits, s.creature?.genes, s.creature?.seed))
        .map((l) => `${l.label} ${l.text}`)
        .join(' / ')}`,
    }),
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
    el('div', { class: 'detail-actions' }, [
      el('div', { class: 'detail-pair' }, [
        el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack }),
        onEdit ? el('button', { class: 'btn', type: 'button', text: 'なおす', onclick: onEdit, 'aria-label': '名前と説明をなおす' }) : null,
      ]),
    ]),
  ]);
  root.replaceChildren(el('div', { class: 'panel wide specimen-detail' }, [crystal(s.creature, 260, 173, 'large'), info]));
}
