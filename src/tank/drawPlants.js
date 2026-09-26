// 植物の描画(グラフィティ調:太い輪郭、ベタ塗り、影は1色)。
// ふだんはキャンバスを新しく作らずに、画面のキャンバスへパスで直接描く(iPhone のキャンバス用メモリを増やさないため)。
//
// 葉や茎は「根元から先へ、少しずつ向きを変えながら伸びる線」(curve)で作り、
// ふだんのゆれと、水流の向き・強さに合わせて先のほうほど大きくなびく。
//
// 大きい(growth 1)→ とても大きい(growth 2)の間は、背が伸びるだけでなく、
// 葉や花が1つずつ芽を出すように増えていく(b.rich: 0 → 1)。
import { clamp, lerp } from '../util/math.js';
import { wave } from '../util/noise.js';
import { CURRENT_LOOK, PLANTS, PLANT_GROWTH } from './envConfig.js';
import { plantStage } from './plants.js';

const TAU = Math.PI * 2;
const INK = 'rgba(11, 5, 20, 0.92)';

// 大きいときの大きさ(生き物の体の長さに対する割合)
const SIZE = {
  toge: { w: 0.4, h: 0.42 },
  hira: { w: 0.45, h: 0.5 },
  nobi: { w: 0.3, h: 0.95 },
  maru: { w: 0.42, h: 0.26 },
  redFlower: { w: 0.32, h: 0.62 },
  blueFlower: { w: 0.4, h: 0.56 },
  yellowFlower: { w: 0.3, h: 0.58 },
  glowCap: { w: 0.36, h: 0.36 },
};
// とても大きいときの大きさ。h: 手前に植えたときの高さ(水槽の高さに対する割合)、
// w: 幅(生き物の体の長さに対する割合)、thick: 葉や花の太さ・大きさの倍率
const HUGE = {
  toge: { w: 1.0, h: 0.5, thick: 1.6 },
  hira: { w: 1.1, h: 0.52, thick: 1.8 },
  nobi: { w: 0.7, h: 0.67, thick: 1.4 },
  maru: { w: 1.1, h: 0.42, thick: 1.6 },
  redFlower: { w: 0.8, h: 0.6, thick: 1.5 },
  blueFlower: { w: 0.9, h: 0.55, thick: 1.5 },
  yellowFlower: { w: 0.8, h: 0.6, thick: 1.5 },
  glowCap: { w: 0.9, h: 0.5, thick: 1.8 },
};
const SPROUT_SIZE = { w: 0.17, h: 0.18 };

