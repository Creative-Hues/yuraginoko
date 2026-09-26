// 水槽の中のエサの粒と、砂の上に残る小さな粒(排泄)。どちらも見た目だけで、保存しない。
// 位置は水槽の中の座標(x: 左右 0〜1、z: 0 = 手前〜1 = 奥)。
import { FOODS } from '../creature/genes.js';
import { lerp, smoothstep } from '../util/math.js';

const TAU = Math.PI * 2;
const FALL_SECONDS = 2.4; // 水面から底まで沈む時間
const EAT_SECONDS = 0.7; // 食べられて小さくなっていく時間
const DROPPING_LIFE = 40; // 砂の上の粒が消えるまで(秒)
const DROPPING_FADE = 10; // 最後のこれだけの秒数で、ゆっくり薄くなる
const INK = 'rgba(11, 5, 20, 0.9)';

export class FoodBits {
  constructor() {
    this.pellets = []; // { creature, food, x, z, fall(0〜1), eat(0〜1 または -1) }
    this.droppings = []; // { x, z, r, hue, age }
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

  // 排泄:しっぽのあたりに小さな粒をいくつか残す
  leave(x, z, hue) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this.droppings.push({
        x: x + (Math.random() - 0.5) * 0.03,
        z: z + (Math.random() - 0.5) * 0.06,
        r: 0.7 + Math.random() * 0.5,
        hue,
        age: -i * 0.25, // 1粒ずつ、少し遅れて出てくる
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
    if (this.droppings.length && this.droppings[0].age > DROPPING_LIFE) {
      this.droppings = this.droppings.filter((d) => d.age <= DROPPING_LIFE);
    }
    return finished;
  }

  clear() {
    this.pellets = [];
    this.droppings = [];
  }

  // 砂の上の粒(生き物より先に描く)
  drawDroppings(ctx, geo) {
    const size = geo.creatureSize;
    for (const d of this.droppings) {
      if (d.age < 0) continue;
      const a = Math.min(1, d.age / 0.3) * Math.min(1, (DROPPING_LIFE - d.age) / DROPPING_FADE);
      if (a <= 0) continue;
      const pos = geo.project(d.x, d.z);
      const r = size * 0.024 * d.r * pos.scale;
      ctx.globalAlpha = a;
      ctx.fillStyle = `hsl(${d.hue * 360}, 30%, 26%)`;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, r * 0.35);
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.floorY - r * 0.5, r, r * 0.7, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(pos.x - r * 0.35, pos.floorY - r * 0.8, r * 0.25, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
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
