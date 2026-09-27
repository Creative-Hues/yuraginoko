// 図鑑の色分け。体の色はどれも鮮やかなので、基本の色(hue)だけで分ける。
// data: 残した瞬間 { look, creature }(look が無ければ creature.genes)
import { wrap01 } from '../util/math.js';

// to: そのグループの終わりの色相(度)。赤は 345° から一周して 15° まで
export const COLOR_GROUPS = [
  { key: 'red', label: '赤っぽい', to: 15, dot: 0 },
  { key: 'orange', label: 'だいだいっぽい', to: 40, dot: 28 },
  { key: 'yellow', label: '黄色っぽい', to: 70, dot: 55 },
  { key: 'green', label: '緑っぽい', to: 165, dot: 120 },
  { key: 'aqua', label: '水色っぽい', to: 200, dot: 185 },
  { key: 'blue', label: '青っぽい', to: 255, dot: 225 },
  { key: 'purple', label: '紫っぽい', to: 290, dot: 272 },
  { key: 'pink', label: '桃色っぽい', to: 345, dot: 318 },
];

const START = 345 / 360; // グラデーションの始まり(赤の手前)

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function momentHue(data) {
  return wrap01(num(data?.look?.hue, num(data?.creature?.genes?.hue, 0)));
}

function momentHue2(data) {
  return wrap01(num(data?.look?.hue2, num(data?.creature?.genes?.hue2, 0)));
}

// 赤の手前から一周したときの位置(0〜1)
const along = (hue) => wrap01(hue - START);

export function colorGroupOf(data) {
  const deg = along(momentHue(data)) * 360; // 赤の手前(345°)を 0 とした角度
  for (const g of COLOR_GROUPS) {
    if (deg < ((g.to - 345 + 360) % 360 || 360)) return g;
  }
  return COLOR_GROUPS[COLOR_GROUPS.length - 1];
}

// 色のグラデーション順(赤 → だいだい → … → 桃)。ほぼ同じ色なら、2つ目の色で並べる
export function byGradient(a, b) {
  const d = along(momentHue(a)) - along(momentHue(b));
  if (Math.abs(d) > 1e-6) return d;
  return along(momentHue2(a)) - along(momentHue2(b));
}