// 個体ごとに決まった「ばらつき」(0〜1)
function hash(seed, i) {
  const s = Math.sin((seed % 100000) * 0.001 + i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// 芽〜大きいの間の、大きさの倍率
function growScale(growth) {
  const { SMALL_AT } = PLANT_GROWTH;
  if (growth < SMALL_AT) return lerp(0.55, 1, growth / SMALL_AT);
  return lerp(0.45, 1, (growth - SMALL_AT) / (1 - SMALL_AT));
}

// 画面上での植物の大きさ(描く大きさ・当たり判定・透かす判定に使う)
// U: 葉や花の太さの基準、lwU: 輪郭の太さの基準、rich: 大きい → とても大きいの進み具合(0〜1)
export function plantBox(geo, p) {
  const pos = geo.project(p.x, p.z);
  const U = geo.creatureSize * pos.scale;
  const base = { x: pos.x, y: pos.floorY, lwU: U };
  if (plantStage(p.growth) === 'sprout') {
    const k = growScale(p.growth);
    return { ...base, w: SPROUT_SIZE.w * U * k, h: SPROUT_SIZE.h * U * k, U, rich: 0 };
  }
  const size = SIZE[p.kind] ?? SPROUT_SIZE;
  if (p.growth <= 1) {
    const k = growScale(p.growth);
    return { ...base, w: size.w * U * k, h: size.h * U * k, U, rich: 0 };
  }
  const huge = HUGE[p.kind] ?? { w: size.w, h: 0, thick: 1 };
  const e = clamp(p.growth - 1);
  return {
    ...base,
    w: lerp(size.w * U, huge.w * U, e),
    h: Math.max(size.h * U, lerp(size.h * U, huge.h * geo.H * pos.scale, e)),
    U: U * lerp(1, huge.thick, e),
    rich: e,
  };
}

// 増えていく部分の i 番目(全部で n 個)の育ち具合(0 = まだない〜1 = 育ちきった)。
// 大きくなり始めてすぐから、1つずつ芽を出すように増える
function extra(rich, i, n) {
  return clamp(clamp((rich - 0.05) / 0.9) * n - i);
}

// 根元 (x, y) から、長さ len の線を n 分割で伸ばす。a0: 根元の向き(0 = 真上、+ で右)、bend: 先までに曲がる量
function curve(x, y, len, a0, bend, n = 7) {
  const pts = [{ x, y, a: a0 }];
  const seg = len / n;
  let a = a0;
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    a = a0 + bend * f * f;
    x += Math.sin(a) * seg;
    y -= Math.cos(a) * seg;
    pts.push({ x, y, a });
  }
  return pts;
}

// 線に沿った、先の細い葉。width(f): 根元 0 〜 先 1 での幅
function leafPath(pts, width) {
  const left = [];
  const right = [];
  const n = pts.length - 1;
  for (let i = 0; i <= n; i++) {
    const p = pts[i];
    const w = width(i / n) / 2;
    const nx = Math.cos(p.a);
    const ny = Math.sin(p.a);
    left.push([p.x - nx * w, p.y - ny * w]);
    right.push([p.x + nx * w, p.y + ny * w]);
  }
  const path = new Path2D();
  path.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= n; i++) path.lineTo(left[i][0], left[i][1]);
  for (let i = n; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
  path.closePath();
  return path;
}

function fillOutlined(ctx, path, color, lw) {
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke(path);
}

// 外側に輪郭をつけた線(茎)
function stem(ctx, pts, width, color, lw) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = width + lw * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function circle(ctx, x, y, r, color, lw) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  if (lw > 0) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

// 茎の途中から出る、小さな葉
function sideLeaf(ctx, q, len, side, width, color, lw, curl = 0.5) {
  const leaf = curve(q.x, q.y, len, q.a + side * 1.1, side * curl, 5);
  fillOutlined(ctx, leafPath(leaf, (f) => width * Math.sin(Math.PI * Math.min(1, f + 0.1))), color, lw);
}

// ---- 種類ごとの形 ----

// 芽(どの種類も同じ形で、色だけ種類ごと)
function drawSprout(ctx, b, p, colors, lean, lw) {
  const s = curve(b.x, b.y, b.h * 0.7, lean * 0.4, lean * 0.4, 4);
  stem(ctx, s, b.U * 0.02, colors[1], lw * 0.7);
  const top = s[s.length - 1];
  for (const side of [-1, 1]) {
    const leaf = curve(top.x, top.y, b.w * 0.55, side * 1.1 + lean * 0.5, side * 0.5, 4);
    fillOutlined(ctx, leafPath(leaf, (f) => b.w * 0.32 * Math.sin(Math.PI * Math.min(1, f * 0.9 + 0.1))), colors[0], lw * 0.8);
  }
  // 勝手に生えたもの(珍しい種類)は、芽の真ん中に小さな玉
  if (!PLANTS[p.kind].plantable) circle(ctx, top.x, top.y - b.U * 0.012, b.U * 0.018, colors[0], lw * 0.6);
}

// トゲの三角(葉の外側へ)
function thorn(ctx, q, dir, size, color, lw) {
  const nx = Math.cos(q.a) * dir;
  const ny = Math.sin(q.a) * dir;
  const tx = Math.sin(q.a);
  const ty = -Math.cos(q.a);
  ctx.beginPath();
  ctx.moveTo(q.x + nx * size * 0.3 - tx * size * 0.3, q.y + ny * size * 0.3 - ty * size * 0.3);
  ctx.lineTo(q.x + nx * size * 1.3 + tx * size * 0.4, q.y + ny * size * 1.3 + ty * size * 0.4);
  ctx.lineTo(q.x + nx * size * 0.3 + tx * size * 0.3, q.y + ny * size * 0.3 + ty * size * 0.3);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
}

// トゲ草:先のとがった葉が扇のように広がり、ところどころに小さなトゲ。
// とても大きくなると、後ろにもう1重の扇が広がり、トゲも増える
function drawToge(ctx, b, p, colors, sway, lw) {
  const back = 8;
  for (let j = 0; j < back; j++) {
    const f = extra(b.rich, j, back);
    if (f <= 0) continue;
    const side = (j + 0.5) / back - 0.5;
    const len = b.h * (0.75 + 0.25 * Math.cos(side * 2)) * (0.9 + 0.2 * hash(p.seed, 150 + j)) * f;
    const pts = curve(b.x + side * b.w * 0.2, b.y, len, side * 2.1 + sway(j + 9) * 0.4, side * 0.6 + sway(j + 9), 6);
    fillOutlined(ctx, leafPath(pts, (k) => b.U * 0.06 * (1 - k) * f), colors[1], lw);
  }
  const n = 6 + Math.floor(hash(p.seed, 1) * 3);
  const thorns = b.rich > 0.4 ? [2, 3, 4, 5] : [2, 4];
  for (let i = 0; i < n; i++) {
    const side = i / (n - 1) - 0.5;
    const a0 = side * 1.7 + sway(i) * 0.4;
    const len = b.h * (0.6 + 0.4 * Math.cos(side * 1.7)) * (0.85 + 0.3 * hash(p.seed, 10 + i)) * lerp(1, 0.85, b.rich);
    const pts = curve(b.x + side * b.w * 0.15, b.y, len, a0, side * 0.5 + sway(i), 6);
    fillOutlined(ctx, leafPath(pts, (k) => b.U * 0.06 * (1 - k)), i % 2 ? colors[1] : colors[0], lw);
    for (const k of thorns) thorn(ctx, pts[k], side >= 0 ? 1 : -1, b.U * 0.035, colors[0], lw * 0.6);
  }
}

// ひらひら葉:幅の広い葉の縁が、ゆっくり波打つ。とても大きくなると、後ろに色違いの葉が重なる
function drawHira(ctx, b, p, colors, sway, lw, t) {
  const ruffle = 0.28 + 0.14 * b.rich;
  const leaf = (pts, fill, vein, ph, width) => {
    const path = leafPath(pts, (f) => width * Math.sin(Math.PI * Math.min(1, f * 0.95 + 0.05)) * (1 + ruffle * Math.sin(f * 16 + ph)));
    fillOutlined(ctx, path, fill, lw);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length - 1; k++) ctx.lineTo(pts[k].x, pts[k].y);
    ctx.strokeStyle = vein;
    ctx.lineWidth = lw * 0.8;
    ctx.lineCap = 'round';
    ctx.stroke();
  };
  const back = 4;
  for (let j = 0; j < back; j++) {
    const f = extra(b.rich, j, back);
    if (f <= 0) continue;
    const side = (j + 0.5) / back - 0.5;
    const pts = curve(b.x, b.y, b.h * (0.85 + 0.15 * hash(p.seed, 25 + j)) * f, side * 1.9 + sway(j + 5) * 0.5, side * 1.1 + sway(j + 5) * 1.2, 9);
    leaf(pts, colors[1], colors[0], t * 2 + j * 2.3, b.U * 0.14 * f);
  }
  const n = 4;
  for (let i = 0; i < n; i++) {
    const side = i / (n - 1) - 0.5;
    const len = b.h * (0.75 + 0.25 * hash(p.seed, 20 + i)) * lerp(1, 0.8, b.rich);
    const pts = curve(b.x, b.y, len, side * 1.5 + sway(i) * 0.5, side * 0.9 + sway(i) * 1.2, 9);
    leaf(pts, colors[0], colors[1], t * 2 + i * 1.7, b.U * 0.14);
  }
}

