// 藻(水槽の手前のガラスにつく汚れ)。
// 画面を粗いマス目に分けて、マスごとに藻の量(0〜1)を持つ。
// 水槽を閉じていた日数に応じて増え、掃除モードで擦ると減る。
//
// 調整するときは ALGAE の数字を直す。
import { clamp, lerp } from '../util/math.js';
import { makeRng } from '../util/random.js';

export const ALGAE = {
  GRID_W: 48,
  GRID_H: 27,
  // 閉じていた日数 → 藻の量(0〜1)。間は直線でつなぎ、最後の日数より先は増えない
  GROWTH: [
    [0, 0],
    [1, 0.03],
    [3, 0.25],
    [7, 0.65],
    [14, 1],
  ],
  MAX_ALPHA: 0.55, // いちばん濃いところでも、これより濃くしない(真っ暗にしない)
  MIN_WEIGHT: 0.35, // つきにくいマスでも、最大でこれくらいはつく
  BRUSH: 0.1, // 掃除のブラシの半径(画面の高さに対する割合)
  ERASE_SPEED: 1.25, // ブラシの中心を、半径ぶん擦ったときに減る量
  // マスの量がこれより少ないと、画面には描かれない(描くときのいちばん薄い段)。
  // 擦ってこれより少なくなったマスは 0 にし、見える藻が1つもなくなったら掃除を終える
  VISIBLE_MIN: 0.06,
  CALM_MIN: 0.5, // 藻がいっぱいのときの、生き物の動きの速さ(ふだん = 1)
};

export const DAY_MS = 24 * 60 * 60 * 1000;

const N = ALGAE.GRID_W * ALGAE.GRID_H;

// 閉じていた日数 → 量
export function growthAmount(days) {
  const g = ALGAE.GROWTH;
  if (!(days > 0)) return 0;
  for (let i = 1; i < g.length; i++) {
    const [d1, a1] = g[i];
    if (days <= d1) {
      const [d0, a0] = g[i - 1];
      return lerp(a0, a1, (days - d0) / (d1 - d0));
    }
  }
  return g[g.length - 1][1];
}

// 量 → 何日ぶんか(growthAmount の逆)
export function growthDays(amount) {
  const g = ALGAE.GROWTH;
  if (!(amount > 0)) return 0;
  for (let i = 1; i < g.length; i++) {
    const [d1, a1] = g[i];
    if (amount <= a1) {
      const [d0, a0] = g[i - 1];
      return a1 === a0 ? d0 : lerp(d0, d1, (amount - a0) / (a1 - a0));
    }
  }
  return g[g.length - 1][0];
}

// マスごとの「つきやすさ」(MIN_WEIGHT〜1)。水槽の seed で決まり、端と下のほうが多め、まだらになる
function makeWeights(seed) {
  const { GRID_W: gw, GRID_H: gh, MIN_WEIGHT } = ALGAE;
  const rng = makeRng((seed ^ 0x5eed) >>> 0);
  // 粗い乱数の格子をなめらかにつないだ、ゆるいまだら
  const cw = 9;
  const ch = 6;
  const coarse = Array.from({ length: cw * ch }, () => rng());
  const at = (i, j) => coarse[Math.min(ch - 1, j) * cw + Math.min(cw - 1, i)];
  const weights = new Float32Array(N);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const fx = (x / (gw - 1)) * (cw - 1);
      const fy = (y / (gh - 1)) * (ch - 1);
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const kx = fx - i;
      const ky = fy - j;
      const sx = kx * kx * (3 - 2 * kx);
      const sy = ky * ky * (3 - 2 * ky);
      const noise = lerp(lerp(at(i, j), at(i + 1, j), sx), lerp(at(i, j + 1), at(i + 1, j + 1), sx), sy);
      const nx = x / (gw - 1);
      const ny = y / (gh - 1);
      const edge = 1 - Math.min(nx, 1 - nx, ny, 1 - ny) * 2; // 端ほど 1
      const w = 0.5 * noise + 0.3 * edge * edge + 0.2 * ny + (rng() - 0.5) * 0.1;
      weights[y * gw + x] = lerp(MIN_WEIGHT, 1, clamp(w));
    }
  }
  return weights;
}

