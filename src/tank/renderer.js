// 水槽の描画。奥行きのある2D(奥ほど小さく・ぼかし・水の色に沈む)。横画面が基準。
//
// 描画は layers の順に重ねる。後のフェーズで藻・エサ・置物・観察モードなどを足すときは、
// ここにレイヤーを追加する(insertLayer)。
import { drawCreature } from '../creature/drawCreature.js';
import { lerp } from '../util/math.js';
import { wave } from '../util/noise.js';
import { renderScenery, renderVignette } from './scenery.js';
import { Bubbles, Particles, Ripples } from './effects.js';

const TAU = Math.PI * 2;
const MAX_DPR = 2;
const HIT_PAD = 16;

function supportsCanvasFilter() {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!('filter' in ctx)) return false;
  ctx.filter = 'blur(2px)';
  return ctx.filter === 'blur(2px)';
}

// ノッチなどを避ける余白(CSS の env(safe-area-inset-*))を読み取る
function readSafeArea() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.append(probe);
  const s = getComputedStyle(probe);
  const area = {
    left: parseFloat(s.paddingLeft) || 0,
    right: parseFloat(s.paddingRight) || 0,
  };
  probe.remove();
  return area;
}

// 足りないときだけ大きくする(毎フレーム作り直さないように)
function sizeCanvas(canvas, w, h) {
  if (canvas.width < w || canvas.height < h) {
    canvas.width = Math.max(canvas.width, Math.ceil(w * 1.2));
    canvas.height = Math.max(canvas.height, Math.ceil(h * 1.2));
  }
}