// のびる藻:細長い葉の束。先へ行くほど大きくなびく。とても大きくなると束が増え、丸い浮き袋がつく
function drawNobi(ctx, b, p, colors, sway, lw) {
  const strands = [];
  const n = 5;
  const more = 5;
  for (let j = 0; j < more; j++) {
    const f = extra(b.rich, j, more);
    if (f > 0) strands.push({ side: (j + 0.5) / more - 0.5, len: b.h * (0.55 + 0.45 * hash(p.seed, 35 + j)) * f, color: j % 2 ? colors[0] : colors[1], i: j + 11, f });
  }
  for (let i = 0; i < n; i++) {
    strands.push({ side: i / (n - 1) - 0.5, len: b.h * (0.65 + 0.35 * hash(p.seed, 30 + i)), color: i % 2 ? colors[1] : colors[0], i, f: 1 });
  }
  const bladder = clamp((b.rich - 0.3) / 0.4);
  for (const s of strands) {
    const pts = curve(b.x + s.side * b.w * 0.4, b.y, s.len, s.side * 0.35 + sway(s.i) * 0.3, sway(s.i) * 2.2 + s.side * 0.3, 10);
    fillOutlined(ctx, leafPath(pts, (f) => b.U * 0.045 * (1 - f * 0.6) * s.f), s.color, lw);
    if (bladder > 0 && s.f >= 1) {
      for (const k of [4, 7]) {
        const q = pts[k];
        const dir = hash(p.seed, 60 + s.i + k) < 0.5 ? -1 : 1;
        const r = b.U * 0.024 * bladder;
        circle(ctx, q.x + Math.cos(q.a) * dir * r * 1.3, q.y + Math.sin(q.a) * dir * r * 1.3, r, '#e4ff8a', lw * 0.7);
      }
    }
  }
}

