// おねがい(ほかの人の水槽の子をもらいたい)の画面。
// - おねがいする:受け取る自分の水槽を選ぶ(いっぱいでも選べる)
// - おねがいの一覧:出したおねがい(取り消せる)・届いているおねがい(あげる/今はやめておく)・受け付けるかどうかの設定
// - 持ち主への知らせ:「〈名前〉が、この子をほしがっています」
// - 届いた知らせ:「〈名前〉から届きました」
// 急かしたり、否定的に聞こえたりする言い方はしない。
import { el } from './dom.js';
import { portrait, portraitColor } from '../creature/portrait.js';
import { TANK_CAPACITY } from '../creature/lifeConfig.js';

function picture(data, w, h, extraClass = '') {
  const url = portrait(data, w, h);
  return el('div', { class: `photo ${extraClass}`.trim() }, [
    url
      ? el('img', { class: 'pic', src: url, alt: '', width: String(w), height: String(h) })
      : el('span', { class: 'pic-dot', style: { background: portraitColor(data) } }),
  ]);
}

/**
 * ownerName: 持ち主の名前、creature: その子の保存データ
 * tanks: 自分の水槽 [{ id, label, count }](いっぱいでも選べる)
 */
export function renderAskForm(root, { ownerName, creature, tanks, onOk, onCancel }) {
  let selected = tanks[0]?.id ?? null; // null は新しい水槽
  const options = [...tanks.map((t) => ({ id: t.id, label: t.label, sub: `${t.count}匹` })), { id: null, label: '新しい水槽', sub: '' }];
  const buttons = options.map((o) =>
    el('button', { class: 'chip', type: 'button', onclick: () => ((selected = o.id), sync()) }, [
      el('span', { text: o.label }),
      o.sub ? el('span', { class: 'chip-sub', text: o.sub }) : null,
    ]),
  );
  const note = el('p', { class: 'ask-note' });
  function sync() {
    options.forEach((o, i) => buttons[i].setAttribute('aria-pressed', String(o.id === selected)));
    const t = tanks.find((x) => x.id === selected);
    note.textContent =
      t && t.count >= TANK_CAPACITY
        ? `この水槽は今${t.count}匹です。届いたときに、どの子がどこで暮らすか決められます。`
        : '届いたあとで、ほかの水槽へ移すこともできます。';
  }
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { text: 'この子をもらいたい' }),
      picture(creature, 240, 160, 'lead'),
      el('p', { text: `${ownerName}に、おねがいを出します。${ownerName}が次に水槽を開いたときに、決めてもらいます。` }),
      el('p', { class: 'field-label', text: '受け取る水槽' }),
      el('div', { class: 'chip-row ask-tanks' }, buttons),
      note,
      el('div', { class: 'row spread' }, [
        el('button', { class: 'btn sub', type: 'button', text: 'やめる', onclick: () => onCancel() }),
        el('button', { class: 'btn', type: 'button', text: 'おねがいする', onclick: () => onOk(selected) }),
      ]),
    ]),
  );
  sync();
}

/**
 * outgoing: 出したおねがい [{ request, ownerName, targetLabel }]
 * incoming: 届いているおねがい [{ request, fromName }]
 * closed:   おねがいを受け付けない設定
 */
export function renderRequestList(root, { persona, outgoing, incoming, closed, onWithdraw, onGive, onNotNow, onSetClosed, onBack }) {
  const card = (data, lines, actions) =>
    el('div', { class: 'request-card' }, [
      picture(data, 120, 80),
      el('div', { class: 'request-body' }, [...lines.map((t) => el('p', { text: t })), el('div', { class: 'request-actions' }, actions)]),
    ]);

  const incomingCards = incoming.map(({ request: r, fromName }) =>
    card(
      r.creature,
      [`${fromName}が、この子をほしがっています`],
      [
        el('button', { class: 'btn sub small', type: 'button', text: '今はやめておく', onclick: () => onNotNow(r) }),
        el('button', { class: 'btn small', type: 'button', text: 'あげる', onclick: () => onGive(r) }),
      ],
    ),
  );
  const outgoingCards = outgoing.map(({ request: r, ownerName, targetLabel }) =>
    card(
      r.creature,
      [`${ownerName}の水槽の子`, `受け取る水槽:${targetLabel}`],
      [el('button', { class: 'btn sub small', type: 'button', text: '取り消す', onclick: () => onWithdraw(r) })],
    ),
  );

  const setting = [
    { on: false, label: '受け付ける' },
    { on: true, label: '受け付けない' },
  ].map((o) => el('button', { class: 'chip', type: 'button', text: o.label, 'aria-pressed': String(o.on === !!closed), onclick: () => onSetClosed(o.on) }));

  root.replaceChildren(
    el('div', { class: 'panel wide' }, [
      el('h1', { text: `${persona.name}のおねがい` }),
      el('h2', { class: 'collection-tank', text: '届いているおねがい' }),
      ...(incomingCards.length ? incomingCards : [el('p', { class: 'quiet', text: '今はありません。' })]),
      el('h2', { class: 'collection-tank', text: '出したおねがい' }),
      ...(outgoingCards.length
        ? outgoingCards
        : [el('p', { class: 'quiet', text: '今はありません。ほかの人の水槽をのぞいて、観察しているときに出せます。' })]),
      el('h2', { class: 'collection-tank', text: 'ほかの人からのおねがい' }),
      el('div', { class: 'chip-row' }, setting),
      el('p', {
        class: 'quiet',
        text: closed ? 'ほかの人は、水槽をのぞくことはできますが、おねがいは出せません。' : 'ほかの人が、水槽の子へのおねがいを出せます。',
      }),
      el('div', { class: 'row' }, [el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: onBack })]),
    ]),
  );
}

// 持ち主への知らせ(水槽を開いたとき、1つのおねがいにつき1回だけ)
export function renderRequestNotice(root, { request, fromName, onGive, onNotNow, onLater }) {
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { class: 'soft', text: 'おねがい' }),
      picture(request.creature, 240, 160, 'lead'),
      el('p', { text: `${fromName}が、この子をほしがっています。` }),
      el('p', { class: 'quiet', text: 'あげると、この子は泡に包まれて、今の姿のまま引っ越します。' }),
      el('div', { class: 'row spread' }, [
        el('button', { class: 'btn sub', type: 'button', text: '今はやめておく', onclick: () => onNotNow() }),
        el('button', { class: 'btn', type: 'button', text: 'あげる', onclick: () => onGive() }),
      ]),
      el('div', { class: 'row' }, [el('button', { class: 'quiet-btn', type: 'button', text: 'あとで', onclick: () => onLater() })]),
    ]),
  );
}

// おねがいした人への知らせ(届いたあと、次に開いたとき1回)
export function renderArrivalNotice(root, { request, ownerName, tankLabel, onVisit, onClose }) {
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { class: 'soft', text: 'とどきました' }),
      picture(request.creature, 240, 160, 'lead'),
      el('p', { text: `${ownerName}から届きました。` }),
      tankLabel ? el('p', { class: 'quiet', text: `${tankLabel}にいます。` }) : null,
      el('div', { class: 'row spread' }, [
        el('button', { class: 'btn sub', type: 'button', text: 'とじる', onclick: () => onClose() }),
        onVisit ? el('button', { class: 'btn', type: 'button', text: '見に行く', onclick: () => onVisit() }) : null,
      ]),
    ]),
  );
}
