// 水槽の描画。奥行きのある2D(奥ほど小さく・ぼかし・水の色に沈む)。横画面が基準。
//
// 描画は layers の順に重ねる。後のフェーズで置物などを足すときは、ここにレイヤーを追加する(insertLayer)。
// 植物と生き物は、奥にあるものから順に混ぜて描く(植物の後ろを生き物が通れるように)。
// 環境(土・光)が変わったら envChanged() を呼ぶ。背景は次のフレームで1回だけ描き直す。
//
// 観察モードでは、カメラ(camera)が1匹に寄って追いかける。
// 水槽の中のものは「水槽の座標」(カメラで拡大される)で描き、
// ガラスの藻とビネットは screen: true のレイヤーとして画面そのままで描く。
import { drawCreature } from '../creature/drawCreature.js';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { wave } from '../util/noise.js';
import { drawSoilLive, lightLook, renderScenery, renderVignette } from './scenery.js';
import { drawPlant, plantBox } from './drawPlants.js';
import { Bubbles, Particles, Ripples, Sparkles } from './effects.js';
import { ENV_CHANGE, PLANT_FADE } from './envConfig.js';
import { AlgaeView } from './algae.js';
import { Farewells } from './farewell.js';
import { MEET } from '../creature/lifeConfig.js';

const TAU = Math.PI * 2;
const MAX_DPR = 2;
const HIT_PAD = 16;
export const OBSERVE_ZOOM = 2.2; // 観察モードの拡大率
const CAMERA_SPEED = 2.5; // カメラが寄ったり戻ったりする速さ
// 生き物の下書きの解像度の上限。iPhone はキャンバスに使えるメモリに上限があり、
// 超えると新しいキャンバスが使えなくなる(タブを閉じるまで戻らない)ので、控えめにする
const MAX_CREATURE_PX = 3;
// 植物を透かすときの下書き(全部の植物で1枚を使い回す)の画素数の上限。約 2MB
const PLANT_CANVAS_PIXELS = 520000;
const PLANT_CANVAS_IDLE = 10; // これだけ透かさなかったら、下書きのメモリを返す(秒)

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