// まるい苔:もこもこの苔玉がいくつか寄り集まる。とても大きくなると積み重なって小山になり、上に小さな芽が出る
function drawMaru(ctx, b, p, colors, sway, lw) {
  const balls = [];
  const n = 4 + Math.floor(hash(p.seed, 2) * 3);
  for (let i = 0; i < n; i++) {
    const r = b.w * lerp(0.12, 0.24, hash(p.seed, 40 + i)) * lerp(1, 0.7, b.rich);
    const x = b.x + (hash(p.seed, 50 + i) - 0.5) * b.w * 0.8;
    const lift = i < 3 ? 0 : r * 0.9 * (1 - b.rich * 0.6);
    balls.push({ x, y: b.y - r * 0.8 - lift, r });
  }
  // 増える苔玉:下の段ほど横に広く、上へ行くほど狭く積み重なって、小山になる(3段 + てっぺん)
  const rows = [4, 3, 2, 1];
  const rowH = (b.h * 0.78) / rows.length;
  let j = 0;
  const total = rows.reduce((sum, v) => sum + v, 0);
  rows.forEach((count, layer) => {
    const spread = b.w * (0.8 - layer * 0.2);
    for (let k = 0; k < count; k++, j++) {
      const f = extra(b.rich, j, total);
      if (f <= 0) continue;
      const r = b.w * lerp(0.12, 0.17, hash(p.seed, 140 + j)) * lerp(1, 0.8, layer / 3) * f;
      const u = count === 1 ? 0 : k / (count - 1) - 0.5;
      const x = b.x + u * spread + (hash(p.seed, 130 + j) - 0.5) * b.w * 0.08;
      balls.push({ x, y: b.y - r * 0.8 - (layer + 0.6) * rowH * f, r });
    }
  });
  balls.sort((a, c) => c.y - a.y);
  const squish = 1 + sway(0) * 0.12;
  for (const ball of balls) {
    const rx = ball.r * squish;
    const ry = ball.r / squish;
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y, rx, ry, 0, 0, TAU);
    ctx.fillStyle = colors[1];
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ball.x - rx * 0.15, ball.y - ry * 0.15, rx * 0.8, ry * 0.8, 0, 0, TAU);
    ctx.fillStyle = colors[0];
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y, rx, ry, 0, 0, TAU);
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.fillStyle = 'rgba(230, 255, 190, 0.7)';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(ball.x + (hash(p.seed, 60 + k) - 0.6) * rx, ball.y + (hash(p.seed, 70 + k) - 0.7) * ry, Math.max(0.6, ball.r * 0.1), 0, TAU);
      ctx.fill();
    }
  }
  // 小山のてっぺんの、小さな芽
  const sprout = clamp((b.rich - 0.6) / 0.4);
  if (sprout > 0) {
    const top = balls.slice(-3);
    for (let i = 0; i < top.length; i++) {
      const ball = top[i];
      const s = curve(ball.x, ball.y - ball.r * 0.85, b.U * 0.07 * sprout, sway(i + 3) * 0.6, sway(i + 3), 3);
      stem(ctx, s, b.U * 0.012, colors[1], lw * 0.5);
      const tip = s[s.length - 1];
      for (const side of [-1, 1]) {
        const leaf = curve(tip.x, tip.y, b.U * 0.045 * sprout, side * 1.1, side * 0.4, 3);
        fillOutlined(ctx, leafPath(leaf, (f) => b.U * 0.03 * sprout * Math.sin(Math.PI * Math.min(1, f + 0.1))), '#b8ff6a', lw * 0.5);
      }
    }
  }
}

