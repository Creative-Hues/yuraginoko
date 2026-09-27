// 水槽1つ分のデータと、その中の生き物たち。
import { Creature, MEAL } from '../creature/creature.js';
import { seekDistance } from '../creature/behavior.js';
import { DEPTH_SPAN } from '../creature/body.js';
import { makeId, makeRng, randomSeed } from '../util/random.js';
import { clamp, lerp, smoothstep } from '../util/math.js';
import { Algae, DAY_MS, calmFor } from './algae.js';
import { FoodBits } from './food.js';
import { Nutrients, accumulateExposure, copyEnv, exposureDrift, normalizeEnv } from './environment.js';
import { Plants } from './plants.js';
import { ENV_CHANGE, ENV_TICK, NUTRIENT, SPROUT, SPROUT_BY_FOOD } from './envConfig.js';
import { Social } from './social.js';
import { Eggs } from './eggs.js';
import { makeChild, parentSnapshot } from '../creature/breeding.js';
import { BREED, EGG, GROW, TANK_CAPACITY } from '../creature/lifeConfig.js';

// 保存データの形が変わったら上げる(読み込み時に古い形を変換できるように)
// - 1: フェーズ1
// - 2: lastSeenAt(最後に見ていた時刻)と things.algae(藻)、生き物ごとの meal(食事の段階)を追加
// - 3: env(土・光・水流)と things.plants(植物)、things.soil(底の栄養)を追加
// - 4: id・name・createdAt(1人が複数の水槽を持てるように)、social(交流の回数)、eggs(卵)、
//      生き物ごとの growth・mutations・parents・bornAt を追加(quirks は後になくした。古いデータにあっても読み込まない)
//   (版はそのままで、生き物ごとの sensitivity(環境の受けやすさ)と traits(特徴遺伝子)を追加。無いデータは genes と seed から決める)
export const TANK_DATA_VERSION = 4;

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
    this.id = data.id ?? data.personaId; // フェーズ3までの水槽は、人の id が水槽の id
    this.name = typeof data.name === 'string' ? data.name : '';
    this.createdAt = Number(data.createdAt ?? data.savedAt) || Date.now();
    this.seed = data.seed ?? randomSeed(); // 底の小石など、水槽ごとの景色に使う
    this.creatures = (data.creatures ?? []).map((d) => this.adopt(new Creature(d)));
    // 水槽内のもの(藻など)と環境設定。知らない中身も消さずにそのまま保存し直す
    this.things = data.things ?? {};
    this.env = normalizeEnv(data.env); // 環境のない古いデータは、初期の環境
    this.algae = loadPart('藻', (ok) => new Algae(ok ? this.things.algae : null, this.seed));
    this.plants = loadPart('植物', (ok) => new Plants(ok ? this.things.plants : null));
    this.nutrients = loadPart('底の栄養', (ok) => new Nutrients(ok ? this.things.soil : null));
    this.social = loadPart('交流', (ok) => new Social(ok ? data.social : null));
    this.eggs = loadPart('卵', (ok) => new Eggs(ok ? data.eggs : null));
    // 最後に見ていた時刻。古いデータには無いので、保存した時刻で代わりにする
    this.lastSeenAt = Number(data.lastSeenAt ?? data.savedAt) || Date.now();

    // ここから下は保存しない
    this.calm = calmFor(this.algae.level); // 藻による動きの速さ(なめらかに変わる)
    this.food = new FoodBits();
    this.focus = null; // 観察中の生き物
    this.events = []; // 描画側に知らせること(食べたときの泡など)
    this.envClock = 0; // 植物が育つのと環境の記録を、ENV_TICK 秒ごとに進める
    this.random = Math.random; // 芽が出るか・どちらが卵を産むかの判定(確認用に差し替えられる)
    this.dirty = false;
  }

  // 新しい水槽(初期の環境で、新しい2匹)
  static createNew(personaId, { id = makeId(), name = '' } = {}) {
    const tank = Tank.createEmpty(personaId, { id, name });
    tank.creatures = [
      Creature.create({ x: 0.35, z: 0.15 + Math.random() * 0.3 }),
      Creature.create({ x: 0.65, z: 0.55 + Math.random() * 0.35 }),
    ].map((c) => tank.adopt(c));
    tank.dirty = true;
    return tank;
  }

  // 生き物のいない新しい水槽(初期の環境)。別の水槽から移すときに使う
  static createEmpty(personaId, { id = makeId(), name = '' } = {}) {
    const tank = new Tank({ personaId, id, name, createdAt: Date.now(), lastSeenAt: Date.now() });
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

  // ---- 住んでいる子 ----

  // 5匹いる(どこで暮らすか決める子がいる)
  get crowded() {
    return this.creatures.length > TANK_CAPACITY;
  }

  // 空きがある(卵がかえるぶんも数える)
  get hasRoom() {
    return this.creatures.length + this.eggs.count < TANK_CAPACITY;
  }

  // 別の水槽から来た子を迎える。位置は水槽の中ほどのどこか
  addCreature(c) {
    this.adopt(c);
    c.x = 0.3 + Math.random() * 0.4;
    c.z = 0.1 + Math.random() * 0.8;
    c.meet = null;
    c.leaving = false;
    this.creatures.push(c);
    this.dirty = true;
    return c;
  }

  // 水槽から外す(標本にする・別の水槽へ移す)。交流の回数も消す
  removeCreature(c) {
    const i = this.creatures.indexOf(c);
    if (i < 0) return false;
    this.creatures.splice(i, 1);
    this.social.forget(c);
    for (const other of this.creatures) if (other.meet?.partner === c) other.meet = null;
    if (this.focus === c) this.focus = null;
    this.dirty = true;
    return true;
  }

  // ---- 交流・交配・卵 ----

  // 5匹の間(卵がかえって5匹になるぶんも数える)は、繁殖しない
  get canBreed() {
    return !this.crowded && this.creatures.length + this.eggs.count <= TANK_CAPACITY;
  }

  // 触れ合った2匹(回数は social.js で数えた。MATE.MEETS 回たまると、繁殖の準備ができる)
  met(a, b) {
    this.dirty = true;
    this.events.push({ type: 'meet', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, a, b });
  }

  // 寄り添いが最後まで終わった:BREED.CHANCE の確率で卵を産む。産んだらその組の回数を 0 に戻す。
  // 産まなかったときは、準備ができたまま次を待つ
  bred(a, b) {
    if (!this.canBreed || !this.social.ready(a, b)) return null;
    if (this.random() >= BREED.CHANCE) return null;
    this.social.reset(a, b);
    return this.mate(a, b);
  }

  // 観察中に出す一言:繁殖の準備ができている相手がいるか
  readyToBreed(c) {
    return this.social.hasReadyPartner(c, this.creatures);
  }

  // 交配:どちらかが、しっぽの後ろの砂に卵を産む
  mate(a, b, rng = this.random) {
    const mother = rng() < 0.5 ? a : b;
    const child = makeChild(a, b, makeRng(Math.floor(rng() * 4294967296)));
    child.parents = [parentSnapshot(a), parentSnapshot(b)];
    const tail = mother.points[mother.points.length - 1];
    const before = mother.points[mother.points.length - 2];
    const len = Math.hypot(tail.x - before.x, tail.z - before.z) || 1;
    const x = tail.x + ((tail.x - before.x) / len) * EGG.BEHIND;
    const z = tail.z + ((tail.z - before.z) / len) * EGG.BEHIND;
    const egg = this.eggs.lay(x, z, mother, child);
    this.events.push({ type: 'egg', x: egg.x, z: egg.z });
    this.dirty = true;
    return egg;
  }

  // 卵がかえる:その場所に、小さな赤ちゃん
  hatch(egg) {
    const baby = this.adopt(Creature.born({ ...egg.child, x: clamp(egg.x, 0.3, 0.7), z: egg.z }));
    this.creatures.push(baby);
    this.events.push({ type: 'hatch', x: egg.x, z: egg.z, creature: baby, egg });
    if (this.crowded) this.events.push({ type: 'crowded', creature: baby });
    this.dirty = true;
    return baby;
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

  // 環境でまとめて変わる。光ったりはせず、少しかけて静かに変わる
  envShift(c) {
    c.finishShift(); // 前の変化が残っていれば、先に変えきる
    const drift = exposureDrift(c, c.envExposure);
    c.envExposure.clear();
    if (!Object.values(drift).some((v) => v !== 0)) return;
    this.dirty = true;
    c.shiftGenes(drift, ENV_CHANGE.SHIFT_SECONDS);
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
      const baby = lerp(GROW.BABY_PACE, 1, smoothstep(c.growth));
      c.pace = this.calm * baby * (c === this.focus ? OBSERVED_PACE : 1);
      c.update(dt, t);
    }
    this.updateFood(dt);
    const social = this.social.update(dt, this.creatures, this.canBreed);
    if (social?.type === 'met') this.met(social.a, social.b);
    else if (social?.type === 'bred') this.bred(social.a, social.b);
    const br = this.social.breeding;
    if (br?.bubbled) {
      br.bubbled = false;
      this.events.push({ type: 'nestle', a: br.a, b: br.b });
    }
    for (const egg of this.eggs.update(dt)) this.hatch(egg);
    if (this.eggs.count) this.dirty = true;
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
      id: this.id,
      personaId: this.personaId,
      name: this.name,
      createdAt: this.createdAt,
      version: TANK_DATA_VERSION,
      seed: this.seed,
      lastSeenAt: this.lastSeenAt,
      creatures: this.creatures.map((c) => c.toJSON()),
      things: { ...this.things, algae: this.algae.toData(), plants: this.plants.toData(), soil: this.nutrients.toData() },
      env: copyEnv(this.env),
      social: this.social.toData(),
      eggs: this.eggs.toData(),
    };
  }
}
