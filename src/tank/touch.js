// 水槽へのタッチ操作。
// - 弾く:短くタップ(押してから離すまで短く、ほとんど動かさない)
// - 撫でる:生き物の上を指でなぞる
// - 長押し:生き物の上で、指を動かさずに約0.5秒 → 観察モード
// - ピンチ:2本の指を広げる → 観察モード、閉じる → 水槽に戻る
// - 掃除モード(cleanMode):擦った場所の藻が消える。生き物は反応しない
// - 環境編集モード(editMode):植物を植える・動かす・選ぶ。生き物は反応しない
//
// setMode で操作の中身を差し替える。
// 指の位置は、画面上の位置 (sx, sy) と、水槽の座標 (x, y)(観察モードの拡大を戻したもの)の両方を持つ。

const FLICK_TIME = 250; // ms
const FLICK_MOVE = 10; // px
const STROKE_FX_EVERY = 45; // 撫でている間、これだけ動くごとに波紋と泡を出す(px)
const LONG_PRESS = 500; // ms
const LONG_MOVE = 10; // 長押しの間に動いてもよい距離(px)
const PINCH_OPEN = 1.35; // 指の間がこれだけ広がったら、観察モードへ
const PINCH_CLOSE = 0.75; // これだけ狭まったら、水槽へ戻る
const SCRUB_FX_EVERY = 70; // 掃除中、これだけ動くごとに小さな泡(px)

function cancelLongPress(st) {
  if (st.longTimer) {
    clearTimeout(st.longTimer);
    st.longTimer = null;
  }
}

// ふつうの触れ合いモード
export const interactMode = {
  down(st, env) {
    const { renderer, handlers } = env;
    st.target = renderer.hitTest(st.x, st.y);
    st.stroked = new Set();
    st.fxDist = 0;
    renderer.addRipple(st.x, st.y, st.target ? 1 : 0.6);
    if (st.target && handlers.onLongPress) {
      st.longTimer = setTimeout(() => {
        st.longTimer = null;
        if (st.done || st.moved > LONG_MOVE) return;
        st.longPressed = true;
        handlers.onLongPress(st.target.creature);
      }, LONG_PRESS);
    }
  },
  move(st, env, dist) {
    if (st.moved > LONG_MOVE) cancelLongPress(st);
    if (st.longPressed || st.moved <= FLICK_MOVE) return;
    const { renderer } = env;
    const hit = renderer.hitTest(st.x, st.y);
    if (!hit) return;
    hit.creature.stroke(dist, hit.u);
    st.stroked.add(hit.creature);
    st.fxDist += dist;
    if (st.fxDist >= STROKE_FX_EVERY) {
      st.fxDist = 0;
      renderer.addRipple(st.x, st.y, 0.7);
      renderer.addBubbles(st.x, st.y, 1 + Math.floor(Math.random() * 2));
    }
  },
  up(st, cancelled, env) {
    cancelLongPress(st);
    const quick = performance.now() - st.startT < FLICK_TIME && st.moved <= FLICK_MOVE;
    if (!cancelled && !st.longPressed && quick && st.target) {
      st.target.creature.flick(st.target.u);
      env.renderer.addBubbles(st.x, st.y, 3 + Math.floor(Math.random() * 3));
    }
    for (const c of st.stroked) c.endStroke();
  },
};

// 掃除モード:指の通った場所の藻を消す(handlers.onScrub に画面上の位置と動いた距離を渡す)
export const cleanMode = {
  down(st, env) {
    st.fxDist = 0;
    env.handlers.onScrub?.(st.sx, st.sy, 0);
  },
  move(st, env, dist) {
    env.handlers.onScrub?.(st.sx, st.sy, dist);
    st.fxDist += dist;
    if (st.fxDist >= SCRUB_FX_EVERY) {
      st.fxDist = 0;
      env.renderer.addBubbles(st.x, st.y, 1);
    }
  },
  up() {},
};