// ラッパの形の花(open でなければ、つぼみ)
function trumpet(ctx, top, b, p, colors, lw, t, open, size = 1) {
  const a = top.a + 0.25;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const nx = Math.cos(a);
  const ny = Math.sin(a);
  const U = b.U * size;
  if (!open) {
    ctx.beginPath();
    ctx.ellipse(top.x + dx * U * 0.04, top.y + dy * U * 0.04, U * 0.035, U * 0.06, a, 0, TAU);
    ctx.fillStyle = colors[0];
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.stroke();
    return;
  }
  const L = U * 0.2;
  const mouth = U * 0.09 * (1 + 0.06 * Math.sin(t * 1.3 + p.seed + size * 7));
  const mx = top.x + dx * L;
  const my = top.y + dy * L;
  const path = new Path2D();
  path.moveTo(top.x - nx * U * 0.015, top.y - ny * U * 0.015);
  path.quadraticCurveTo(top.x + dx * L * 0.7 - nx * U * 0.02, top.y + dy * L * 0.7 - ny * U * 0.02, mx - nx * mouth, my - ny * mouth);
  path.lineTo(mx + nx * mouth, my + ny * mouth);
  path.quadraticCurveTo(top.x + dx * L * 0.7 + nx * U * 0.02, top.y + dy * L * 0.7 + ny * U * 0.02, top.x + nx * U * 0.015, top.y + ny * U * 0.015);
  path.closePath();
  fillOutlined(ctx, path, colors[0], lw);
  // 口(奥の暗い色)と、しべ
  ctx.beginPath();
  ctx.ellipse(mx, my, mouth, mouth * 0.35, a + Math.PI / 2, 0, TAU);
  ctx.fillStyle = '#8a0a30';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
  for (let i = -1; i <= 1; i++) circle(ctx, mx + dx * U * 0.03 + nx * i * mouth * 0.4, my + dy * U * 0.03 + ny * i * mouth * 0.4, U * 0.014, '#ffe066', lw * 0.5);
}

