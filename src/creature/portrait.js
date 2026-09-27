// 生き物の静止画(標本・選択画面・棚で使う)。
// 水槽と同じ drawCreature で、まっすぐな姿勢・時間を止めた姿を1枚描いて、画像(data URL)にする。
//
// iPhone はキャンバスに使えるメモリに上限があるので、下書きは共有の2枚だけを使い、
// 描き終わって少し経ったら大きさを 0 にして返す。同じ姿は覚えておいて描き直さない。
import { Creature } from './creature.js';
import { drawCreature } from './drawCreature.js';
import { SEGMENTS } from './body.js';

const PX = 2; // 画像の解像度(CSS の 1px あたり)
const RELEASE_AFTER = 800; // 描き終わってから、下書きを返すまで(ms)
const CACHE_LIMIT = 80;

const cache = new Map();
let canvas = null;
let scratch = null;
let releaseTimer = null;

function release() {
  for (const c of [canvas, scratch]) {
    if (!c) continue;
    c.width = 0;
    c.height = 0;
  }
  canvas = null;
  scratch = null;
}

// data: { seed, genes, pattern, traits, growth, look }(look は図鑑に残した瞬間の、揺らぎを含めた見た目。生き物の保存データや、親・標本の写し。特徴遺伝子の無い古いデータは genes と seed から)
// w, h: 画像の大きさ(CSS px)。描けないときは null
export function portrait(data, w = 240, h = 160) {
  if (!data?.genes) return null;
  const key = JSON.stringify([w, h, data.seed, data.genes, data.pattern ?? null, data.traits ?? null, data.growth ?? 1, data.look ?? null]);
  if (cache.has(key)) return cache.get(key);

  const c = new Creature({ id: 'portrait', seed: Number(data.seed) >>> 0, genes: data.genes, pattern: data.pattern, traits: data.traits, growth: data.growth ?? 1, heading: 0 });
  // 揺らぎなしの、その瞬間の姿。図鑑の瞬間は、残したときの揺らぎを含めた見た目
  c.expressed = data.look && typeof data.look === 'object' ? { ...c.genes, ...data.look } : { ...c.genes };
  c.phase = 0.35;
  c.behavior.waveAmp = 0.03;

  const pw = Math.round(w * PX);
  const ph = Math.round(h * PX);
  canvas ??= document.createElement('canvas');
  scratch ??= document.createElement('canvas');
  for (const cv of [canvas, scratch]) {
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    release();
    return null;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(PX, 0, 0, PX, 0, 0);

  // 大人の体の長さが、画像の幅の約 2/3 になるように(しっぽの糸などがはみ出さない程度)。
  // 赤ちゃんは小さく描くが、小さくなりすぎて見えなくならないよう、縮め方はゆるめる
  const L = Math.min(w * 0.68, h * 1.05);
  const len = L * Math.sqrt(c.size);
  const floor = h * 0.74;
  const x0 = w / 2 - len / 2;
  const pts = [];
  for (let i = 0; i < SEGMENTS; i++) pts.push({ x: x0 + (i / (SEGMENTS - 1)) * len, y: floor, s: 1 });
  drawCreature(ctx, scratch, c, pts, len, 0, PX, 0.6);

  const url = canvas.toDataURL('image/png');
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(release, RELEASE_AFTER);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, url);
  return url;
}

// 描けなかったときの代わりの色(体の色)
export function portraitColor(data) {
  const hue = Math.round((data?.genes?.hue ?? 0.8) * 360);
  return `hsl(${hue}, 90%, 60%)`;
}
