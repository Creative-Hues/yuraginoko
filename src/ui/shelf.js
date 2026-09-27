// 水槽の棚:人ごとに1段の棚があり、その人の水槽が並ぶ。ほかの人の水槽は、押すと「のぞく」。
// 水槽は DOM と CSS だけで描く(水の色・土の色・住んでいる子の色の点)。キャンバスは使わない。
import { el, personaColor } from './dom.js';
import { LIGHT_COLORS, SOILS } from '../tank/envConfig.js';
import { normalizeEnv } from '../tank/environment.js';

// 水槽の表示名。名前がなければ「1つ目の水槽」…
export function tankLabel(rec, index) {
  const name = typeof rec?.name === 'string' ? rec.name.trim() : '';
  return name || `${index + 1}つ目の水槽`;
}

function miniTank(rec, index, { current, onOpen, onRename, own }) {
  const env = normalizeEnv(rec.env);
  const water = LIGHT_COLORS[env.light.color].water;
  const soil = SOILS[env.soil].floor[0];
  const dots = (rec.creatures ?? []).map((c, i) =>
    el('span', {
      class: (c.growth ?? 1) < 1 ? 'tank-dot baby' : 'tank-dot',
      style: {
        background: `hsl(${Math.round((c.genes?.hue ?? 0.8) * 360)}, 100%, 60%)`,
        left: `${14 + ((i * 23) % 70)}%`,
        bottom: `${22 + ((i * 17) % 30)}%`,
      },
    }),
  );
  const eggs = (rec.eggs ?? []).map((e, i) => el('span', { class: 'tank-egg', style: { left: `${70 - i * 12}%` } }));
  const box = el(
    'button',
    {
      class: current ? 'tank-box current' : 'tank-box',
      type: 'button',
      'aria-label': own ? tankLabel(rec, index) : `${tankLabel(rec, index)}をのぞく`,
      style: { background: `linear-gradient(${water[0]}, ${water[1]} 55%, ${water[2]})` },
      onclick: () => onOpen(rec),
    },
    [el('span', { class: 'tank-soil', style: { background: soil } }), ...dots, ...eggs],
  );
  return el('div', { class: 'tank-slot' }, [
    box,
    el('div', { class: 'tank-name' }, [
      el('span', { text: tankLabel(rec, index) }),
      own ? el('button', { class: 'rename-btn', type: 'button', 'aria-label': '名前をつける', text: '✎', onclick: () => onRename(rec, index) }) : null,
    ]),
  ]);
}

// groups: [{ persona, index(人の順番), tanks: [保存データ] }]
// viewerId: 今の人(その人の段だけ、開く・ふやす・名前をつける・おねがい。ほかの人の水槽は「のぞく」)
export function renderShelf(root, { title = '水槽', lead, groups, viewerId, currentTankId, onOpen, onPeek, onAddTank, onRename, onSpecimens, onCollection, onRequests, onOther, onClose }) {
  const shelves = groups.map(({ persona, index, tanks }) => {
    const own = !viewerId || persona.id === viewerId;
    return el('section', { class: 'shelf' }, [
      el('div', { class: 'shelf-head' }, [
        el('span', { class: 'shelf-name', text: `${persona.name}の水槽`, style: { background: personaColor(index) } }),
        el('div', { class: 'shelf-chips' }, [
          own && onRequests ? el('button', { class: 'chip', type: 'button', text: 'おねがい', onclick: () => onRequests(persona) }) : null,
          el('button', { class: 'chip', type: 'button', text: '図鑑', onclick: () => onCollection(persona) }),
          el('button', { class: 'chip', type: 'button', text: '標本', onclick: () => onSpecimens(persona) }),
        ]),
      ]),
      el('div', { class: 'shelf-row' }, [
        ...tanks.map((rec, i) =>
          miniTank(rec, i, {
            own,
            current: rec.id === currentTankId,
            onOpen: (r) => (own ? onOpen(persona, r) : onPeek(persona, r)),
            onRename: (r, n) => onRename(persona, r, n),
          }),
        ),
        own
          ? el('div', { class: 'tank-slot' }, [
              el('button', { class: 'tank-box add', type: 'button', 'aria-label': '水槽をふやす', text: '+', onclick: () => onAddTank(persona) }),
              el('div', { class: 'tank-name' }, [el('span', { text: '水槽をふやす' })]),
            ])
          : null,
      ]),
      el('div', { class: 'shelf-board' }),
      own ? null : el('p', { class: 'shelf-note', text: '押すと、のぞくことができます' }),
    ]);
  });
  const panel = el('div', { class: 'panel wide' }, [
    el('h1', { text: title }),
    lead ? el('p', { text: lead }) : null,
    ...shelves,
    el('div', { class: 'row spread' }, [
      onOther ? el('button', { class: 'btn sub', type: 'button', text: 'ほかの名前', onclick: onOther }) : el('span'),
      onClose ? el('button', { class: 'btn sub', type: 'button', text: 'とじる', onclick: onClose }) : null,
    ]),
  ]);
  root.replaceChildren(panel);
}