// 赤い花草:くるりと巻いた葉と、ラッパの形の花。とても大きくなると枝分かれして、花が3つになる
function drawRedFlower(ctx, b, p, colors, sway, lw, t, open) {
  const s = curve(b.x, b.y, b.h * 0.8, sway(0) * 0.3, 0.35 + sway(0) * 0.8, 8);
  const curled = (q, side, len, f = 1) => {
    const leaf = curve(q.x, q.y, len * f, q.a + side * 1.2, side * 2.6, 8);
    fillOutlined(ctx, leafPath(leaf, (k) => b.U * 0.07 * f * Math.sin(Math.PI * Math.min(1, k + 0.08)) * (1 - k * 0.4)), colors[1], lw);
  };
  // 枝(とても大きくなるにつれて伸びる)
  const branches = [];
  for (const [j, k, side] of [
    [0, 3, -1],
    [1, 5, 1],
  ]) {
    const f = extra(b.rich, j, 2);
    if (f <= 0) continue;
    const q = s[k];
    branches.push({ pts: curve(q.x, q.y, b.h * 0.42 * f, q.a + side * 0.7, -side * 0.5 + sway(j + 4) * 0.6, 6), f });
  }
  for (const br of branches) stem(ctx, br.pts, b.U * 0.02, colors[1], lw * 0.8);
  // 巻いた葉(とても大きくなると、もう2枚)
  curled(s[2], -1, b.h * 0.3);
  curled(s[4], 1, b.h * 0.3);
  const leaves2 = extra(b.rich, 0, 1);
  if (leaves2 > 0) {
    curled(s[1], 1, b.h * 0.26, leaves2);
    curled(s[6], -1, b.h * 0.22, leaves2);
  }
  stem(ctx, s, b.U * 0.025, colors[1], lw * 0.8);
  for (const br of branches) trumpet(ctx, br.pts[br.pts.length - 1], b, p, colors, lw, t, open && br.f > 0.6, 0.8 * Math.max(0.5, br.f));
  trumpet(ctx, s[s.length - 1], b, p, colors, lw, t, open);
}

function star(ctx, x, y, r, rot, color, lw) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = rot + (i / 10) * TAU;
    const px = x + Math.sin(a) * rr;
    const py = y - Math.cos(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
}

// 青い花草:枝分かれした先に、星の形の花が房になる。とても大きくなると、茎の途中からも枝が出て花が増える
function drawBlueFlower(ctx, b, p, colors, sway, lw, t, open) {
  const main = curve(b.x, b.y, b.h * 0.6, sway(0) * 0.3, sway(0) * 0.7, 6);
  const top = main[main.length - 1];
  const tips = [];
  for (let i = 0; i < 3; i++) {
    const side = i - 1;
    const br = curve(top.x, top.y, b.h * (0.25 + 0.1 * hash(p.seed, 80 + i)), top.a + side * 0.8, side * 0.3 + sway(i + 1) * 0.6, 4);
    stem(ctx, br, b.U * 0.016, colors[1], lw * 0.7);
    tips.push({ q: br[br.length - 1], f: 1, i });
  }
  // 増える枝(茎の途中の左右と、てっぺん)
  const more = [
    [3, -1, 0.3],
    [4, 1, 0.32],
    [2, 1, 0.28],
    [5, -1, 0.26],
  ];
  for (let j = 0; j < more.length; j++) {
    const f = extra(b.rich, j, more.length);
    if (f <= 0) continue;
    const [k, side, len] = more[j];
    const q = main[k];
    const br = curve(q.x, q.y, b.h * len * f, q.a + side * 1.0, -side * 0.4 + sway(j + 6) * 0.6, 4);
    stem(ctx, br, b.U * 0.014, colors[1], lw * 0.7);
    tips.push({ q: br[br.length - 1], f, i: j + 3 });
  }
  stem(ctx, main, b.U * 0.022, colors[1], lw * 0.8);
  // 茎の途中の小さな葉
  sideLeaf(ctx, main[2], b.h * 0.18, 1, b.U * 0.05, colors[1], lw * 0.8, 0.4);
  if (b.rich > 0.2) sideLeaf(ctx, main[1], b.h * 0.16, -1, b.U * 0.05, colors[1], lw * 0.8, 0.4);
  for (const { q, f, i } of tips) {
    if (!open || f < 0.6) {
      circle(ctx, q.x, q.y, b.U * 0.025 * Math.max(0.5, f), colors[0], lw * 0.8);
      continue;
    }
    const r = b.U * (0.055 + 0.015 * hash(p.seed, 90 + i)) * f;
    star(ctx, q.x, q.y, r, t * 0.15 + i, colors[0], lw * 0.8);
    circle(ctx, q.x, q.y, r * 0.28, '#f4f8ff', lw * 0.5);
  }
}

