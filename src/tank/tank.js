// 水槽1つ分のデータと、その中の生き物たち。
import { Creature, MEAL } from '../creature/creature.js';
import { seekDistance } from '../creature/behavior.js';
import { DEPTH_SPAN } from '../creature/body.js';
import { randomSeed } from '../util/random.js';
import { clamp } from '../util/math.js';
import { nudgeGenes } from '../creature/genes.js';
import { Algae, DAY_MS, calmFor } from './algae.js';
import { FoodBits } from './food.js';
import { Nutrients, accumulateExposure, copyEnv, exposureDrift, normalizeEnv } from './environment.js';
import { Plants } from './plants.js';
import { ENV_CHANGE, ENV_TICK, NUTRIENT, SPROUT, SPROUT_BY_FOOD } from './envConfig.js';

// 保存データの形が変わったら上げる(読み込み時に古い形を変換できるように)
// - 1: フェーズ1
// - 2: lastSeenAt(最後に見ていた時刻)と things.algae(藻)、生き物ごとの meal(食事の段階)を追加
// - 3: env(土・光・水流)と things.plants(植物)、things.soil(底の栄養)を追加
export const TANK_DATA_VERSION = 3;

const OBSERVED_PACE = 0.6; // 観察中の1匹は、画面から逃げにくいよう少しゆっくり
const EAT_REACH = 0.035; // 頭がエサにこれより近づいたら食べ始める
const SEEK_GIVE_UP = 25; // これだけ経ってもたどり着けなければ、食べたことにする(秒)

// 水槽の中のもの(藻・植物・栄養)の読み込み。うまく読めなかったときは、空で始める(水槽は開けるように)
function loadPart(label, make) {
  try {
    return make(true);
  } catch (err) {
    console.error(`${label}を読み込めませんでした`, err);
    return make(false);
  }
}

export class Tank {
  constructor(data) {
    this.personaId = data.personaId;
    this.seed = data.seed ?? randomSeed(); // 底の小石など、水槽ごとの景色に使う
    this.creatures = (data.creatures ?? []).map((d) => this.adopt(new Creature(d)));
    // 水槽内のもの(藻など)と環境設定。知らない中身も消さずにそのまま保存し直す
    this.things = data.things ?? {};
    this.env = normalizeEnv(data.env); // 環境のない古いデータは、初期の環境
    this.algae = loadPart('藻', (ok) => new Algae(ok ? this.things.algae : null, this.seed));
    this.plants = loadPart('植物', (ok) => new Plants(ok ? this.things.plants : null));
    this.nutrients = loadPart('底の栄養', (ok) => new Nutrients(ok ? this.things.soil : null));
    // 最後に見ていた時刻。古いデータには無いので、保存した時刻で代わりにする
    this.lastSeenAt = Number(data.lastSeenAt ?? data.savedAt) || Date.now();

    // ここから下は保存しない
    this.calm = calmFor(this.algae.level); // 藻による動きの速さ(なめらかに変わる)
    this.food = new FoodBits();
    this.focus = null; // 観察中の生き物
    this.events = []; // 描画側に知らせること(食べたときの泡など)
    this.envClock = 0; // 植物が育つのと環境の記録を、ENV_TICK 秒ごとに進める
    this.random = Math.random; // 芽が出るかの判定(確認用に差し替えられる)
    this.dirty = false;
  }

  static createNew(personaId) {
    const tank = new Tank({ personaId, lastSeenAt: Date.now() });
    tank.creatures = [
      Creature.create({ x: 0.35, z: 0.15 + Math.random() * 0.3 }),
      Creature.create({ x: 0.65, z: 0.55 + Math.random() * 0.35 }),
    ].map((c) => tank.adopt(c));
    tank.dirty = true;
    return tank;
  }

  static fromData(data) {
    return new Tank(data);
  }

  adopt(creature) {
    creature.onChange = () => {
      this.dirty = true;
    };
    // 環境による変化(保存しない)。まとめて変わるタイミングは、生き物ごとにずらす
    creature.envExposure = new Map();
    creature.envTimer = Math.random() * ENV_CHANGE.INTERVAL;
    return creature;
  }

  // 閉じていた間のぶん、藻を増やす(生き物と植物には何もしない)。
  // days を渡すと、その日数だけ閉じていたことにする(確認用の ?days=)
  catchUp(now = Date.now(), days = null) {
    const closed = days ?? Math.max(0, now - this.lastSeenAt) / DAY_MS;
    if (this.algae.grow(closed)) this.dirty = true;
    this.lastSeenAt = now;
  }

  // 掃除:画面上の位置 (nx, ny) の藻を減らす。減ったら true
  scrub(nx, ny, rx, ry, amount) {
    const changed = this.algae.erase(nx, ny, rx, ry, amount);
    if (changed) this.dirty = true;
    return changed;
  }

  clearAlgae() {
    if (this.algae.level > 0) this.dirty = true;
    this.algae.clear();
  }

  // ---- 食事 ----

  // エサを落とす。生き物の頭の少し先に落として、そこへ向かわせる
  feed(creature, food) {
    if (creature.meal.stage !== MEAL.ready) return false;
    const ahead = Math.cos(creature.heading) >= 0 ? 1 : -1;
    const x = clamp(creature.x + ahead * 0.07, 0.2, 0.8);
    const z = clamp(creature.z + (Math.random() - 0.5) * 0.16, 0.1, 0.9);
    if (!creature.seekFood(food, x, z)) return false;
    this.food.drop(creature, food, x, z);
    return true;
  }

