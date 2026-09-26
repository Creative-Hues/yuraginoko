import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { addPersona, closeDB, listPersonas, loadTank, saveTank } from '../src/storage/db.js';
import { Tank } from '../src/tank/tank.js';

afterEach(async () => {
  await closeDB();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('aquarium');
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe('保存', () => {
  it('人を追加して一覧に出る。同じ名前は増えない', async () => {
    const a = await addPersona('テスト1');
    await addPersona('テスト2');
    const again = await addPersona(' テスト1 ');
    expect(again.id).toBe(a.id);
    const list = await listPersonas();
    expect(list.map((p) => p.name)).toEqual(['テスト1', 'テスト2']);
  });

  it('新しい水槽には2匹いて、保存して読み込むと同じ状態に戻る', async () => {
    const p = await addPersona('テスト');
    const tank = Tank.createNew(p.id);
    expect(tank.creatures).toHaveLength(2);

    // 触れ合いで遺伝子が変わった状態も残る
    const c = tank.creatures[0];
    const before = c.genes.spikeLength;
    c.flick();
    expect(tank.dirty).toBe(true);
    c.x = 0.42;

    await saveTank(tank.toData());
    const loaded = Tank.fromData(await loadTank(p.id));
    expect(loaded.creatures).toHaveLength(2);
    expect(loaded.creatures[0].x).toBe(0.42);
    expect(loaded.creatures[0].genes).toEqual(c.genes);
    expect(loaded.creatures[0].genes.spikeLength).toBeCloseTo(Math.max(0, before - 0.005), 10);
  });

  it('撫でた距離が短いときは遺伝子を動かさない', () => {
    const tank = Tank.createNew('x');
    const c = tank.creatures[0];
    c.genes.translucency = 0.5;
    c.stroke(5);
    c.endStroke();
    expect(c.genes.translucency).toBe(0.5);
    c.stroke(15);
    c.stroke(15);
    c.endStroke();
    expect(c.genes.translucency).toBeCloseTo(0.505, 10);
  });
});