// ぽんぽんの花
function pompom(ctx, top, b, p, colors, lw, t, open, size = 1, n0 = 0) {
  if (!open) {
    circle(ctx, top.x, top.y - b.U * 0.02 * size, b.U * 0.04 * size, colors[0], lw);
    return;
  }
  const R = b.U * 0.085 * size * (1 + 0.04 * Math.sin(t * 1.1 + p.seed + n0));
  const cx = top.x;
  const cy = top.y - R * 0.8;
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + t * 0.1 + n0;
    circle(ctx, cx + Math.cos(a) * R * 0.85, cy + Math.sin(a) * R * 0.85, R * 0.38, colors[0], lw * 0.8);
  }
  circle(ctx, cx, cy, R * 0.75, '#ffe98a', lw);
  ctx.fillStyle = '#d19a10';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(cx + (hash(p.seed, 110 + i + n0) - 0.5) * R * 0.9, cy + (hash(p.seed, 120 + i + n0) - 0.5) * R * 0.9, R * 0.1, 0, TAU);
    ctx.fill();
  }
}

// 黄色い花草:ぽんぽんのような丸い花。とても大きくなると、高さの違う花が3つになる
function drawYellowFlower(ctx, b, p, colors, sway, lw, t, open) {
  const flower = (s, size, n0) => {
    for (const [k, side] of [
      [2, 1],
      [3, -1],
    ]) {
      sideLeaf(ctx, s[k], b.h * 0.24 * size, side, b.U * 0.06 * size, colors[1], lw * 0.8, 0.6);
    }
    stem(ctx, s, b.U * 0.022 * Math.max(0.6, size), colors[1], lw * 0.8);
    pompom(ctx, s[s.length - 1], b, p, colors, lw, t, open && size > 0.5, size, n0);
  };
  // 増える花(後ろに、左右へ傾いて)
  for (const [j, side, h] of [
    [0, -1, 0.72],
    [1, 1, 0.55],
  ]) {
    const f = extra(b.rich, j, 2);
    if (f <= 0) continue;
    const s = curve(b.x + side * b.w * 0.12, b.y, b.h * h * f, side * 0.35 + sway(j + 2) * 0.3, side * 0.2 + sway(j + 2) * 0.9, 8);
    flower(s, 0.8 * f, 3 + j * 5);
  }
  flower(curve(b.x, b.y, b.h * 0.78, sway(0) * 0.3, sway(0) * 0.9 - 0.15, 8), 1, 0);
}

