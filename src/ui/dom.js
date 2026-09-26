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

// 人格ごとのボタンの色(順番に使う)
const COLORS = ['#c6ff3d', '#ff3da6', '#3de8ff', '#ffb13d', '#9b5cff', '#7dffb0'];
export const personaColor = (i) => COLORS[i % COLORS.length];
