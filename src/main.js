import './style.css';
import { addPersona, listPersonas, loadTank, markOpened, saveTank } from './storage/db.js';
import { Tank } from './tank/tank.js';
import { TankRenderer } from './tank/renderer.js';
import { createTouchController } from './tank/touch.js';
import { renderWhoScreen } from './ui/whoScreen.js';
import { renderTankList } from './ui/tankList.js';

const SAVE_INTERVAL = 5000; // ms

const canvas = document.getElementById('tank');
const overlay = document.getElementById('overlay');
const tankButton = document.getElementById('tank-button');

const renderer = new TankRenderer(canvas);
createTouchController(canvas, renderer);

let current = null; // { persona, tank }

async function saveCurrent() {
  if (!current) return;
  try {
    await saveTank(current.tank.toData());
    current.tank.dirty = false;
  } catch (err) {
    console.error('保存できませんでした', err);
  }
}

async function openPersona(persona) {
  await saveCurrent();
  const data = await loadTank(persona.id);
  const tank = data ? Tank.fromData(data) : Tank.createNew(persona.id);
  current = { persona, tank };
  if (!data) await saveCurrent();
  await markOpened(persona.id);
  renderer.setTank(tank);
  tankButton.textContent = `${persona.name} の水槽`;
  tankButton.hidden = false;
  closeOverlay();
}

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

// 水槽の様子(位置など)は動き続けるので、一定時間ごとに保存する
setInterval(saveCurrent, SAVE_INTERVAL);

// 見えていない間と、縦向きで案内を出している間は、描画を止めて電池を節約する
const portrait = window.matchMedia('(orientation: portrait)');
function updateRunning() {
  if (document.visibilityState === 'visible' && !portrait.matches) renderer.start();
  else renderer.stop();
}
portrait.addEventListener('change', updateRunning);

// 画面を離れるときも保存する
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveCurrent();
  updateRunning();
});
window.addEventListener('pagehide', saveCurrent);

updateRunning();
showWho();