// 環境編集モード:植物を触る → 選んで、そのままドラッグで動かす。砂の上をタップ → 植える(選んでいる種類があれば)。
// 生き物には何も伝えない(撫でる・弾く・長押しは起きない)
export const editMode = {
  down(st, env) {
    const { renderer, handlers } = env;
    st.plant = renderer.plantAt(st.x, st.y);
    renderer.addRipple(st.x, st.y, 0.5);
    if (st.plant) {
      // 指と根元のずれ(つかんだ場所がそのままついてくるように)
      const base = renderer.project(st.plant.x, st.plant.z);
      st.grab = { dx: base.x - st.x, dy: base.floorY - st.y };
      handlers.onPlantPick?.(st.plant);
    }
  },
  move(st, env) {
    if (!st.plant || st.moved <= FLICK_MOVE) return;
    env.handlers.onPlantDrag?.(st.plant, st.x + st.grab.dx, st.y + st.grab.dy);
  },
  up(st, cancelled, env) {
    if (cancelled) return;
    if (st.plant) {
      if (st.moved > FLICK_MOVE) env.handlers.onPlantDrop?.(st.plant);
      return;
    }
    if (st.moved <= FLICK_MOVE * 2) env.handlers.onFloorTap?.(st.x, st.y);
  },
};

export function createTouchController(canvas, renderer, handlers = {}) {
  const pointers = new Map();
  const env = { renderer, handlers };
  let mode = interactMode;
  let pinch = null; // { start: 指の間の距離, fired }

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = renderer.toWorld(sx, sy);
    return { sx, sy, x: w.x, y: w.y };
  };

  // 1本指の操作を終える(一度だけ)
  const endSingle = (st, cancelled) => {
    if (st.done) return;
    st.done = true;
    mode.up(st, cancelled, env);
  };

  const twoFingers = () => {
    const [a, b] = pointers.values();
    return { a, b, dist: Math.hypot(a.sx - b.sx, a.sy - b.sy) };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const st = { ...pos(e), startT: performance.now(), moved: 0, done: false };
    pointers.set(e.pointerId, st);
    if (pinch || pointers.size > 1) {
      // 2本目の指は、1本指の操作には使わない
      st.done = true;
      if (pointers.size === 2 && !pinch) {
        // 1本目の撫でる・長押しは取り消して、ピンチにする
        for (const other of pointers.values()) endSingle(other, true);
        pinch = { start: Math.max(1, twoFingers().dist), fired: false };
      }
      return;
    }
    mode.down(st, env);
  });

  canvas.addEventListener('pointermove', (e) => {
    const st = pointers.get(e.pointerId);
    if (!st) return;
    const p = pos(e);
    const dist = Math.hypot(p.sx - st.sx, p.sy - st.sy);
    Object.assign(st, p);
    st.moved += dist;
    if (pinch) {
      if (pinch.fired || pointers.size < 2) return;
      const { a, b, dist: d } = twoFingers();
      const ratio = d / pinch.start;
      if (ratio > PINCH_OPEN) {
        pinch.fired = true;
        const mid = renderer.toWorld((a.sx + b.sx) / 2, (a.sy + b.sy) / 2);
        handlers.onPinchOpen?.(mid.x, mid.y);
      } else if (ratio < PINCH_CLOSE) {
        pinch.fired = true;
        handlers.onPinchClose?.();
      }
      return;
    }
    if (!st.done) mode.move(st, env, dist);
  });

  const finish = (cancelled) => (e) => {
    const st = pointers.get(e.pointerId);
    if (!st) return;
    pointers.delete(e.pointerId);
    endSingle(st, cancelled);
    if (pointers.size === 0) pinch = null;
  };
  canvas.addEventListener('pointerup', finish(false));
  canvas.addEventListener('pointercancel', finish(true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    setMode(next) {
      // 触れている途中の操作は、前のモードのまま取り消す
      for (const st of pointers.values()) endSingle(st, true);
      mode = next;
    },
    get mode() {
      return mode;
    },
  };
}
