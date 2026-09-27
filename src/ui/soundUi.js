// 音の設定(人ごと):鳴らす・鳴らさないと、水の音・生き物や手ざわりの音の大きさ。
// スライダーを動かしている間は、その場の音に反映する(onChange)。「きめる」で保存、「もどる」で元に戻す
import { el } from './dom.js';

function slider(label, value, oninput) {
  const input = el('input', { type: 'range', min: '0', max: '100', step: '1', class: 'edit-range', 'aria-label': label });
  input.value = String(Math.round(value * 100));
  input.addEventListener('input', () => oninput(Number(input.value) / 100));
  return el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    el('label', { class: 'edit-slider sound-slider' }, [el('span', { text: '小さく' }), input, el('span', { text: '大きく' })]),
  ]);
}

// 確かめるための一言(URL に ?sound=check をつけたときだけ)。status: sound.status() を返す関数
function checkLine(status) {
  if (new URLSearchParams(location.search).get('sound') !== 'check') return null;
  const line = el('p', { class: 'quiet sound-check' });
  const show = () => {
    const s = status();
    line.textContent =
      `audioSession: ${s.audioSession ? 'あり' : 'なし'} / type: ${s.type ?? '-'} / state: ${s.sessionState ?? '-'}` +
      ` / AudioContext: ${s.context} / ${s.standalone ? 'ホーム画面から' : 'ブラウザで'}`;
  };
  show();
  // 鳴らす・止めるで変わるので、開いている間は見直す
  const timer = setInterval(() => (line.isConnected ? show() : clearInterval(timer)), 500);
  return line;
}

// sound: 今の設定 { on, ambient, effects }。
// ambientOk: 音の扱いを ambient にできた(false のときは、マナーモードでも鳴ることがあると一言出す)
export function renderSoundSettings(root, { persona, sound, ambientOk = true, status, onChange, onOk, onCancel }) {
  const next = { ...sound };
  const choices = [
    { on: true, label: '鳴らす' },
    { on: false, label: '鳴らさない' },
  ].map((o) =>
    el('button', {
      class: 'chip',
      type: 'button',
      text: o.label,
      onclick: () => {
        next.on = o.on;
        sync();
        onChange({ ...next });
      },
    }),
  );
  const sync = () => [true, false].forEach((on, i) => choices[i].setAttribute('aria-pressed', String(on === next.on)));
  sync();
  root.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h1', { class: 'soft', text: `${persona.name}の音` }),
      el('div', { class: 'sound-form' }, [
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: '音' }), el('div', { class: 'chip-row' }, choices)]),
        slider('水の音', next.ambient, (v) => {
          next.ambient = v;
          onChange({ ...next });
        }),
        slider('生き物や、さわったときの音', next.effects, (v) => {
          next.effects = v;
          onChange({ ...next });
        }),
        el('p', {
          class: 'quiet',
          text: ambientOk
            ? 'はじめは音なしです。iPhoneがマナーモードのときは鳴りません。'
            : 'はじめは音なしです。この端末では、マナーモードでも鳴ることがあります。',
        }),
        status ? checkLine(status) : null,
      ]),
      el('div', { class: 'row spread' }, [
        el('button', { class: 'btn sub', type: 'button', text: 'もどる', onclick: () => onCancel() }),
        el('button', { class: 'btn', type: 'button', text: 'きめる', onclick: () => onOk({ ...next }) }),
      ]),
    ]),
  );
}
