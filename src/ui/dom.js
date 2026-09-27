// 小さな DOM 作成の手伝い。名前などは textContent で入れる(HTML として解釈させない)
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

// 名前ごとのボタンの色。色を選んでいない人(前からいる人)は、登録順にこの6色を使う(今の色のまま)
const COLORS = ['#c6ff3d', '#ff3da6', '#3de8ff', '#ffb13d', '#9b5cff', '#7dffb0'];
export const personaColor = (i) => COLORS[i % COLORS.length];

// 選べる色(8色)
export const PERSONA_COLORS = [...COLORS, '#ffe14d', '#ff8a8a'];

// その人の色(選んだ色、なければ登録順の色)。index: 人の順番
export const colorOf = (persona, index) => persona?.color || personaColor(index);

// 色を選ぶ丸いボタンの並び。onChange(色)
export function colorPicker(value, onChange) {
  let selected = value;
  const dots = PERSONA_COLORS.map((color) =>
    el('button', {
      class: 'color-dot',
      type: 'button',
      'aria-label': '色',
      style: { background: color },
      onclick: () => {
        selected = color;
        sync();
        onChange(color);
      },
    }),
  );
  const sync = () => PERSONA_COLORS.forEach((c, i) => dots[i].setAttribute('aria-pressed', String(c === selected)));
  sync();
  return el('div', { class: 'color-row' }, dots);
}

// 名前が空欄のときの表示(図鑑・標本の一覧と詳しい画面で共通)
export const displayName = (item) => item?.name || '名無し';