export class TankRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tank = null;
    this.bg = document.createElement('canvas');
    this.vignette = document.createElement('canvas');
    this.soft = document.createElement('canvas'); // フィルターが使えない端末用のぼかし
    this.canFilter = supportsCanvasFilter();
    this.particles = new Particles();
    this.bubbles = new Bubbles();
    this.ripples = new Ripples();
    this.time = 0;
    this.running = false;
    this.last = 0;

    this.layers = [
      { name: 'background', draw: () => this.ctx.drawImage(this.bg, 0, 0, this.W, this.H) },
      { name: 'particlesBack', draw: () => this.particles.draw(this.ctx, this, this.time, true) },
      { name: 'creatures', draw: () => this.drawCreatures() },
      { name: 'bubbles', draw: () => this.bubbles.draw(this.ctx) },
      { name: 'light', draw: () => this.drawLight() },
      { name: 'particlesFront', draw: () => this.particles.draw(this.ctx, this, this.time, false) },
      { name: 'ripples', draw: () => this.ripples.draw(this.ctx) },
      { name: 'vignette', draw: () => this.ctx.drawImage(this.vignette, 0, 0, this.W, this.H) },
    ];

    this.resize();
    window.addEventListener('resize', () => this.resize());
    // iPhone では回転直後の大きさが正しくないことがあるので、少し待ってから測り直す
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 300));
  }

  insertLayer(layer, beforeName) {
    const i = this.layers.findIndex((l) => l.name === beforeName);
    this.layers.splice(i < 0 ? this.layers.length : i, 0, layer);
  }

  setTank(tank) {
    this.tank = tank;
    this.bubbles.clear();
    this.renderBackground();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, rect.width);
    this.H = Math.max(1, rect.height);
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    const safe = readSafeArea();
    // 生き物が動く範囲(ノッチの内側)
    this.left = safe.left + this.W * 0.02;
    this.right = this.W - safe.right - this.W * 0.02;
    this.bubbles.clear();
    this.renderBackground();
    const v = this.vignette;
    v.width = this.canvas.width;
    v.height = this.canvas.height;
    const vctx = v.getContext('2d');
    vctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    renderVignette(vctx, this.W, this.H);
  }

  // ---- 水槽の中の位置 → 画面上の位置 ----
  get surfaceY() {
    return this.H * 0.07;
  }
  get floorBack() {
    return this.H * 0.5;
  }
  // 手前にいるときの体の長さ(水槽の幅の約 1/4.5)
  get creatureSize() {
    return Math.min((this.right - this.left) * 0.216, this.H * 0.55);
  }

  // x: 0〜1(左右)、z: 0(手前)〜1(奥)、lift: 底からの高さ
  project(x, z, lift = 0) {
    const zz = Math.max(-0.2, Math.min(1.2, z));
    const scale = lerp(1, 0.6, zz);
    const floorY = lerp(this.H * 0.93, this.floorBack + this.H * 0.06, zz);
    const center = (this.left + this.right) / 2;
    return {
      x: center + (x - 0.5) * (this.right - this.left) * lerp(0.9, 0.62, zz),
      floorY,
      y: floorY - lift * this.H * 0.45 * scale,
      scale,
    };
  }

  // ---- ループ ----
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  frame(dt) {
    this.time += dt;
    this.tank?.update(dt, this.time);
    this.particles.update(dt);
    this.bubbles.update(dt, this);
    this.ripples.update(dt);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const layer of this.layers) layer.draw(dt);
  }

  renderBackground() {
    const c = this.bg;
    c.width = Math.round(this.W * this.dpr);
    c.height = Math.round(this.H * this.dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    renderScenery(ctx, this, this.tank?.seed ?? 1);
  }

  // ---- 生き物 ----
  drawCreatures() {
    if (!this.tank) return;
    const { ctx, dpr } = this;
    const L = this.creatureSize;
    const list = this.tank.creatures.map((c) => ({ c, z: c.points.reduce((s, p) => s + p.z, 0) / c.points.length }));
    list.sort((a, b) => b.z - a.z); // 奥から描く

    for (const { c, z } of list) {
      // 節を画面に写す(しっぽ → 頭)
      const pts = [];
      const shadow = new Path2D();
      const shadowK = 1 / (1 + c.lift * 2.5);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = c.points.length - 1; i >= 0; i--) {
        const w = c.points[i];
        const p = this.project(w.x, w.z, c.lift);
        pts.push({ x: p.x, y: p.y, s: p.scale });
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        // 底に落ちる影(1色)
        const r = L * p.scale * 0.13 * shadowK;
        shadow.moveTo(p.x + r, p.floorY);
        shadow.ellipse(p.x, p.floorY, r, r * 0.3, 0, 0, TAU);
      }
      ctx.fillStyle = `rgba(11,4,24,${0.5 * shadowK})`;
      ctx.fill(shadow);

      // 生き物はいったん別のキャンバスに描いてから、奥行きに合わせてぼかして重ねる
      const bx = minX - L * 0.8;
      const by = minY - L * 1.2;
      const bw = maxX - minX + L * 1.6;
      const bh = maxY - minY + L * 1.55;
      const pw = Math.ceil(bw * dpr);
      const ph = Math.ceil(bh * dpr);
      c.canvas ??= document.createElement('canvas');
      c.scratch ??= document.createElement('canvas');
      sizeCanvas(c.canvas, pw, ph);
      if (c.scratch.width !== c.canvas.width || c.scratch.height !== c.canvas.height) {
        c.scratch.width = c.canvas.width;
        c.scratch.height = c.canvas.height;
      }
      const octx = c.canvas.getContext('2d');
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, c.canvas.width, c.canvas.height);
      octx.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
      const spine = drawCreature(octx, c.scratch, c, pts, L, this.time, dpr);

      // 奥ほど水の色に少し沈める
      if (z > 0.05) {
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.globalCompositeOperation = 'source-atop';
        octx.fillStyle = `rgba(15, 50, 110, ${z * 0.22})`;
        octx.fillRect(0, 0, pw, ph);
        octx.globalCompositeOperation = 'source-over';
      }

      this.drawSoft(c.canvas, pw, ph, bx, by, bw, bh, z);
      c.screen = { spine, spikeReach: L * 0.2 * c.expressed.spikeLength };
    }
  }

  // 奥にあるものほどぼかして描く
  drawSoft(img, sw, sh, x, y, w, h, z) {
    const { ctx } = this;
    const blur = z * 1.2 * this.dpr;
    if (blur < 0.3) {
      ctx.drawImage(img, 0, 0, sw, sh, x, y, w, h);
    } else if (this.canFilter) {
      ctx.filter = `blur(${blur.toFixed(2)}px)`;
      ctx.drawImage(img, 0, 0, sw, sh, x, y, w, h);
      ctx.filter = 'none';
    } else {
      // 縮めてから引き伸ばすと、少しぼやける
      const k = 1 / (1 + z * 1.2);
      const tw = Math.max(1, Math.round(sw * k));
      const th = Math.max(1, Math.round(sh * k));
      const sc = this.soft;
      sizeCanvas(sc, tw, th);
      const sctx = sc.getContext('2d');
      sctx.clearRect(0, 0, tw, th);
      sctx.drawImage(img, 0, 0, sw, sh, 0, 0, tw, th);
      ctx.drawImage(sc, 0, 0, tw, th, x, y, w, h);
    }
  }

  // タッチ位置にいる生き物と、触れた体の場所 u(0 = しっぽ〜1 = 頭)。手前にいるものを優先
  hitTest(x, y) {
    if (!this.tank) return null;
    const list = [...this.tank.creatures].sort((a, b) => a.z - b.z);
    for (const c of list) {
      const sc = c.screen;
      if (!sc) continue;
      const spine = sc.spine;
      let best = null;
      for (let i = 0; i < spine.length; i++) {
        const p = spine[i];
        const reach = Math.max(10, p.top * 0.6);
        const dx = Math.abs(x - p.x);
        if (dx > reach + HIT_PAD) continue;
        if (y < p.y - p.top - sc.spikeReach - HIT_PAD || y > p.y + p.bot + HIT_PAD) continue;
        if (!best || dx < best.dx) best = { dx, u: i / (spine.length - 1) };
      }
      if (best) return { creature: c, u: best.u };
    }
    return null;
  }

  // ---- 光 ----
  drawLight() {
    const { ctx, W, H, time: t } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 水面から差し込む光の筋(やわらかい光 + くっきりした芯)
    for (let i = 0; i < 6; i++) {
      const a = 0.09 + 0.06 * wave(t / 9, i * 3.1);
      if (a <= 0.01) continue;
      const x0 = W * (0.04 + i * 0.18) + wave(t / 21, i) * W * 0.04;
      const w0 = W * (0.03 + 0.02 * wave(t / 13, i * 1.7));
      const x1 = x0 + W * 0.12;
      const w1 = w0 * 2.4;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsla(165, 100%, 75%, ${a * 1.6})`);
      g.addColorStop(0.7, `hsla(165, 100%, 75%, ${a * 0.5})`);
      g.addColorStop(1, 'hsla(165, 100%, 75%, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0 - w0 / 2, 0);
      ctx.lineTo(x0 + w0 / 2, 0);
      ctx.lineTo(x1 + w1 / 2, H);
      ctx.lineTo(x1 - w1 / 2, H);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `hsla(160, 100%, 85%, ${a * 0.9})`;
      ctx.beginPath();
      ctx.moveTo(x0 - w0 * 0.12, 0);
      ctx.lineTo(x0 + w0 * 0.12, 0);
      ctx.lineTo(x1 + w1 * 0.1, H * 0.85);
      ctx.lineTo(x1 - w1 * 0.1, H * 0.85);
      ctx.closePath();
      ctx.fill();
    }

    // 水面
    const sy = this.surfaceY;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * W;
      const y = sy + Math.sin(i * 0.8 + t * 0.9) * 3 + Math.sin(i * 0.33 - t * 0.6) * 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(190, 255, 235, 0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineTo(W, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(150, 255, 230, 0.12)';
    ctx.fill();

    // 底や生き物に映る光のゆらぎ
    ctx.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const y0 = lerp(this.floorBack - H * 0.04, H, k / 9);
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const x = (i / 20) * W;
        const y = y0 + Math.sin(i * 0.9 + t * 0.7 + k * 1.9) * H * 0.012 + wave(t / 11 + i * 0.07, k) * H * 0.008;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.setLineDash([W * 0.05, W * 0.035 + k * 3]);
      ctx.lineDashOffset = t * (8 + k * 2) * (k % 2 ? 1 : -1);
      ctx.strokeStyle = `hsla(170, 100%, 78%, ${0.08 + 0.05 * wave(t / 7, k * 2)})`;
      ctx.lineWidth = 2 + (k / 9) * 3;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ---- 触れた場所の波紋と泡 ----
  addRipple(x, y, strength = 1) {
    this.ripples.add(x, y, strength);
  }

  addBubbles(x, y, count) {
    this.bubbles.add(x, y, count, 0.8);
  }
}
