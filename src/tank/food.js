// 水槽の中のエサの粒と、排泄の粒。どちらも見た目だけで、保存しない。
// 位置は水槽の中の座標(x: 左右 0〜1、z: 0 = 手前〜1 = 奥)。
//
// 排泄の粒は順番に見せる:
//   しっぽの先から1粒ずつ押し出される(EMERGE)→ 砂の上で少し光る(SHINE)
//   → しばらく置かれたまま → 平たく広がりながら、ゆっくり溶けて消える(MELT)
import { FOODS } from '../creature/genes.js';
import { DEPTH_SPAN } from '../creature/body.js';
import { clamp, lerp, smoothstep } from '../util/math.js';

const TAU = Math.PI * 2;
const FALL_SECONDS = 2.4; // 水面から底まで沈む時間
const EAT_SECONDS = 0.7; // 食べられて小さくなっていく時間
const INK = 'rgba(11, 5, 20, 0.9)';

export const DROPPING = {
  FIRST_DELAY: 0.5, // 「排泄させる」を押してから、最初の粒が出るまで(体が縮む間)
  EACH_DELAY: 0.35, // 粒と粒の間
  EMERGE: 0.6, // しっぽから出て、砂に落ちるまで
  SHINE: 3, // 砂の上で光っている時間
  MELT_START: 15, // 溶け始める(砂に落ちてからの秒数)
  MELT: 10, // 溶けきるまで
  SIZE: 0.036, // 粒の大きさ(生き物の体の長さに対する割合)
  PUSH: 0.025, // しっぽから押し出される距離
};
const DROPPING_LIFE = DROPPING.EMERGE + DROPPING.MELT_START + DROPPING.MELT;

