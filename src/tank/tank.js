// 水槽1つ分のデータと、その中の生き物たち。
import { Creature, MEAL } from '../creature/creature.js';
import { seekDistance } from '../creature/behavior.js';
import { DEPTH_SPAN } from '../creature/body.js';
import { randomSeed } from '../util/random.js';
import { clamp } from '../util/math.js';
import { Algae, DAY_MS, calmFor } from './algae.js';
import { FoodBits } from './food.js';

// 保存データの形が変わったら上げる(読み込み時に古い形を変換できるように)
// - 1: フェーズ1
// - 2: lastSeenAt(最後に見ていた時刻)と things.algae(藻)、生き物ごとの meal(食事の段階)を追加
export const TANK_DATA_VERSION = 2;

const OBSERVED_PACE = 0.6; // 観察中の1匹は、画面から逃げにくいよう少しゆっくり
const EAT_REACH = 0.035; // 頭がエサにこれより近づいたら食べ始める
const SEEK_GIVE_UP = 25; // これだけ経ってもたどり着けなければ、食べたことにする(秒)

// 藻の読み込み。うまく読めなかったときは、藻なしで始める(水槽は開けるように)
function loadAlgae(saved, seed) {
  try {
    return new Algae(saved, seed);
  } catch (err) {
    console.error('藻を読み込めませんでした', err);
    return new Algae(null, seed);
  }
}

export class Tank {
  constructor(data) {
    this.personaId = data.personaId;
    this.seed = data.seed ?? randomSeed(); // 底の小石など、水槽ごとの景色に使う
    this.creatures = (data.creatures ?? []).map((d) => this.adopt(new Creature(d)));
    // 水槽内のもの(藻など)と環境設定。知らない中身も消さずにそのまま保存し直す
    this.things = data.things ?? {};
    this.env = data.env ?? {};
    this.algae = loadAlgae(this.things.algae, this.seed);
    // 最後に見ていた時刻。古いデータには無いので、保存した時刻で代わりにする
    this.lastSeenAt = Number(data.lastSeenAt ?? data.savedAt) || Date.now();

    // ここから下は保存しない
    this.calm = calmFor(this.algae.level); // 藻による動きの速さ(なめらかに変わる)
    this.food = new FoodBits();
    this.focus = null; // 観察中の生き物
    this.events = []; // 描画側に知らせること(食べたときの泡など)
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
    return creature;
  }

  // 閉じていた間のぶん、藻を増やす(生き物には何もしない)。
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
    if (at) this.food.leave(at.x, at.z, creature.genes.hue);
    return !!at;
  }

  update(dt, t) {
    // 藻が減ったり増えたりしたら、動きの速さもゆっくり追いつく
    this.calm += (calmFor(this.algae.level) - this.calm) * Math.min(1, dt * 0.5);
    for (const c of this.creatures) {
      c.pace = this.calm * (c === this.focus ? OBSERVED_PACE : 1);
      c.update(dt, t);
    }
    this.updateFood(dt);
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
  }

  toData() {
    return {
      personaId: this.personaId,
      version: TANK_DATA_VERSION,
      seed: this.seed,
      lastSeenAt: this.lastSeenAt,
      creatures: this.creatures.map((c) => c.toJSON()),
      things: { ...this.things, algae: this.algae.toData() },
      env: this.env,
    };
  }
}
