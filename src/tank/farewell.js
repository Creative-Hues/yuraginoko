// 水槽を離れる子の演出(描画だけ。データからはもう外してある)。
// - crystal(標本):やわらかい光に包まれ、透明な結晶が組み上がって中に収まり、きらめきながら昇って光の粒になる
// - move(別の水槽へ):泡に包まれて、ふわっと昇りながら薄れる
// 沈む・暗くなる・色が抜けるような表現は使わない。時間は lifeConfig.js の FAREWELL。
import { FAREWELL } from '../creature/lifeConfig.js';
import { clamp, lerp, smoothstep } from '../util/math.js';


// 区間 [a, b] での進み具合(0〜1)
const span = (t, a, b) => smoothstep((t - a) / (b - a));

export class Farewells {
  constructor() {
    this.list = [];
  }

  // kind: 'crystal' | 'move'
  add(creature, kind) {
    creature.leaving = true;
    creature.meet = null;
    creature.breed = null;
    this.list.push({ c: creature, kind, t: 0, lift0: creature.lift, seconds: kind === 'crystal' ? FAREWELL.CRYSTAL_SECONDS : FAREWELL.MOVE_SECONDS, fx: 0, flashed: false });
  }

  get active() {
    return this.list.length > 0;
  }

  // 進める。終わったものを返す(下書きキャンバスを返すため)
  update(dt, renderer) {
    const done = [];
    for (const f of this.list) {
      f.t += dt;
      const c = f.c;
      const center = c.screen?.center;
      if (f.kind === 'crystal') {
        c.lift = f.lift0 + span(f.t, 2.4, f.seconds) * 0.55;
        // 結晶ができあがった瞬間と、昇っていく間に、光の粒
        if (center && !f.flashed && f.t > 2.3) {
          f.flashed = true;
          renderer.sparkles.add(center.x, center.y, 8, c.expressed.hue2 * 360, 1);
        }
        f.fx += dt;
        if (center && f.t > 3 && f.fx > 0.25) {
          f.fx = 0;
          renderer.sparkles.add(center.x, center.y, 2, 190, 0.8);
        }
      } else {
        c.lift = f.lift0 + span(f.t, 0.3, f.seconds) * 0.5;
        f.fx += dt;
        if (center && f.fx > 0.18 && f.t < f.seconds - 0.4) {
          f.fx = 0;
          renderer.bubbles.add(center.x, center.y + 10, 2, 0.7);
        }
      }
      if (f.t >= f.seconds) done.push(f);
    }
    if (done.length) this.list = this.list.filter((f) => !done.includes(f));
    return done.map((f) => f.c);
  }

  // 体の濃さ(最後にふわっと薄れる)
  alpha(f) {
    if (f.kind === 'crystal') return 1 - span(f.t, f.seconds - 1.4, f.seconds);
    return 1 - span(f.t, f.seconds * 0.35, f.seconds);
  }

  // 体を描いたあとに重ねる光と結晶
  drawOver(ctx, f, t) {
    const sc = f.c.screen;
    if (!sc) return;
    const spine = sc.spine;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of spine) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y - p.top - sc.spikeReach);
      maxY = Math.max(maxY, p.y + p.bot);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const hw = (maxX - minX) / 2 + 14;
    const hh = (maxY - minY) / 2 + 12;
    const fade = this.alpha(f);
    const hue = f.c.expressed.hue2 * 360;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // やわらかい光が包む
    const glow = f.kind === 'crystal' ? span(f.t, 0, 1.2) * (1 - 0.5 * span(f.t, 2.2, 3.2)) : 0.5 * Math.sin(Math.PI * clamp(f.t / f.seconds));
    if (glow > 0.01) {
      const r = Math.max(hw, hh) * 1.5;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `hsla(${hue}, 100%, 88%, ${0.55 * glow * fade})`);
      g.addColorStop(0.6, `hsla(${hue}, 100%, 75%, ${0.2 * glow * fade})`);
      g.addColorStop(1, `hsla(${hue}, 100%, 70%, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
    if (f.kind !== 'crystal') return;

    // 透明な結晶が、外から組み上がって包む
    const build = span(f.t, 1.0, 2.4);
    if (build <= 0.01) return;
    const grow = lerp(1.35, 1, build);
    const shimmer = 0.5 + 0.5 * Math.sin(t * 1.6);
    const pts = [
      [-1, 0.05],
      [-0.62, -1],
      [0.5, -1.08],
      [1, -0.12],
      [0.64, 1],
      [-0.52, 0.96],
    ].map(([x, y]) => ({ x: cx + x * hw * grow, y: cy + y * hh * grow }));
    const poly = new Path2D();
    pts.forEach((p, i) => (i ? poly.lineTo(p.x, p.y) : poly.moveTo(p.x, p.y)));
    poly.closePath();
    const a = build * fade;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = `hsla(185, 100%, 92%, ${0.16 * a})`;
    ctx.fill(poly);
    ctx.strokeStyle = `rgba(18, 10, 28, ${0.55 * a})`;
    ctx.lineWidth = 5;
    ctx.stroke(poly);
    ctx.strokeStyle = `hsla(185, 100%, 95%, ${0.85 * a})`;
    ctx.lineWidth = 2;
    ctx.stroke(poly);
    // 面の境目(中心の少し上の点から)
    const core = { x: cx + hw * 0.1, y: cy - hh * 0.2 };
    ctx.beginPath();
    for (const i of [1, 3, 4]) {
      ctx.moveTo(core.x, core.y);
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = `hsla(185, 100%, 95%, ${0.35 * a})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 面の照り返し
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `hsla(${hue}, 100%, 85%, ${0.12 * a * (0.6 + 0.4 * shimmer)})`;
    ctx.beginPath();
    ctx.moveTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.lineTo(core.x, core.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  clear() {
    const list = this.list.map((f) => f.c);
    this.list = [];
    return list;
  }
}

