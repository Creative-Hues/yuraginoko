// 水の中の小さな動き:ただよう粒、上っていく泡、触れた場所の波紋。
import { lerp } from '../util/math.js';
import { wave } from '../util/noise.js';

const TAU = Math.PI * 2;

// ただよう細かい粒。z が大きいほど奥(小さく、うすい)
export class Particles {
  constructor(count = 90) {
    this.list = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: Math.random(),
      s: 0.5 + Math.random(),
      p: Math.random() * 10,
      tint: Math.random() < 0.15 ? (Math.random() < 0.5 ? '255, 90, 200' : '190, 255, 90') : '220, 255, 240',
    }));
  }

  update(dt) {
    for (const p of this.list) {
      p.y += 0.012 * p.s * dt;
      if (p.y > 1) {
        p.y = 0;
        p.x = Math.random();
      }
    }
  }

  draw(ctx, geo, t, back) {
    for (const p of this.list) {
      if (back !== p.z > 0.5) continue;
      const x = (p.x + wave(t / 30 + p.p, p.p) * 0.02) * geo.W;
      const y = lerp(geo.surfaceY, geo.H, p.y);
      const r = lerp(2.2, 0.8, p.z) * p.s;
      ctx.fillStyle = `rgba(${p.tint}, ${lerp(0.5, 0.2, p.z)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }
}

// 泡。ときどき底から上がり、触れた場所からも出る
export class Bubbles {
  constructor() {
    this.list = [];
    this.nextSpawn = 2;
  }

  clear() {
    this.list = [];
  }

  add(x, y, count, size = 1) {
    for (let i = 0; i < count; i++) {
      this.list.push({
        x: x + (Math.random() - 0.5) * 16 * size,
        y: y + (Math.random() - 0.5) * 10 * size,
        r: (2 + Math.random() * 4) * size,
        vy: 30 + Math.random() * 35,
        p: Math.random() * TAU,
        delay: i * (0.06 + Math.random() * 0.12),
        pop: 0,
      });
    }
  }

  update(dt, geo) {
    // ときどき、底のどこかから泡の列が上がる
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.nextSpawn = 3 + Math.random() * 6;
      const pos = geo.project(0.05 + Math.random() * 0.9, Math.random());
      this.add(pos.x, pos.floorY, 2 + Math.floor(Math.random() * 4), pos.scale);
    }
    for (const b of this.list) {
      if (b.delay > 0) {
        b.delay -= dt;
        continue;
      }
      if (b.pop > 0) {
        b.pop += dt;
        continue;
      }
      b.y -= b.vy * dt;
      b.vy = Math.min(b.vy + 20 * dt, 90);
      b.p += dt * 4;
      if (b.y < geo.surfaceY + b.r) b.pop = 0.001;
    }
    this.list = this.list.filter((b) => b.pop < 0.3);
  }

  draw(ctx) {
    ctx.lineWidth = 1.8;
    for (const b of this.list) {
      if (b.delay > 0) continue;
      const x = b.x + Math.sin(b.p) * 3;
      if (b.pop > 0) {
        const k = b.pop / 0.3;
        ctx.strokeStyle = `rgba(220, 255, 245, ${0.7 * (1 - k)})`;
        ctx.beginPath();
        ctx.arc(x, b.y, b.r * (1 + k * 1.5), 0, TAU);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = 'rgba(150, 255, 230, 0.18)';
      ctx.strokeStyle = 'rgba(220, 255, 245, 0.85)';
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, Math.max(0.8, b.r * 0.25), 0, TAU);
      ctx.fill();
    }
  }
}

// 触れた場所の波紋
export class Ripples {
  constructor() {
    this.list = [];
  }

  add(x, y, strength = 1) {
    this.list.push({ x, y, age: 0, strength });
  }

  update(dt) {
    for (const r of this.list) r.age += dt;
    this.list = this.list.filter((r) => r.age < 1);
  }

  draw(ctx) {
    for (const r of this.list) {
      const k = r.age;
      for (const [delay, grow] of [
        [0, 1],
        [0.18, 0.7],
      ]) {
        const kk = (k - delay) / (1 - delay);
        if (kk <= 0) continue;
        ctx.strokeStyle = `rgba(200, 255, 235, ${0.65 * r.strength * (1 - kk)})`;
        ctx.lineWidth = 2.5 * (1 - kk) + 0.8;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, 8 + kk * 42 * grow, (8 + kk * 42 * grow) * 0.55, 0, 0, TAU);
        ctx.stroke();
      }
    }
  }
}