// 使わなくなったキャンバスのメモリを返す(iPhone では大きさを 0 にしないと、すぐには返らない)
function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
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
    this.sparkles = new Sparkles();
    this.algaeView = new AlgaeView();
    this.time = 0;
    this.running = false;
    this.last = 0;
    this.camera = { x: 0, y: 0, zoom: 1 }; // 見ている中心(水槽の座標)と拡大率
    this.focus = null; // 観察中の生き物
    this.onFrame = null; // 毎フレーム呼ぶ(ボタンの表示の更新など)
    this.onError = null; // 描画中にエラーが起きたとき(描画は止めずに続ける)
    this.onTankEvent = null; // 水槽で起きたことを、画面の側にも知らせる(5匹になったときなど)
    this.farewells = new Farewells(); // 水槽を離れる子の演出
    this.shrinkWhenBack = false; // 観察モードから戻りきったら、大きくした下書きを返す
    this.bgDirty = false; // 環境が変わって、背景の描き直しが必要
    this.selectedPlant = null; // 編集モードで選んでいる植物
    this.plantFade = new WeakMap(); // 植物ごとの透け具合(1 = ふだん)。保存しない
    this.plantCanvas = null; // 植物を透かすときの下書き
    this.plantCanvasIdle = 0;

    this.layers = [
      { name: 'background', draw: () => this.ctx.drawImage(this.bg, 0, 0, this.W, this.H) },
      { name: 'soil', draw: () => this.tank && drawSoilLive(this.ctx, this, this.tank.env, this.tank.nutrients, this.tank.seed, this.time) },
      { name: 'particlesBack', draw: () => this.particles.draw(this.ctx, this, this.time, true) },
      { name: 'droppings', draw: () => this.tank?.food.drawDroppings(this.ctx, this) },
      { name: 'pellets', draw: () => this.tank?.food.drawPellets(this.ctx, this, this.time) },
      { name: 'creatures', draw: (dt) => this.drawDepth(dt) },
      { name: 'sparkles', draw: () => this.sparkles.draw(this.ctx) },
      { name: 'droppingsEmerging', draw: () => this.tank?.food.drawDroppings(this.ctx, this, true) },
      { name: 'bubbles', draw: () => this.bubbles.draw(this.ctx) },
      { name: 'light', draw: () => this.drawLight() },
      { name: 'particlesFront', draw: () => this.particles.draw(this.ctx, this, this.time, false) },
      { name: 'ripples', draw: () => this.ripples.draw(this.ctx) },
      { name: 'algae', screen: true, draw: () => this.algaeView.draw(this.ctx, this.tank?.algae, this.W, this.H) },
      { name: 'vignette', screen: true, draw: () => this.ctx.drawImage(this.vignette, 0, 0, this.W, this.H) },
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
    for (const c of this.farewells.clear()) this.releaseOneCreature(c);
    if (this.tank && this.tank !== tank) this.releaseCreatureCanvases();
    this.tank = tank;
    this.focus = null;
    this.camera = { x: this.W / 2, y: this.H / 2, zoom: 1 };
    this.selectedPlant = null;
    this.bubbles.clear();
    this.sparkles.clear();
    this.renderBackground();
  }

  // 土や光が変わった(背景は次のフレームで描き直す。スライダーを動かしている間も1フレームに1回まで)
  envChanged() {
    this.bgDirty = true;
  }

  releaseOneCreature(c) {
    releaseCanvas(c.canvas);
    releaseCanvas(c.scratch);
    c.canvas = null;
    c.scratch = null;
  }

  // 生き物の下書きキャンバスを返す(次に描くとき、今の大きさで作り直される)
  releaseCreatureCanvases() {
    for (const c of this.tank?.creatures ?? []) this.releaseOneCreature(c);
    for (const f of this.farewells.list) this.releaseOneCreature(f.c);
    releaseCanvas(this.soft);
    this.releasePlantCanvas();
  }

  releasePlantCanvas() {
    releaseCanvas(this.plantCanvas);
    this.plantCanvas = null;
  }

  // ---- カメラ ----
  setFocus(creature) {
    if (this.focus && !creature) this.shrinkWhenBack = true;
    this.focus = creature;
  }

  // 観察モードでの寄り具合(0 = ふだん〜1 = いちばん寄った)
  get detail() {
    return smoothstep((this.camera.zoom - 1) / (OBSERVE_ZOOM - 1));
  }

  updateCamera(dt) {
    const cam = this.camera;
    let tx = this.W / 2;
    let ty = this.H / 2;
    let tz = 1;
    const center = this.focus?.screen?.center;
    if (center) {
      tx = center.x;
      ty = center.y;
      tz = OBSERVE_ZOOM;
    }
    const k = 1 - Math.exp(-dt * CAMERA_SPEED);
    cam.zoom += (tz - cam.zoom) * k;
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    // 水槽の外が見えないように
    const hw = this.W / (2 * cam.zoom);
    const hh = this.H / (2 * cam.zoom);
    cam.x = clamp(cam.x, hw, this.W - hw);
    cam.y = clamp(cam.y, hh, this.H - hh);
    if (this.shrinkWhenBack && !this.focus && cam.zoom < 1.01) {
      this.shrinkWhenBack = false;
      this.releaseCreatureCanvases();
    }
  }

  // 画面上の位置 → 水槽の座標
  toWorld(sx, sy) {
    const { x, y, zoom } = this.camera;
    return { x: (sx - this.W / 2) / zoom + x, y: (sy - this.H / 2) / zoom + y };
  }

  setWorldTransform() {
    const { x, y, zoom } = this.camera;
    const s = this.dpr * zoom;
    this.ctx.setTransform(s, 0, 0, s, this.dpr * (this.W / 2 - x * zoom), this.dpr * (this.H / 2 - y * zoom));
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
    if (!this.focus) this.camera = { x: this.W / 2, y: this.H / 2, zoom: 1 };
    this.bubbles.clear();
    this.renderBackground();
    const v = this.vignette;
    v.width = this.canvas.width;
    v.height = this.canvas.height;
    const vctx = v.getContext('2d');
    if (!vctx) return;
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

  // 画面上の位置(水槽の座標)→ 底の上の位置 (x, z)。底から大きく外れているときは null
  unproject(px, py) {
    const near = this.H * 0.93;
    const far = this.floorBack + this.H * 0.06;
    const z = (near - py) / (near - far);
    if (z < -0.12 || z > 1.15) return null;
    const zz = clamp(z, 0, 1);
    const center = (this.left + this.right) / 2;
    const x = 0.5 + (px - center) / ((this.right - this.left) * lerp(0.9, 0.62, zz));
    return { x, z: zz };
  }

  // タッチ位置にある植物。手前にあるものを優先
  plantAt(x, y) {
    const list = [...(this.tank?.plants.list ?? [])].sort((a, b) => a.z - b.z);
    for (const p of list) {
      const b = plantBox(this, p);
      const hw = Math.max(b.w * 0.6, 22);
      const top = b.y - Math.max(b.h, 30);
      if (Math.abs(x - b.x) <= hw && y >= top && y <= b.y + 16) return p;
    }
    return null;
  }

  // ---- ループ ----
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      // 先に次のフレームを頼んでおく(1フレームでエラーが起きても、描画が止まったままにならないように)
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      try {
        this.frame(dt);
      } catch (err) {
        this.onError?.(err);
      }
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  frame(dt) {
    this.time += dt;
    this.tank?.update(dt, this.time);
    this.handleTankEvents();
    for (const c of this.farewells.update(dt, this)) this.releaseOneCreature(c);
    if (this.bgDirty) {
      this.bgDirty = false;
      this.renderBackground();
    }
    const current = this.tank?.env.current;
    this.particles.update(dt, current);
    this.bubbles.update(dt, this, current);
    this.ripples.update(dt);
    this.sparkles.update(dt);
    this.updateCamera(dt);
    for (const layer of this.layers) {
      if (layer.screen) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      else this.setWorldTransform();
      layer.draw(dt);
    }
    this.plantCanvasIdle += dt;
    if (this.plantCanvas && this.plantCanvasIdle > PLANT_CANVAS_IDLE) this.releasePlantCanvas();
    this.onFrame?.(dt);
  }

  // 水槽で起きたこと(食べたときなど)に合わせて、泡を出す
  handleTankEvents() {
    const events = this.tank?.events;
    if (!events?.length) return;
    for (const e of events) {
      if (e.type === 'eat') {
        const pos = this.project(e.x, e.z);
        this.bubbles.add(pos.x, pos.floorY - this.creatureSize * 0.05 * pos.scale, 4, 0.6 * pos.scale);
      } else if (e.type === 'envShift') {
        // 環境で変わる瞬間:体から光の粒が昇る(まだ描いていない生き物は、粒なし)
        const center = e.creature.screen?.center;
        if (center) {
          const { scale } = this.project(e.creature.x, e.creature.z);
          this.sparkles.add(center.x, center.y, ENV_CHANGE.SPARKS, e.creature.expressed.hue2 * 360, scale);
        }
      } else if (e.type === 'sprout' || e.type === 'egg') {
        const pos = this.project(e.x, e.z);
        this.bubbles.add(pos.x, pos.floorY - this.creatureSize * 0.04 * pos.scale, 3, 0.5 * pos.scale);
      } else if (e.type === 'meet') {
        // 触れ合った瞬間:2匹の頭の間に、小さな光と泡
        const ha = e.a.screen?.spine.at(-1);
        const hb = e.b.screen?.spine.at(-1);
        if (ha && hb) {
          const x = (ha.x + hb.x) / 2;
          const y = (ha.y - ha.top + hb.y - hb.top) / 2;
          const { scale } = this.project(e.x, e.z);
          let hue = (e.a.expressed.hue2 + e.b.expressed.hue2) / 2;
          if (Math.abs(e.a.expressed.hue2 - e.b.expressed.hue2) > 0.5) hue = (hue + 0.5) % 1; // 色相の近いほうの中間
          this.sparkles.add(x, y, MEET.SPARKS, hue * 360, scale * 0.8);
          this.bubbles.add(x, y, MEET.BUBBLES, 0.45 * scale);
        }
      } else if (e.type === 'hatch') {
        const pos = this.project(e.x, e.z);
        const y = pos.floorY - this.creatureSize * 0.05 * pos.scale;
        this.bubbles.add(pos.x, y, 5, 0.5 * pos.scale);
        this.sparkles.add(pos.x, y, 6, e.creature.genes.hue2 * 360, pos.scale * 0.8);
      }
    }
    const list = events.splice(0);
    for (const e of list) this.onTankEvent?.(e);
  }

  renderBackground() {
    const c = this.bg;
    c.width = Math.round(this.W * this.dpr);
    c.height = Math.round(this.H * this.dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return; // キャンバスが使えないときは、背景なしで続ける
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    renderScenery(ctx, this, this.tank?.seed ?? 1, this.tank?.env);
  }

  // ---- 生き物と植物 ----
  drawDepth(dt = 0) {
    if (!this.tank) return;
    // 寄っているときは、そのぶん細かく描く(拡大してもにじまないように)
    const px = Math.min(this.dpr * this.camera.zoom, MAX_CREATURE_PX);
    const detail = this.detail;
    const L = this.creatureSize;
    const middleZ = (c) => c.points.reduce((s, p) => s + p.z, 0) / c.points.length;
    const list = this.tank.creatures.map((c) => ({ c, z: middleZ(c) }));
    // 観察中は、見ている1匹にピントを合わせる(奥行きの差でぼかす)
    const focusZ = list.find((e) => e.c === this.focus)?.z ?? null;
    for (const f of this.farewells.list) list.push({ c: f.c, z: middleZ(f.c), farewell: f });
    for (const p of this.tank.plants.list) list.push({ plant: p, z: p.z });
    for (const e of this.tank.eggs.list) list.push({ egg: e, z: e.z });
    list.sort((a, b) => b.z - a.z); // 奥から描く

    const current = this.tank.env.current;
    const k = Math.min(1, dt * PLANT_FADE.SPEED);
    for (const item of list) {
      if (item.egg) {
        this.tank.eggs.draw(this.ctx, this, item.egg, this.time);
        continue;
      }
      if (item.farewell) {
        const a = this.farewells.alpha(item.farewell);
        if (a > 0.01) {
          this.ctx.globalAlpha = a;
          this.drawOneCreature(item.c, item.z, focusZ, px, detail, L);
          this.ctx.globalAlpha = 1;
        }
        this.farewells.drawOver(this.ctx, item.farewell, this.time);
        continue;
      }
      if (!item.plant) {
        this.drawOneCreature(item.c, item.z, focusZ, px, detail, L);
        continue;
      }
      // 奥にいる生き物と画面の上で重なっていたら、植物をゆっくり透かす
      const p = item.plant;
      const target = this.creatureBehind(p, list) ? PLANT_FADE.ALPHA : 1;
      const fade = (this.plantFade.get(p) ?? 1) + (target - (this.plantFade.get(p) ?? 1)) * k;
      this.plantFade.set(p, fade);
      const selected = p === this.selectedPlant;
      if (fade > 0.98) drawPlant(this.ctx, this, p, this.time, current, selected);
      else this.drawPlantFaded(p, fade, current, selected, px);
    }
  }

  // 植物の奥に、画面の上で重なっている生き物がいるか(前のフレームで描いた体の形で調べる)
  creatureBehind(plant, list) {
    const b = plantBox(this, plant);
    const x0 = b.x - b.w * 0.6;
    const x1 = b.x + b.w * 0.6;
    const y0 = b.y - b.h;
    for (const item of list) {
      if (!item.c || item.z <= plant.z) continue;
      const spine = item.c.screen?.spine;
      if (!spine) continue;
      for (const q of spine) {
        if (q.x >= x0 && q.x <= x1 && q.y + q.bot >= y0 && q.y - q.top <= b.y) return true;
      }
    }
    return false;
  }

  // 植物を透かして描く。重なった葉の線が透けて見えないように、いったん下書きに描いてから重ねる。
  // 下書きは1枚を使い回し、画素数に上限をつける(iPhone のキャンバス用メモリのため)
  drawPlantFaded(p, alpha, current, selected, px) {
    const { ctx } = this;
    const b = plantBox(this, p);
    const half = Math.max(b.w, b.h * 0.6) + b.U * 0.1; // なびいた葉がはみ出さないように広めに
    const bx = b.x - half;
    const bw = half * 2;
    const by = b.y - b.h * 1.3 - b.U * 0.1;
    const bh = b.y + b.U * 0.12 - by;
    const scale = Math.min(px, Math.sqrt(PLANT_CANVAS_PIXELS / (bw * bh)));
    const pw = Math.max(1, Math.ceil(bw * scale));
    const ph = Math.max(1, Math.ceil(bh * scale));
    this.plantCanvasIdle = 0;
    const c = (this.plantCanvas ??= document.createElement('canvas'));
    if (c.width < pw || c.height < ph) {
      const w = Math.max(c.width, pw);
      const h = Math.max(c.height, ph);
      // 使い回しで大きくなりすぎるときは、今の大きさちょうどに作り直す
      const fit = w * h > PLANT_CANVAS_PIXELS * 1.2;
      c.width = fit ? pw : w;
      c.height = fit ? ph : h;
    }
    const octx = c.getContext('2d');
    if (!octx) {
      // 下書きが使えないときは、そのまま薄く描く
      ctx.globalAlpha = alpha;
      drawPlant(ctx, this, p, this.time, current, selected);
      ctx.globalAlpha = 1;
      return;
    }
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, pw, ph);
    octx.setTransform(scale, 0, 0, scale, -bx * scale, -by * scale);
    drawPlant(octx, this, p, this.time, current, selected);
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, 0, 0, pw, ph, bx, by, bw, bh);
    ctx.globalAlpha = 1;
  }

  drawOneCreature(c, z, focusZ, px, detail, adultL) {
    const { ctx } = this;
    const L = adultL * c.size; // 赤ちゃんは小さく
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
    const pw = Math.ceil(bw * px);
    const ph = Math.ceil(bh * px);
    c.canvas ??= document.createElement('canvas');
    c.scratch ??= document.createElement('canvas');
    sizeCanvas(c.canvas, pw, ph);
    if (c.scratch.width !== c.canvas.width || c.scratch.height !== c.canvas.height) {
      c.scratch.width = c.canvas.width;
      c.scratch.height = c.canvas.height;
    }
    const octx = c.canvas.getContext('2d');
    if (!octx) return; // キャンバスが使えないときは、この1匹を描かずに続ける
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, c.canvas.width, c.canvas.height);
    octx.setTransform(px, 0, 0, px, -bx * px, -by * px);
    const spine = drawCreature(octx, c.scratch, c, pts, L, c.clock, px, detail);

    // 奥ほど水の色に少し沈める
    if (z > 0.05) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-atop';
      octx.fillStyle = `rgba(15, 50, 110, ${z * 0.22})`;
      octx.fillRect(0, 0, pw, ph);
      octx.globalCompositeOperation = 'source-over';
    }

    const blurZ = focusZ == null ? z : lerp(z, Math.abs(z - focusZ), detail);
    this.drawSoft(c.canvas, pw, ph, bx, by, bw, bh, blurZ, px);
    const mid = spine[Math.floor(spine.length / 2)];
    c.screen = { spine, spikeReach: L * 0.2 * c.expressed.spikeLength, center: { x: mid.x, y: mid.y - mid.top * 0.5 } };
  }

  // 奥にあるものほどぼかして描く。px は下書きの解像度(ぼかしの幅は画素で指定するため)
  drawSoft(img, sw, sh, x, y, w, h, z, px = this.dpr) {
    const { ctx } = this;
    const blur = z * 1.2 * px;
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
      if (!sctx) {
        ctx.drawImage(img, 0, 0, sw, sh, x, y, w, h);
        return;
      }
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

  // (x, y) にいる生き物。いなければ、体の中心がいちばん近い生き物
  creatureNear(x, y) {
    const hit = this.hitTest(x, y);
    if (hit) return hit.creature;
    let best = null;
    let bestD = Infinity;
    for (const c of this.tank?.creatures ?? []) {
      const m = c.screen?.center;
      if (!m) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  // ---- 光 ----
  drawLight() {
    const { ctx, W, H, time: t } = this;
    // 光の色と明るさ(いつもの光は、今までと同じ色)
    const { light, dark, bright } = lightLook(this.tank?.env);
    const usual = light.hue == null;
    const hue = light.ray;
    const m = lerp(1, 0.3, dark) * lerp(1, 1.45, bright);
    const ray = (a) => (usual ? `hsla(165, 100%, 75%, ${a})` : `hsla(${hue}, 100%, 75%, ${a})`);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 水面から差し込む光の筋(やわらかい光 + くっきりした芯)
    for (let i = 0; i < 6; i++) {
      const a = (0.09 + 0.06 * wave(t / 9, i * 3.1)) * m;
      if (a <= 0.01) continue;
      const x0 = W * (0.04 + i * 0.18) + wave(t / 21, i) * W * 0.04;
      const w0 = W * (0.03 + 0.02 * wave(t / 13, i * 1.7));
      const x1 = x0 + W * 0.12;
      const w1 = w0 * 2.4;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, ray(a * 1.6));
      g.addColorStop(0.7, ray(a * 0.5));
      g.addColorStop(1, ray(0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0 - w0 / 2, 0);
      ctx.lineTo(x0 + w0 / 2, 0);
      ctx.lineTo(x1 + w1 / 2, H);
      ctx.lineTo(x1 - w1 / 2, H);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = usual ? `hsla(160, 100%, 85%, ${a * 0.9})` : `hsla(${hue}, 100%, 85%, ${a * 0.9})`;
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
    ctx.strokeStyle = usual ? `rgba(190, 255, 235, ${0.6 * Math.min(1, m)})` : `hsla(${hue}, 100%, 85%, ${0.6 * Math.min(1, m)})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineTo(W, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = usual ? `rgba(150, 255, 230, ${0.12 * m})` : `hsla(${hue}, 100%, 78%, ${0.12 * m})`;
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
      ctx.strokeStyle = `hsla(${usual ? 170 : hue}, 100%, 78%, ${(0.08 + 0.05 * wave(t / 7, k * 2)) * m})`;
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