export class Algae {
  // saved: 保存されていた { w, h, cells }(無い・形が違うときは藻なしから始める)
  constructor(saved, seed = 1) {
    this.weights = makeWeights(seed);
    this.weightSum = this.weights.reduce((s, w) => s + w, 0);
    this.cells = new Float32Array(N);
    const ok = saved && saved.w === ALGAE.GRID_W && saved.h === ALGAE.GRID_H && saved.cells?.length === N;
    if (ok) {
      for (let i = 0; i < N; i++) {
        const v = saved.cells[i];
        this.cells[i] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, this.weights[i]) : 0;
      }
    }
    this.revision = 0; // 形が変わるたびに増える(描き直しの目安)
    this.updateLevel();
  }

  // 画面に見える藻が、どこかに残っているか
  hasVisible() {
    for (let i = 0; i < N; i++) if (this.cells[i] >= ALGAE.VISIBLE_MIN) return true;
    return false;
  }

  updateLevel() {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += this.cells[i];
    this.level = sum / this.weightSum;
    this.revision++;
  }

  // 閉じていた日数ぶん増やす。一部だけ掃除したマスも、今の量から続きで育つ
  grow(days) {
    if (!(days > 0)) return false;
    for (let i = 0; i < N; i++) {
      const w = this.weights[i];
      const had = growthDays(this.cells[i] / w);
      this.cells[i] = growthAmount(had + days) * w;
    }
    this.updateLevel();
    return true;
  }

  // 画面上の (nx, ny)(0〜1)を中心に、半径 (rx, ry)(画面の幅・高さに対する割合)のブラシで減らす。
  // amount はブラシの中心で減る量。減ったら true
  erase(nx, ny, rx, ry, amount) {
    const { GRID_W: gw, GRID_H: gh } = ALGAE;
    const x0 = Math.max(0, Math.floor((nx - rx) * gw));
    const x1 = Math.min(gw - 1, Math.ceil((nx + rx) * gw));
    const y0 = Math.max(0, Math.floor((ny - ry) * gh));
    const y1 = Math.min(gh - 1, Math.ceil((ny + ry) * gh));
    let changed = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * gw + x;
        if (this.cells[i] <= 0) continue;
        const dx = ((x + 0.5) / gw - nx) / rx;
        const dy = ((y + 0.5) / gh - ny) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 1) continue;
        const v = this.cells[i] - amount * (1 - d2);
        this.cells[i] = v < ALGAE.VISIBLE_MIN ? 0 : v; // 見えないほど薄くなったら、消しきる
        changed = true;
      }
    }
    if (changed) this.updateLevel();
    return changed;
  }

  clear() {
    this.cells.fill(0);
    this.updateLevel();
  }

  toData() {
    return {
      w: ALGAE.GRID_W,
      h: ALGAE.GRID_H,
      cells: Array.from(this.cells, (v) => Math.round(v * 1000) / 1000),
    };
  }
}

// 生き物の動きの速さ(藻が多いほどゆっくり)
export function calmFor(level) {
  return lerp(1, ALGAE.CALM_MIN, clamp(level));
}

// ---- 描画 ----
// マス目を小さく描いてから引き伸ばし、濃さを数段に区切ってベタ塗りにする(グラフィティ調)。
// 上に細かい点々を重ねる。藻の形が変わったときだけ描き直す。

const BANDS = [
  // [この濃さ以上, 色]
  [ALGAE.VISIBLE_MIN, [120, 150, 60]],
  [0.3, [96, 128, 44]],
  [0.58, [74, 104, 36]],
  [0.82, [58, 84, 30]],
];
const RES = 0.5; // 画面に対する、藻の絵の解像度

export class AlgaeView {
  constructor() {
    this.grid = null;
    this.canvas = null;
    this.speckle = null;
    this.drawn = -1;
    this.size = '';
  }

  // 藻の絵を、必要なら描き直してから画面全体に重ねる
  draw(ctx, algae, W, H) {
    if (!algae || algae.level <= 0) return;
    const size = `${W}x${H}`;
    if (this.drawn !== algae.revision || this.size !== size) {
      // キャンバスが使えなかったときは、藻を描かずに続ける(次の変化のときにもう一度試す)
      if (!this.render(algae, W, H)) return;
      this.drawn = algae.revision;
      this.size = size;
    }
    ctx.drawImage(this.canvas, 0, 0, W, H);
  }

  render(algae, W, H) {
    const { GRID_W: gw, GRID_H: gh, MAX_ALPHA } = ALGAE;
    if (!this.grid) {
      this.grid = document.createElement('canvas');
      this.grid.width = gw;
      this.grid.height = gh;
      this.canvas = document.createElement('canvas');
      this.speckle = makeSpeckle();
    }
    // 1. マス目(白、濃さ = 量)
    const gctx = this.grid.getContext('2d');
    if (!gctx) return false;
    const img = gctx.createImageData(gw, gh);
    for (let i = 0; i < N; i++) {
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = Math.round(algae.cells[i] * 255);
    }
    gctx.putImageData(img, 0, 0);

    // 2. なめらかに引き伸ばす
    const cw = Math.max(1, Math.round(W * RES));
    const ch = Math.max(1, Math.round(H * RES));
    const c = this.canvas;
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.grid, 0, 0, gw, gh, 0, 0, cw, ch);

    // 3. 濃さを数段に区切って、段ごとにベタの色をつける
    const big = ctx.getImageData(0, 0, cw, ch);
    const d = big.data;
    for (let p = 0; p < d.length; p += 4) {
      const a = d[p + 3] / 255;
      let band = -1;
      for (let b = 0; b < BANDS.length; b++) if (a >= BANDS[b][0]) band = b;
      if (band < 0) {
        d[p + 3] = 0;
        continue;
      }
      const [r, g, bl] = BANDS[band][1];
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = bl;
      d[p + 3] = Math.round(MAX_ALPHA * 255 * ((band + 1) / BANDS.length));
    }
    ctx.putImageData(big, 0, 0);

    // 4. 藻のあるところにだけ、細かい点々
    if (this.speckle) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = ctx.createPattern(this.speckle, 'repeat');
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
    }
    return true;
  }
}

function makeSpeckle() {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const rng = makeRng(7);
  for (let i = 0; i < 140; i++) {
    const dark = rng() < 0.6;
    ctx.fillStyle = dark ? 'rgba(30, 48, 12, 0.5)' : 'rgba(190, 215, 110, 0.45)';
    ctx.beginPath();
    ctx.arc(rng() * 96, rng() * 96, 0.5 + rng() * (dark ? 1.4 : 0.9), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}