// 光るキノコ:透けたかさが、ふわっと光る(光は放射グラデーション。shadowBlur は使わない)。
// とても大きくなると、まわりに小さなキノコが増えて、光も広がる
function drawGlowCap(ctx, b, p, colors, sway, lw, t, open) {
  const caps = [];
  const mush = (x, h, r, a0, i) => {
    const s = curve(x, b.y, h * 0.75, a0 + sway(i) * 0.15, sway(i) * 0.35, 4);
    stem(ctx, s, b.U * 0.03 * Math.max(0.5, r / (b.w * 0.3)), colors[1], lw * 0.8);
    const top = s[s.length - 1];
    caps.push({ x: top.x, y: top.y, a: top.a, r });
  };
  // 増える小さなキノコ(後ろと左右)
  const more = [
    [-0.45, 0.4, 0.16],
    [0.5, 0.34, 0.14],
    [-0.15, 0.55, 0.13],
  ];
  for (let j = 0; j < more.length; j++) {
    const f = extra(b.rich, j, more.length);
    if (f <= 0) continue;
    const [dx, h, r] = more[j];
    mush(b.x + dx * b.w, b.h * h * f, b.w * r * f, dx * 0.4, j + 5);
  }
  for (let i = 0; i < 3; i++) {
    const side = i - 1;
    mush(b.x + side * b.w * 0.28, b.h * [0.65, 1, 0.5][i], b.w * [0.28, 0.36, 0.24][i] * (open ? 1 : 0.6), side * 0.25, i);
  }
  const pulse = 0.75 + 0.25 * Math.sin(t * 1.2 + (p.seed % 50));
  for (const c of caps) {
    // かさ(半円)
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a * 0.6);
    const cap = new Path2D();
    cap.moveTo(-c.r, 0);
    cap.bezierCurveTo(-c.r, -c.r * 1.1, c.r, -c.r * 1.1, c.r, 0);
    cap.quadraticCurveTo(0, c.r * 0.25, -c.r, 0);
    cap.closePath();
    ctx.globalAlpha *= 0.8;
    ctx.fillStyle = colors[0];
    ctx.fill(cap);
    ctx.globalAlpha /= 0.8;
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.stroke(cap);
    ctx.fillStyle = 'rgba(250, 255, 230, 0.85)';
    for (const [sx, sy, sr] of [
      [-0.4, -0.45, 0.13],
      [0.15, -0.65, 0.1],
      [0.45, -0.3, 0.08],
    ]) {
      ctx.beginPath();
      ctx.arc(sx * c.r, sy * c.r, sr * c.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  // ぼんやりした光(重ねるほど明るく)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const spread = 2.6 + b.rich * 0.8;
  for (const c of caps) {
    const R = c.r * spread;
    const g = ctx.createRadialGradient(c.x, c.y - c.r * 0.4, 0, c.x, c.y - c.r * 0.4, R);
    g.addColorStop(0, `rgba(198, 255, 61, ${0.4 * pulse})`);
    g.addColorStop(1, 'rgba(198, 255, 61, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(c.x - R, c.y - c.r * 0.4 - R, R * 2, R * 2);
  }
  ctx.restore();
}

const DRAW = {
  toge: drawToge,
  hira: drawHira,
  nobi: drawNobi,
  maru: drawMaru,
  redFlower: drawRedFlower,
  blueFlower: drawBlueFlower,
  yellowFlower: drawYellowFlower,
  glowCap: drawGlowCap,
};

/**
 * 植物を1本描く。
 * @param geo      renderer(project・creatureSize・H を使う)
 * @param current  水流 { strength, dir }
 * @param selected 編集モードで選んでいるとき true(足もとに点線の輪)
 */
export function drawPlant(ctx, geo, p, t, current, selected = false) {
  const def = PLANTS[p.kind];
  if (!def) return;
  const b = plantBox(geo, p);
  const lw = Math.max(1.2, b.lwU * 0.022 * (1 + b.rich * 0.3));
  const lean = (current?.dir ?? 1) * clamp(current?.strength ?? 0) * CURRENT_LOOK.LEAF_LEAN;
  // 葉ごとのゆれ(ふだんのゆれ + 水流でなびく)。流れが強いと、ゆれも少し速く大きくなる
  const speed = 1 + (current?.strength ?? 0) * 1.5;
  const sway = (i) => wave((t * speed) / 6 + i * 0.37, (p.seed % 97) + i) * (0.08 + 0.1 * (current?.strength ?? 0)) + lean;

  // 底に落ちる影
  ctx.fillStyle = 'rgba(11, 4, 24, 0.4)';
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, Math.max(b.w * 0.55, b.lwU * 0.05), Math.max(b.w * 0.14, b.lwU * 0.015), 0, 0, TAU);
  ctx.fill();

  if (selected) {
    ctx.save();
    ctx.setLineDash([b.lwU * 0.03, b.lwU * 0.025]);
    ctx.lineDashOffset = -t * b.lwU * 0.05;
    ctx.strokeStyle = 'rgba(244, 236, 255, 0.9)';
    ctx.lineWidth = Math.max(1.5, b.lwU * 0.012);
    ctx.beginPath();
    const rx = Math.max(b.w * 0.7, b.lwU * 0.1);
    ctx.ellipse(b.x, b.y, rx, rx * 0.3, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  const stage = plantStage(p.growth);
  if (stage === 'sprout') drawSprout(ctx, b, p, def.colors, lean + sway(0) * 0.5, lw);
  else DRAW[p.kind](ctx, b, p, def.colors, sway, lw, t, stage !== 'small');
  ctx.restore();
}
