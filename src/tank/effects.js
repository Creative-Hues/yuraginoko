// 水の中の小さな動き:ただよう粒、上っていく泡、触れた場所の波紋。
// 粒と泡は、水流(current: { strength, dir })の向きへ流れる。
import { lerp } from '../util/math.js';
import { wave } from '../util/noise.js';
import { CURRENT_LOOK } from './envConfig.js';

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

  update(dt, current) {
    const flow = current ? current.dir * current.strength * CURRENT_LOOK.PARTICLE_SPEED : 0;
    for (const p of this.list) {
      p.y += 0.012 * p.s * dt;
      if (p.y > 1) {
        p.y = 0;
        p.x = Math.random();
      }
      // 奥の粒ほどゆっくり流れる(はみ出したら反対側から)
      if (flow) {
        p.x += flow * lerp(1, 0.5, p.z) * p.s * dt;
        p.x -= Math.floor(p.x);
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

  update(dt, geo, current) {
    const flow = current ? current.dir * current.strength * CURRENT_LOOK.BUBBLE_SPEED : 0;
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
      b.x += flow * dt;
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

// 光の粒。環境で生き物が変わる瞬間に、体からふわっと昇る
export class Sparkles {
  constructor() {
    this.list = [];
  }

  clear() {
    this.list = [];
  }

  // hue: 色相(度)、size: 大きさの倍率(奥ほど小さく)
  add(x, y, count, hue, size = 1) {
    for (let i = 0; i < count; i++) {
      this.list.push({
        x: x + (Math.random() - 0.5) * 50 * size,
        y: y + (Math.random() - 0.5) * 16 * size,
        vx: (Math.random() - 0.5) * 10,
        vy: -(18 + Math.random() * 18) * size,
        r: (2.2 + Math.random() * 1.8) * size,
        hue,
        age: -i * 0.09,
        life: 1.3 + Math.random() * 0.5,
      });
    }
  }

  update(dt) {
    for (const s of this.list) {
      s.age += dt;
      if (s.age < 0) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    if (this.list.some((s) => s.age > s.life)) this.list = this.list.filter((s) => s.age <= s.life);
  }

  draw(ctx) {
    if (!this.list.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.list) {
      if (s.age < 0) continue;
      const k = s.age / s.life;
      const a = Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k * 0.3);
      const r = s.r * (1 - k * 0.4);
      // 4つの角の光(十字の星)
      ctx.fillStyle = `hsla(${s.hue}, 100%, 82%, ${a * 0.9})`;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - r * 2);
      ctx.quadraticCurveTo(s.x, s.y, s.x + r * 2, s.y);
      ctx.quadraticCurveTo(s.x, s.y, s.x, s.y + r * 2);
      ctx.quadraticCurveTo(s.x, s.y, s.x - r * 2, s.y);
      ctx.quadraticCurveTo(s.x, s.y, s.x, s.y - r * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${s.hue}, 100%, 70%, ${a * 0.25})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
