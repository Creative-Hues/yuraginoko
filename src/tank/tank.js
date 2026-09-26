// 水槽1つ分のデータと、その中の生き物たち。
import { Creature } from '../creature/creature.js';
import { randomSeed } from '../util/random.js';

// 保存データの形が変わったら上げる(読み込み時に古い形を変換できるように)
export const TANK_DATA_VERSION = 1;

export class Tank {
  constructor(data) {
    this.personaId = data.personaId;
    this.seed = data.seed ?? randomSeed(); // 底の小石など、水槽ごとの景色に使う
    this.creatures = (data.creatures ?? []).map((d) => this.adopt(new Creature(d)));
    // 後のフェーズで増える「水槽内のもの」(藻・エサなど)と環境設定。
    // 今は使わないが、中身は消さずにそのまま保存し直す。
    this.things = data.things ?? {};
    this.env = data.env ?? {};
    this.dirty = false;
  }

  static createNew(personaId) {
    const tank = new Tank({ personaId });
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

  update(dt, t) {
    for (const c of this.creatures) c.update(dt, t);
  }

  toData() {
    return {
      personaId: this.personaId,
      version: TANK_DATA_VERSION,
      seed: this.seed,
      creatures: this.creatures.map((c) => c.toJSON()),
      things: this.things,
      env: this.env,
    };
  }
}