  excrete(creature) {
    const at = creature.excrete();
    if (at) this.food.leave(at);
    return !!at;
  }

  // ---- 環境 ----

  // 環境を変える。patch は { soil } / { light: { color, brightness } } / { current: { strength, dir } } の一部
  setEnv(patch) {
    const next = normalizeEnv({
      ...this.env,
      ...patch,
      light: { ...this.env.light, ...patch.light },
      current: { ...this.env.current, ...patch.current },
    });
    this.env = next;
    this.dirty = true;
  }

  // 植える。上限のときは null
  plant(kind, x, z) {
    const p = this.plants.add(kind, x, z);
    if (p) this.dirty = true;
    return p;
  }

  movePlant(plant, x, z) {
    this.plants.move(plant, x, z);
    this.dirty = true;
  }

  removePlant(plant) {
    if (this.plants.remove(plant)) this.dirty = true;
  }

  // 開いている間だけ、seconds 秒ぶん植物を育てて、生き物ごとに当てはまっている環境を記録する。
  // ENV_CHANGE.INTERVAL 秒たった生き物は、その間のぶんをまとめて変える
  tickEnv(seconds) {
    if (this.plants.grow(seconds, this.nutrients)) this.dirty = true;
    for (const c of this.creatures) {
      accumulateExposure(c.envExposure, c, this.env, this.plants.list, seconds);
      c.envTimer += seconds;
      if (c.envTimer >= ENV_CHANGE.INTERVAL) {
        c.envTimer -= ENV_CHANGE.INTERVAL;
        this.envShift(c);
      }
    }
  }

  // 環境でまとめて変わる。見えるくらいの変化なら、少しかけて変わりながら体がふわっと光る
  envShift(c) {
    c.finishShift(); // 前の変化が残っていれば、先に変えきる
    const drift = exposureDrift(c, c.envExposure);
    c.envExposure.clear();
    const size = Object.values(drift).reduce((sum, v) => sum + Math.abs(v), 0);
    if (!(size > 0)) return;
    this.dirty = true;
    if (size < ENV_CHANGE.MIN_VISIBLE) {
      nudgeGenes(c.genes, drift);
      return;
    }
    c.shiftGenes(drift, ENV_CHANGE.SHIFT_SECONDS, ENV_CHANGE.GLOW_SECONDS);
    this.events.push({ type: 'envShift', creature: c });
  }

  // 排泄の粒が溶けきった:その場所の土に栄養をためる。1回の排泄の粒がすべて溶けたら、ときどき芽が出る
  melted(d) {
    this.nutrients.add(d.x, d.z, NUTRIENT.PER_DROPPING);
    this.dirty = true;
    if (d.batch.left > 0) return;
    const kind = SPROUT_BY_FOOD[d.batch.food];
    if (!kind || this.plants.full) return;
    const chance = SPROUT.CHANCE + SPROUT.NUTRIENT_BONUS * this.nutrients.at(d.x, d.z);
    if (this.random() >= chance) return;
    const p = this.plants.add(kind, d.x, d.z);
    if (!p) return;
    this.nutrients.take(p.x, p.z, SPROUT.NUTRIENT_USE);
    this.events.push({ type: 'sprout', x: p.x, z: p.z });
  }

  update(dt, t) {
    // 藻が減ったり増えたりしたら、動きの速さもゆっくり追いつく
    this.calm += (calmFor(this.algae.level) - this.calm) * Math.min(1, dt * 0.5);
    for (const c of this.creatures) {
      c.pace = this.calm * (c === this.focus ? OBSERVED_PACE : 1);
      c.update(dt, t);
    }
    this.updateFood(dt);
    this.envClock += dt;
    while (this.envClock >= ENV_TICK) {
      this.envClock -= ENV_TICK;
      this.tickEnv(ENV_TICK);
    }
  }

  updateFood(dt) {
    for (const c of this.creatures) {
      if (c.meal.stage !== MEAL.seeking) continue;
      const pellet = this.food.pelletFor(c);
      // 読み込み直しなどで粒が無いときは、その場で食べたことにする
      if (!pellet) {
        c.ate();
        continue;
      }
      if (pellet.eat >= 0 || !this.food.landed(pellet)) continue;
      const near = Math.hypot(pellet.x - c.x, (pellet.z - c.z) * DEPTH_SPAN) < EAT_REACH || seekDistance(c) < EAT_REACH;
      if (near || c.behavior.time > SEEK_GIVE_UP) {
        this.food.startEating(pellet);
        this.events.push({ type: 'eat', x: pellet.x, z: pellet.z });
      }
    }
    for (const pellet of this.food.update(dt)) pellet.creature.ate();
    for (const d of this.food.takeMelted()) this.melted(d);
  }

  toData() {
    return {
      personaId: this.personaId,
      version: TANK_DATA_VERSION,
      seed: this.seed,
      lastSeenAt: this.lastSeenAt,
      creatures: this.creatures.map((c) => c.toJSON()),
      things: { ...this.things, algae: this.algae.toData(), plants: this.plants.toData(), soil: this.nutrients.toData() },
      env: copyEnv(this.env),
    };
  }
}