// 16進の色 → "r, g, b"
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export class FoodBits {
  constructor() {
    this.pellets = []; // { creature, food, x, z, fall(0〜1), eat(0〜1 または -1) }
    this.droppings = []; // { x0, z0(しっぽの先), x, z(落ちる場所), r, food, age }
  }

  drop(creature, food, x, z) {
    const pellet = { creature, food, x, z, fall: 0, eat: -1 };
    this.pellets.push(pellet);
    return pellet;
  }

  pelletFor(creature) {
    return this.pellets.find((p) => p.creature === creature) ?? null;
  }

  landed(pellet) {
    return pellet.fall >= 1;
  }

  startEating(pellet) {
    if (pellet.eat < 0) pellet.eat = 0;
  }

  // 排泄:しっぽの先 (x, z) から、向き (dx, dz) へ粒を押し出す。粒は食べたエサの色
  leave({ x, z, dx, dz, food }) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const push = DROPPING.PUSH * (1 + i * 0.7) * (0.8 + Math.random() * 0.4);
      this.droppings.push({
        x0: x,
        z0: z,
        x: x + dx * push + (Math.random() - 0.5) * 0.012,
        z: z + (dz * push) / DEPTH_SPAN + (Math.random() - 0.5) * 0.05,
        r: 0.8 + Math.random() * 0.4,
        food,
        age: -(DROPPING.FIRST_DELAY + i * DROPPING.EACH_DELAY),
      });
    }
  }

  // 食べ終わった粒を返す
  update(dt) {
    const finished = [];
    for (const p of this.pellets) {
      if (p.fall < 1) p.fall = Math.min(1, p.fall + dt / FALL_SECONDS);
      if (p.eat >= 0) {
        p.eat += dt / EAT_SECONDS;
        if (p.eat >= 1) finished.push(p);
      }
    }
    if (finished.length) this.pellets = this.pellets.filter((p) => !finished.includes(p));
    for (const d of this.droppings) d.age += dt;
    if (this.droppings.some((d) => d.age > DROPPING_LIFE)) {
      this.droppings = this.droppings.filter((d) => d.age <= DROPPING_LIFE);
    }
    return finished;
  }

  clear() {
    this.pellets = [];
    this.droppings = [];
  }

  // 排泄の粒。emerging = true のときは、しっぽから出ている途中の粒だけ(生き物より手前に描く)、
  // false のときは砂に落ちた粒だけ(生き物より先に描く)
  drawDroppings(ctx, geo, emerging = false) {
    const size = geo.creatureSize;
    for (const d of this.droppings) {
      if (d.age < 0 || d.age < DROPPING.EMERGE !== emerging) continue;
      const food = FOODS[d.food];
      const color = food?.color ?? '#8a6a9a';
      const c = rgb(color);

      let x;
      let y;
      let scale;
      let grow = 1;
      if (emerging) {
        // しっぽの先(体の高さ)から、少し後ろへ押し出されて砂に落ちる
        const k = d.age / DROPPING.EMERGE;
        const from = geo.project(d.x0, d.z0);
        const to = geo.project(d.x, d.z);
        scale = lerp(from.scale, to.scale, k);
        x = lerp(from.x, to.x, smoothstep(k));
        const lift = size * 0.07 * from.scale * (1 - k * k);
        y = lerp(from.floorY, to.floorY, k) - lift;
        grow = lerp(0.35, 1, smoothstep(k * 1.6));
      } else {
        const pos = geo.project(d.x, d.z);
        x = pos.x;
        y = pos.floorY;
        scale = pos.scale;
      }
      const onSand = d.age - DROPPING.EMERGE; // 砂に落ちてからの秒数
      const melt = clamp((onSand - DROPPING.MELT_START) / DROPPING.MELT);
      const r = size * DROPPING.SIZE * d.r * scale * grow;
      const rx = r * lerp(1, 1.7, smoothstep(melt)); // 溶けると平たく広がる
      const ry = r * 0.72 * lerp(1, 0.25, smoothstep(melt));
      const a = 1 - smoothstep(melt);
      if (a <= 0.01) continue;

      // 砂に落ちてすぐは、エサの色でふわっと光る
      if (onSand >= 0 && onSand < DROPPING.SHINE) {
        const k = onSand / DROPPING.SHINE;
        const glow = Math.sin(Math.PI * Math.min(1, k * 2.5)) * 0.5 + 0.5 * (1 - k);
        const gr = r * 3.2;
        const g = ctx.createRadialGradient(x, y - ry, 0, x, y - ry, gr);
        g.addColorStop(0, `rgba(${c}, ${0.6 * glow * (1 - k * 0.5)})`);
        g.addColorStop(1, `rgba(${c}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - gr, y - ry - gr, gr * 2, gr * 2);
      }

      ctx.globalAlpha = a;
      // 溶けていくときの、うすいしみ
      if (melt > 0) {
        ctx.fillStyle = `rgba(${c}, ${0.25 * Math.sin(Math.PI * melt)})`;
        ctx.beginPath();
        ctx.ellipse(x, y, rx * 1.5, rx * 0.35, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, r * 0.3);
      ctx.beginPath();
      ctx.ellipse(x, y - ry, rx, ry, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.arc(x - rx * 0.35, y - ry * 1.4, Math.max(0.5, r * 0.22 * (1 - melt)), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // エサの粒(沈んでいく途中も、底に着いてからも)
  drawPellets(ctx, geo, t) {
    const size = geo.creatureSize;
    for (const p of this.pellets) {
      const food = FOODS[p.food];
      if (!food) continue;
      const pos = geo.project(p.x, p.z);
      const shrink = p.eat >= 0 ? 1 - smoothstep(p.eat) : 1;
      const r = size * 0.028 * pos.scale * shrink;
      if (r < 0.3) continue;
      const k = smoothstep(p.fall);
      const y = lerp(geo.surfaceY, pos.floorY - r, k);
      const x = pos.x + Math.sin(t * 2.2 + p.x * 20) * size * 0.02 * (1 - k);
      if (food.shine) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
        g.addColorStop(0, 'rgba(210, 255, 120, 0.55)');
        g.addColorStop(1, 'rgba(210, 255, 120, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r * 3.5, y - r * 3.5, r * 7, r * 7);
      }
      ctx.fillStyle = food.color;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.2, r * 0.4);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.beginPath();
      ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, TAU);
      ctx.fill();
    }
  }
}
