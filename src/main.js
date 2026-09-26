import './style.css';
import { addPersona, listPersonas, loadTank, markOpened, saveTank } from './storage/db.js';
import { Tank } from './tank/tank.js';
import { TankRenderer } from './tank/renderer.js';
import { cleanMode, createTouchController, interactMode } from './tank/touch.js';
import { ALGAE } from './tank/algae.js';
import { renderWhoScreen } from './ui/whoScreen.js';
import { renderTankList } from './ui/tankList.js';
import { createObserveUi } from './ui/observeUi.js';
import { showError, watchErrors } from './ui/errorBox.js';

watchErrors();

const SAVE_INTERVAL = 5000; // ms
const UI_INTERVAL = 0.25; // ボタンの表示を見直す間隔(秒)

// 確認用:URL に ?days=7 をつけると、開く水槽を「7日ぶり」として扱う
const fakeDays = (() => {
  const v = new URLSearchParams(location.search).get('days');
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
})();

const canvas = document.getElementById('tank');
const overlay = document.getElementById('overlay');
const tankButton = document.getElementById('tank-button');
const cleanButton = document.getElementById('clean-button');

const renderer = new TankRenderer(canvas);
renderer.onError = (err) => showError(err, '描画');

// persona, tank, keepSaved(true のときは保存しない:読み込みに失敗した水槽の元のデータを上書きしないため)
let current = null;
let cleaning = false;
let observing = null; // 観察中の生き物

const touch = createTouchController(canvas, renderer, {
  onLongPress: (creature) => enterObserve(creature),
  onPinchOpen: (x, y) => {
    if (observing) return;
    const creature = renderer.creatureNear(x, y);
    if (creature) enterObserve(creature);
  },
  onPinchClose: () => exitObserve(),
  onScrub: scrub,
});

const observeUi = createObserveUi(document.getElementById('observe-ui'), {
  onBack: () => exitObserve(),
  onFood: (food) => {
    if (observing && current) current.tank.feed(observing, food);
    syncUi();
  },
  onDigest: () => {
    observing?.digest();
    syncUi();
  },
  onExcrete: () => {
    if (observing && current) current.tank.excrete(observing);
    syncUi();
  },
});

// seen: 今この水槽を見ていたか(見ていた時刻として残す)
async function saveCurrent(seen = document.visibilityState === 'visible') {
  if (!current || current.keepSaved) return;
  if (seen) current.tank.lastSeenAt = Date.now();
  try {
    await saveTank(current.tank.toData());
    current.tank.dirty = false;
  } catch (err) {
    showError(err, '保存');
  }
}

// 失敗しても次へ進む(水槽が開けなくならないように)。失敗したら false
async function attempt(label, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    showError(err, label);
    return false;
  }
}

async function openPersona(persona) {
  await attempt('モードを戻す', () => {
    exitObserve();
    setCleaning(false);
  });
  await saveCurrent();

  let data = null;
  let tank = null;
  let keepSaved = false;
  if (!(await attempt('読み込み', async () => (data = await loadTank(persona.id))))) keepSaved = true;
  const built = await attempt('水槽の準備', () => {
    tank = data ? Tank.fromData(data) : Tank.createNew(persona.id);
  });
  if (!built) {
    // 読めなかった水槽は、その場だけの水槽で開く。元のデータは上書きしない
    tank = Tank.createNew(persona.id);
    keepSaved = true;
  }
  if (data && built) await attempt('藻', () => tank.catchUp(Date.now(), fakeDays));

  current = { persona, tank, keepSaved };
  await saveCurrent(true);
  await attempt('開いた時刻', () => markOpened(persona.id));
  await attempt('背景の準備', () => renderer.setTank(tank));
  tankButton.textContent = `${persona.name} の水槽`;
  await attempt('ボタン', () => syncUi());
  closeOverlay();
}

// ---- 掃除モード ----
function setCleaning(on) {
  cleaning = on;
  touch.setMode(on ? cleanMode : interactMode);
  cleanButton.setAttribute('aria-pressed', String(on));
  syncUi();
}

// 画面上の (sx, sy) を、指が dist だけ動いたぶん擦る
function scrub(sx, sy, dist) {
  const tank = current?.tank;
  if (!tank) return;
  const { W, H } = renderer;
  const r = ALGAE.BRUSH * H;
  const amount = dist > 0 ? (ALGAE.ERASE_SPEED * dist) / r : 0.15; // 触れただけでも少し消える
  tank.scrub(sx / W, sy / H, r / W, r / H, amount);
  if (tank.algae.level < ALGAE.DONE_LEVEL) {
    tank.clearAlgae();
    setCleaning(false);
  }
}

cleanButton.addEventListener('click', () => setCleaning(!cleaning));

// ---- 観察モード ----
function enterObserve(creature) {
  if (!current) return;
  if (cleaning) setCleaning(false);
  observing = creature;
  current.tank.focus = creature;
  renderer.setFocus(creature);
  observeUi.show();
  syncUi();
}

function exitObserve() {
  if (!observing) return;
  observing = null;
  if (current) current.tank.focus = null;
  renderer.setFocus(null);
  observeUi.hide();
  syncUi();
}

// ボタンの出し分け
function syncUi() {
  const tank = current?.tank;
  tankButton.hidden = !tank || !!observing;
  cleanButton.hidden = !tank || !!observing || !(cleaning || tank.algae.level >= ALGAE.SHOW_LEVEL);
  if (observing) {
    observing.refreshMeal();
    observeUi.update(observing);
  }
}

let uiTimer = 0;
renderer.onFrame = (dt) => {
  uiTimer += dt;
  if (uiTimer >= UI_INTERVAL) {
    uiTimer = 0;
    syncUi();
  }
};

// ---- 画面 ----
function closeOverlay() {
  overlay.replaceChildren();
}

async function showWho({ canGoBack = false } = {}) {
  const personas = await listPersonas();
  renderWhoScreen(overlay, {
    personas,
    onPick: openPersona,
    onCreate: async (name) => openPersona(await addPersona(name)),
    onBack: canGoBack ? closeOverlay : null,
  });
}

async function showList() {
  const personas = await listPersonas();
  renderTankList(overlay, {
    personas,
    currentId: current?.persona.id,
    onPick: openPersona,
    onAdd: () => showWho({ canGoBack: true }),
    onClose: closeOverlay,
  });
}

tankButton.addEventListener('click', showList);

// iPhone の Safari で、2本指の操作が画面の拡大にならないように
document.addEventListener('gesturestart', (e) => e.preventDefault());

// 水槽の様子(位置など)は動き続けるので、一定時間ごとに保存する
setInterval(() => saveCurrent(), SAVE_INTERVAL);

// 見えていない間と、縦向きで案内を出している間は、描画を止めて電池を節約する
const portrait = window.matchMedia('(orientation: portrait)');
function updateRunning() {
  if (document.visibilityState === 'visible' && !portrait.matches) renderer.start();
  else renderer.stop();
}
portrait.addEventListener('change', updateRunning);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // 画面を離れるときは保存する(ここまで見ていた、として)
    saveCurrent(true);
  } else if (current) {
    // 読み込み直さずに戻ってきたときも、離れていた間のぶん藻を増やす
    attempt('藻', () => {
      current.tank.catchUp();
      syncUi();
    });
  }
  updateRunning();
});
window.addEventListener('pagehide', () => saveCurrent());

updateRunning();
showWho();
