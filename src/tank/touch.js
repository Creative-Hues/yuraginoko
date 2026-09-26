// 水槽へのタッチ操作。
// - 弾く:短くタップ(押してから離すまで短く、ほとんど動かさない)
// - 撫でる:生き物の上を指でなぞる
//
// 後のフェーズ(観察モード・掃除など)では、setMode で操作の中身を差し替える。

const FLICK_TIME = 250; // ms
const FLICK_MOVE = 10; // px
const STROKE_FX_EVERY = 45; // 撫でている間、これだけ動くごとに波紋と泡を出す(px)

// ふつうの触れ合いモード
export const interactMode = {
  down(st, renderer) {
    st.target = renderer.hitTest(st.x, st.y);
    st.stroked = new Set();
    st.fxDist = 0;
    renderer.addRipple(st.x, st.y, st.target ? 1 : 0.6);
  },
  move(st, renderer, dist) {
    if (st.moved <= FLICK_MOVE) return;
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
  up(st, cancelled, renderer) {
    const quick = performance.now() - st.startT < FLICK_TIME && st.moved <= FLICK_MOVE;
    if (!cancelled && quick && st.target) {
      st.target.creature.flick(st.target.u);
      renderer.addBubbles(st.x, st.y, 3 + Math.floor(Math.random() * 3));
    }
    for (const c of st.stroked) c.endStroke();
  },
};

export function createTouchController(canvas, renderer) {
  const pointers = new Map();
  let mode = interactMode;

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const p = pos(e);
    const st = { ...p, startT: performance.now(), moved: 0 };
    pointers.set(e.pointerId, st);
    mode.down(st, renderer);
  });

  canvas.addEventListener('pointermove', (e) => {
    const st = pointers.get(e.pointerId);
    if (!st) return;
    const p = pos(e);
    const dist = Math.hypot(p.x - st.x, p.y - st.y);
    st.x = p.x;
    st.y = p.y;
    st.moved += dist;
    mode.move(st, renderer, dist);
  });

  const finish = (cancelled) => (e) => {
    const st = pointers.get(e.pointerId);
    if (!st) return;
    pointers.delete(e.pointerId);
    mode.up(st, cancelled, renderer);
  };
  canvas.addEventListener('pointerup', finish(false));
  canvas.addEventListener('pointercancel', finish(true));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    setMode(next) {
      pointers.clear();
      mode = next;
    },
  };
}
