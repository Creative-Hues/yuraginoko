import './style.css';
import {
  addPersona,
  addRequest,
  deleteMoment,
  deletePersona,
  deleteRequest,
  deleteSpecimens,
  deleteTank,
  exportAll,
  giveCreature,
  importAll,
  isDataEmpty,
  listAllTanks,
  listMoments,
  listPersonas,
  listRequestsFrom,
  listRequestsTo,
  listSpecimens,
  listTanks,
  loadTank,
  markHelpHintShown,
  markOpened,
  markRequestNoticed,
  pruneRequests,
  saveMoment,
  saveSpecimen,
  saveTank,
  saveTanks,
  setPersonaClosed,
  setPersonaColor,
  setPersonaSound,
  updateMoment,
  updateSpecimen,
  updateTank,
  DB_VERSION,
} from './storage/db.js';
import { backupFileName, countBackup, isEmptyCounts, makeBackup, parseBackup } from './storage/backup.js';
import { Tank } from './tank/tank.js';
import { Creature } from './creature/creature.js';
import { TANK_CAPACITY } from './creature/lifeConfig.js';
import { portrait as creaturePortrait } from './creature/portrait.js';
import { makeId } from './util/random.js';
import { TankRenderer } from './tank/renderer.js';
import { cleanMode, createTouchController, editMode, interactMode, peekMode } from './tank/touch.js';
import { ALGAE } from './tank/algae.js';
import { renderWhoScreen } from './ui/whoScreen.js';
import { renderShelf, tankLabel } from './ui/shelf.js';
import { renderHomeChoice } from './ui/homeUi.js';
import { renderSpecimenDetail, renderSpecimenList } from './ui/specimenUi.js';
import { renderTextDialog } from './ui/textDialog.js';
import { renderConfirm } from './ui/confirmUi.js';
import { renderArrivalNotice, renderAskForm, renderRequestList, renderRequestNotice } from './ui/requestUi.js';
import { photo, renderCollectionList, renderMomentDelete, renderMomentDetail } from './ui/collectionUi.js';
import { colorOf, colorPicker, el } from './ui/dom.js';
import { createObserveUi } from './ui/observeUi.js';
import { createEditUi } from './ui/editUi.js';
import { showError, watchErrors } from './ui/errorBox.js';
import { eggMood } from './tank/eggs.js';
import { nowInfluences, patternChange } from './tank/influence.js';
import { sensitivityLines } from './creature/sensitivity.js';
import { chirpPitch, normalizeSound, sound, useAmbientSession } from './audio/sound.js';
import { SOUNDS } from './audio/soundConfig.js';
import { renderSoundSettings } from './ui/soundUi.js';
import { renderBackupMenu, renderImportFailed, renderImportPreview } from './ui/backupUi.js';
import { renderHelp } from './ui/helpUi.js';

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
const editButton = document.getElementById('edit-button');
const homeButton = document.getElementById('home-button');
const requestButton = document.getElementById('request-button');
const soundButton = document.getElementById('sound-button');
const helpButton = document.getElementById('help-button');
const peekBar = document.getElementById('peek-bar');
const peekText = document.getElementById('peek-text');
const peekBack = document.getElementById('peek-back');

const renderer = new TankRenderer(canvas);
renderer.onError = (err) => showError(err, '描画');
// 卵がかえって5匹になったら、すみかを決める画面を出す(ほかの画面を開いているときは、左下のボタンだけ)
renderer.onTankEvent = (e) => {
  tankSound(e);
  // 見ていた卵がかえったら、生まれた赤ちゃんをそのまま見る
  if (e.type === 'hatch' && observingEgg && e.egg === observingEgg) enterObserve(e.creature);
  if (e.type !== 'crowded' || !current?.tank.crowded) return;
  syncUi();
  if (!overlay.hasChildNodes()) attempt('すみかを決める', () => showHome({ newborn: e.creature?.id }));
};

// 水槽で起きたことの音(交流の鳴き声・卵・食べる)
function tankSound(e) {
  if (e.type === 'meet') {
    // 2匹それぞれの声で、少しずらして
    sound.play('chirp', { x: e.a.x, pitch: chirpPitch(e.a.seed) });
    sound.play('chirp', { x: e.b.x, pitch: chirpPitch(e.b.seed), delay: SOUNDS.chirp.delay });
  } else if (e.type === 'egg' || e.type === 'hatch') {
    sound.play('sparkle', { x: e.x });
  } else if (e.type === 'eat') {
    sound.play('eat', { x: e.x });
  }
}

// 結晶ができあがった瞬間に、澄んだ音
renderer.onFarewell = (kind, c) => {
  if (kind === 'crystal') sound.play('clear', { x: c.x });
};

// persona(水槽の持ち主), tank, keepSaved(true のときは保存しない:読み込みに失敗した水槽の元のデータを上書きしないため)、
// label(水槽の表示名)、peek(ほかの人の水槽をのぞいているとき { viewer: 今の人, backTankId: もどる水槽, asked: おねがい済みの子の id })
let current = null;
let incomingCount = 0; // 今の人に届いている、まだ決めていないおねがいの数(隅のボタンを出すかどうか)

// 今の人(のぞいているときは、のぞいている人)
const me = () => current?.peek?.viewer ?? current?.persona ?? null;
// ふつうの操作(のぞいているときは、眺めるだけ)
const baseMode = () => (current?.peek ? peekMode : interactMode);
let cleaning = false;
let observing = null; // 観察中の生き物
let observingEgg = null; // 観察中の卵
let editing = false; // 環境編集モード
let plantKind = null; // 編集モードで、植えるために選んでいる種類
let selectedPlant = null; // 編集モードで、選んでいる植物
let helpHint = null; // 出ている「?から遊び方を見られます」の吹き出し

const touch = createTouchController(canvas, renderer, {
  onLongPress: (creature) => enterObserve(creature),
  onEggPress: (egg) => enterObserveEgg(egg),
  // 生き物に直接触れていなければ卵を優先し、それもなければ近い生き物
  onPinchOpen: (x, y) => {
    if (observing || observingEgg || editing) return;
    const hit = renderer.hitTest(x, y)?.creature;
    const egg = hit ? null : renderer.eggAt(x, y);
    if (egg) return enterObserveEgg(egg);
    const creature = hit ?? renderer.creatureNear(x, y);
    if (creature) enterObserve(creature);
  },
  onPinchClose: () => exitObserve(),
  onScrub: scrub,
  onScrubEnd: () => sound.scrubEnd(),
  onTouchSound: (kind, sx) => sound.play(kind, { x: sx / renderer.W }),
  // 環境編集モード
  onPlantPick: (plant) => selectPlant(plant),
  onPlantDrag: (plant, x, y) => {
    const at = renderer.unproject(x, y);
    if (at && current) current.tank.movePlant(plant, at.x, at.z);
  },
  onPlantDrop: () => syncUi(),
  onFloorTap: (x, y) => plantAt(x, y),
});

const observeUi = createObserveUi(document.getElementById('observe-ui'), {
  onBack: () => exitObserve(),
  onFood: (food) => {
    if (observing && current && current.tank.feed(observing, food)) sound.play('drop', { x: observing.x });
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
  onCare: () => {
    if (observing && !current?.peek) attempt('この子のこと', () => showHome({ selected: observing.id }));
  },
  onKeep: () => attempt('図鑑に残す', () => keepMoment()),
  onAsk: () => {
    if (observing && current?.peek) attempt('この子をもらいたい', () => showAskForm(observing));
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

// 観察・掃除・編集をやめて、ふつうの水槽に戻す
async function resetModes() {
  await attempt('モードを戻す', () => {
    exitObserve();
    setCleaning(false);
    setEditing(false);
  });
}

// その人の水槽を開く。水槽が1つならそれを、2つ以上なら棚から選ぶ。まだ無ければ作る
async function pickTank(persona) {
  let tanks = [];
  await attempt('水槽の一覧', async () => (tanks = await listTanks(persona.id)));
  if (tanks.length === 0) return openTank(persona, null);
  if (tanks.length === 1) return openTank(persona, tanks[0].id);
  return showShelf({ only: persona, title: 'どの水槽を見ますか?' });
}

// tankId の水槽を開く。null なら新しい水槽(初期の環境で、新しい2匹)を作って開く。
// notices: 開いたあとに、届いた知らせ・おねがいの知らせを出す
async function openTank(persona, tankId, { notices = true } = {}) {
  await resetModes();
  await saveCurrent();

  let data = null;
  let tank = null;
  let keepSaved = false;
  if (tankId && !(await attempt('読み込み', async () => (data = await loadTank(tankId))))) keepSaved = true;
  const built = await attempt('水槽の準備', () => {
    tank = data ? Tank.fromData(data) : Tank.createNew(persona.id, tankId ? { id: tankId } : undefined);
  });
  if (!built) {
    // 読めなかった水槽は、その場だけの水槽で開く。元のデータは上書きしない
    tank = Tank.createNew(persona.id, tankId ? { id: tankId } : undefined);
    keepSaved = true;
  }
  if (data && built) await attempt('藻', () => tank.catchUp(Date.now(), fakeDays));

  current = { persona, tank, keepSaved, label: '' };
  applySound();
  touch.setMode(interactMode);
  observeUi.setPeek(null);
  await saveCurrent(true);
  await attempt('開いた時刻', () => markOpened(persona.id));
  await attempt('背景の準備', () => renderer.setTank(tank));
  await refreshTankButton();
  await attempt('ボタン', () => syncUi());
  closeOverlay();
  if (notices) await attempt('おねがい', () => showNotices(persona));
  await refreshRequestButton();
  await attempt('遊び方の知らせ', () => maybeHelpHint(persona));
}

// ---- ほかの人の水槽をのぞく ----
// 眺める・観察で寄るだけ。のぞいている水槽は保存しない(keepSaved)。卵・繁殖・環境による変化も進めない(tank.peek)
async function peekTank(owner, tankId) {
  const viewer = me();
  if (!viewer || owner.id === viewer.id) return;
  const backTankId = current?.peek?.backTankId ?? current?.tank.id ?? null;
  const data = await loadTank(tankId);
  if (!data) return;
  await resetModes();
  await saveCurrent();
  const tank = Tank.fromData(data);
  tank.peek = true;
  tank.catchUp(); // 見た目を持ち主が開いたときと合わせる(保存はしない)
  let asked = [];
  await attempt('おねがい', async () => (asked = await listRequestsFrom(viewer.id)));
  current = {
    persona: owner,
    tank,
    keepSaved: true,
    label: '',
    peek: { viewer, backTankId, asked: new Set(asked.filter((r) => r.status === 'asked').map((r) => r.creatureId)) },
  };
  applySound();
  touch.setMode(peekMode);
  await attempt('背景の準備', () => renderer.setTank(tank));
  peekText.textContent = `${owner.name}の水槽をのぞいています`;
  incomingCount = 0;
  syncUi();
  closeOverlay();
}

// のぞくのをやめて、自分の水槽に戻る
async function endPeek() {
  const peek = current?.peek;
  if (!peek) return;
  if (peek.backTankId) await openTank(peek.viewer, peek.backTankId);
  else await pickTank(peek.viewer);
}

peekBack.addEventListener('click', () => attempt('自分の水槽にもどる', () => endPeek()));

// 観察中の子に「この子をもらいたい」を出せるか
function peekState(creature) {
  const peek = current?.peek;
  if (!peek) return null;
  return { canAsk: !current.persona.closedToRequests, asked: peek.asked.has(creature.id) };
}

// ---- おねがい ----

// 受け取る自分の水槽を選んで、おねがいを出す
async function showAskForm(c) {
  const { persona: owner, tank, peek } = current;
  const tanks = (await listTanks(peek.viewer.id)).map((t, i) => ({ id: t.id, label: tankLabel(t, i), count: t.creatures?.length ?? 0 }));
  renderAskForm(overlay, {
    ownerName: owner.name,
    creature: c.toJSON(),
    tanks,
    onCancel: closeOverlay,
    onOk: (targetTankId) =>
      attempt('おねがいする', async () => {
        await addRequest({
          fromPersonaId: peek.viewer.id,
          toPersonaId: owner.id,
          tankId: tank.id,
          creatureId: c.id,
          targetTankId,
          creature: c.toJSON(),
        });
        peek.asked.add(c.id);
        if (observing === c) observeUi.setPeek(peekState(c));
        closeOverlay();
        syncUi();
      }),
  });
}

// 隅の控えめなボタン:まだ決めていない、届いているおねがいがあるときだけ
async function refreshRequestButton() {
  incomingCount = 0;
  if (current && !current.peek) {
    await attempt('おねがい', async () => {
      await pruneRequests();
      incomingCount = (await listRequestsTo(current.persona.id)).filter((r) => r.status === 'asked').length;
    });
  }
  syncUi();
}

requestButton.addEventListener('click', () => {
  if (current && !current.peek) attempt('おねがい', () => showRequests(current.persona, closeOverlay));
});

// 名前を引くための一覧
async function personaNames() {
  const personas = await listPersonas();
  return { personas, name: (id) => personas.find((p) => p.id === id)?.name ?? '' };
}

// おねがいの一覧(出したもの・届いているもの・受け付けるかどうか)
async function showRequests(persona, back) {
  await pruneRequests();
  const { personas, name } = await personaNames();
  const self = personas.find((p) => p.id === persona.id) ?? persona;
  const tanks = await listTanks(persona.id);
  const label = (id) => {
    const i = tanks.findIndex((t) => t.id === id);
    return i < 0 ? '新しい水槽' : tankLabel(tanks[i], i);
  };
  const incoming = (await listRequestsTo(persona.id)).filter((r) => r.status === 'asked');
  const outgoing = (await listRequestsFrom(persona.id)).filter((r) => r.status === 'asked');
  // 一覧で見たものは、もう知らせとしては出さない
  for (const r of incoming) if (!r.noticedAt) await markRequestNoticed(r.id);
  const again = () => attempt('おねがい', () => showRequests(persona, back));
  renderRequestList(overlay, {
    persona: self,
    closed: !!self.closedToRequests,
    incoming: incoming.map((r) => ({ request: r, fromName: name(r.fromPersonaId) })),
    outgoing: outgoing.map((r) => ({ request: r, ownerName: name(r.toPersonaId), targetLabel: label(r.targetTankId) })),
    onWithdraw: (r) =>
      attempt('取り消す', async () => {
        await deleteRequest(r.id);
        await again();
      }),
    onGive: (r) => attempt('あげる', () => give(r)),
    onNotNow: (r) =>
      attempt('今はやめておく', async () => {
        await deleteRequest(r.id);
        await refreshRequestButton();
        await again();
      }),
    onSetClosed: (on) =>
      attempt('おねがいの設定', async () => {
        await setPersonaClosed(persona.id, on);
        if (current?.persona.id === persona.id) current.persona.closedToRequests = !!on;
        await again();
      }),
    onBack: back,
  });
}

// 水槽を開いたときの知らせ。届いたもの(おねがいした人へ)を先に、次にまだ知らせていないおねがい(持ち主へ)。
// どれも1回だけ出す(あとは隅のボタンや棚の「おねがい」から見られる)
async function showNotices(persona) {
  if (!current || current.peek || current.persona.id !== persona.id) return;
  await pruneRequests();
  const { name } = await personaNames();
  const next = () => attempt('おねがい', () => showNotices(persona));
  const done = async () => {
    closeOverlay();
    await next();
  };

  const arrived = (await listRequestsFrom(persona.id)).find((r) => r.status === 'given');
  if (arrived) {
    await deleteRequest(arrived.id);
    const tanks = await listTanks(persona.id);
    const i = tanks.findIndex((t) => t.id === arrived.arrivedTankId);
    renderArrivalNotice(overlay, {
      request: arrived,
      ownerName: name(arrived.toPersonaId),
      tankLabel: i < 0 ? '' : tankLabel(tanks[i], i),
      onClose: done,
      onVisit: i < 0 ? null : () => attempt('見に行く', () => visitArrived(persona, arrived)),
    });
    return;
  }

  const fresh = (await listRequestsTo(persona.id)).find((r) => r.status === 'asked' && !r.noticedAt);
  if (!fresh) return;
  await markRequestNoticed(fresh.id);
  renderRequestNotice(overlay, {
    request: fresh,
    fromName: name(fresh.fromPersonaId),
    onGive: () => attempt('あげる', () => give(fresh)),
    onNotNow: () =>
      attempt('今はやめておく', async () => {
        await deleteRequest(fresh.id);
        await refreshRequestButton();
        await done();
      }),
    onLater: done,
  });
}

// 届いた子を見に行く。その水槽が5匹なら、すみかを決める画面(その子を選んだ状態で)
async function visitArrived(persona, request) {
  if (current?.tank.id !== request.arrivedTankId) await openTank(persona, request.arrivedTankId, { notices: false });
  closeOverlay();
  if (current.tank.crowded) return showHome({ selected: request.creatureId, arrived: request.creatureId });
  const c = current.tank.creatures.find((x) => x.id === request.creatureId);
  if (c) enterObserve(c);
}

// あげる:その子を、おねがいした人の水槽へ引っ越させる(移すときと同じ泡)。遺伝子・親の記録などはそのまま
async function give(request) {
  if (!current || current.peek || current.persona.id !== request.toPersonaId) return;
  const owner = current.persona;
  if (current.tank.id !== request.tankId) await openTank(owner, request.tankId, { notices: false });
  const { tank } = current;
  const c = tank.creatures.find((x) => x.id === request.creatureId);
  if (!c || current.keepSaved) {
    closeOverlay();
    await refreshRequestButton();
    return;
  }
  let target = null;
  if (request.targetTankId) {
    const data = await loadTank(request.targetTankId);
    if (data?.personaId === request.fromPersonaId) target = Tank.fromData(data);
  }
  target ??= Tank.createEmpty(request.fromPersonaId);
  await sendAway(c, target, (targetData) => giveCreature([tank.toData(), targetData], { ...request, creature: c.toJSON() }, target.id));
  await refreshRequestButton();
}

// 左上のボタン:「〈人〉の水槽」。水槽が2つ以上か名前があれば「〈人〉・〈水槽の名前〉」
async function refreshTankButton() {
  if (!current) return;
  const { persona, tank } = current;
  let tanks = [];
  await attempt('水槽の一覧', async () => (tanks = await listTanks(persona.id)));
  const index = Math.max(0, tanks.findIndex((t) => t.id === tank.id));
  current.label = tankLabel(tank, index);
  tankButton.replaceChildren(
    el('span', { class: 'pill-main', text: tanks.length > 1 || tank.name ? `${persona.name}・${current.label}` : `${persona.name}の水槽` }),
    el('span', { class: 'pill-sub', text: 'たなを開く' }),
  );
}

// ---- 掃除モード ----
function setCleaning(on) {
  if (on && editing) setEditing(false);
  cleaning = on;
  touch.setMode(on ? cleanMode : baseMode());
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
  const changed = tank.scrub(sx / W, sy / H, r / W, r / H, amount);
  if (dist > 0) sound.scrubbing(dist, sx / W);
  // 見える藻がすべてなくなったら、見えないほど薄い残りも消して、掃除を終える
  if (changed && !tank.algae.hasVisible()) {
    tank.clearAlgae();
    sound.scrubEnd();
    setCleaning(false);
  }
}

cleanButton.addEventListener('click', () => setCleaning(!cleaning));

// ---- 環境編集モード ----
function setEditing(on) {
  if (on && cleaning) setCleaning(false);
  editing = on;
  plantKind = null;
  selectPlant(null);
  touch.setMode(on ? editMode : baseMode());
  editButton.setAttribute('aria-pressed', String(on));
  if (on) editUi.show();
  else editUi.hide();
  syncUi();
}

function selectPlant(plant) {
  selectedPlant = plant;
  renderer.selectedPlant = plant;
  syncUi();
}

// 砂の上をタップ:選んでいる種類があれば植える。なければ、選んでいる植物を外す
function plantAt(x, y) {
  const tank = current?.tank;
  if (!tank) return;
  const at = renderer.unproject(x, y);
  const p = plantKind && at ? tank.plant(plantKind, at.x, at.z) : null;
  if (p) {
    const pos = renderer.project(p.x, p.z);
    renderer.addBubbles(pos.x, pos.floorY - 6, 3);
  }
  selectPlant(null);
}

// 環境を変えた:背景を描き直して、ボタンを合わせる
function changeEnv(patch) {
  if (!current) return;
  current.tank.setEnv(patch);
  renderer.envChanged();
  syncUi();
}

const editUi = createEditUi(document.getElementById('edit-ui'), {
  onKind: (kind) => {
    plantKind = plantKind === kind ? null : kind;
    syncUi();
  },
  onRemove: () => {
    if (current && selectedPlant) current.tank.removePlant(selectedPlant);
    selectPlant(null);
  },
  onSoil: (soil) => changeEnv({ soil }),
  onLightColor: (color) => changeEnv({ light: { color } }),
  onBrightness: (brightness) => changeEnv({ light: { brightness } }),
  onStrength: (strength) => changeEnv({ current: { strength } }),
  onDir: (dir) => changeEnv({ current: { dir } }),
});

editButton.addEventListener('click', () => {
  setEditing(!editing);
  if (!editing) saveCurrent();
});

// ---- 観察モード ----
function enterObserve(creature) {
  if (!current) return;
  if (cleaning) setCleaning(false);
  if (editing) setEditing(false);
  observingEgg = null;
  observing = creature;
  current.tank.focus = creature;
  renderer.setFocus(creature);
  observeUi.setPeek(peekState(creature));
  observeUi.show();
  syncUi();
}

// 卵を見る:少し寄って「たまご」と、ようすの一言
function enterObserveEgg(egg) {
  if (!current) return;
  if (cleaning) setCleaning(false);
  if (editing) setEditing(false);
  observing = null;
  observingEgg = egg;
  current.tank.focus = null;
  renderer.setFocusEgg(egg);
  observeUi.show();
  syncUi();
}

function exitObserve() {
  if (!observing && !observingEgg) return;
  if (observingEgg) {
    observingEgg = null;
    renderer.setFocusEgg(null);
    observeUi.hide();
    syncUi();
    return;
  }
  observing = null;
  if (current) current.tank.focus = null;
  renderer.setFocus(null);
  observeUi.hide();
  syncUi();
}

// ボタンの出し分け
function syncUi() {
  const tank = current?.tank;
  const watching = !!observing || !!observingEgg;
  const peeking = !!current?.peek; // のぞいているときは、眺める・寄るだけ
  tankButton.hidden = !tank || watching || editing || peeking;
  peekBar.hidden = !peeking || watching;
  homeButton.hidden = !tank?.crowded || watching || editing || cleaning || peeking;
  requestButton.hidden = !tank || !incomingCount || watching || editing || cleaning || peeking;
  cleanButton.hidden = !tank || watching || editing || peeking; // 藻の量に関係なく、いつでも掃除できる
  editButton.hidden = !tank || watching || peeking;
  soundButton.hidden = !tank || watching || editing;
  helpButton.hidden = !tank || watching || editing || peeking;
  if (helpButton.hidden || overlay.hasChildNodes()) hideHelpHint(); // ほかの画面を開いたら、吹き出しはしまう
  const on = String(!!me() && normalizeSound(me().sound).on);
  if (soundButton.getAttribute('aria-pressed') !== on) soundButton.setAttribute('aria-pressed', on);
  if (editing && tank) {
    // 抜かれた植物は選ばない
    if (selectedPlant && !tank.plants.list.includes(selectedPlant)) selectPlant(null);
    editUi.update({ env: tank.env, plantCount: tank.plants.count, kind: plantKind, selected: selectedPlant });
  }
  if (observing && tank) {
    observing.refreshMeal();
    observeUi.update(observing, {
      now: nowInfluences(observing, tank.env, tank.plants.list),
      pattern: patternChange(observing, tank.env, tank.plants.list),
      ready: tank.readyToBreed(observing),
      sensitivity: sensitivityLines(observing.sensitivity),
    });
  }
  if (observingEgg) {
    // かえった卵は、赤ちゃんの観察に切り替わっている(念のため、見つからなければ戻る)
    if (!tank?.eggs.list.includes(observingEgg)) exitObserve();
    else observeUi.updateEgg(eggMood(observingEgg));
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
    onPick: (p) => attempt('水槽をひらく', () => pickTank(p)),
    onCreate: (name, color) => attempt('水槽をひらく', async () => pickTank(await addPersona(name, color))),
    onBack: canGoBack ? closeOverlay : null,
    onBackup: () => attempt('データの書き出し・読み込み', () => showBackup(() => showWho({ canGoBack }))),
  });
}

// ---- 水槽の棚 ----
// only: その人の棚だけを出す(「今は誰?」で水槽が2つ以上あったとき)。
// viewer: 今の人(開いている水槽を消したあとなど、水槽を開いていないとき)
const SHELF_LEAD = '水槽の切り替え・図鑑・標本・やりとりは、ここから。';

async function showShelf({ only = null, title, viewer: who = null } = {}) {
  await saveCurrent();
  const personas = await listPersonas();
  const tanks = await listAllTanks();
  const viewer = only ?? who ?? me();
  const own = (persona) => persona.id === viewer?.id;
  const groups = personas
    .map((persona, index) => ({ persona, index, tanks: tanks.filter((t) => t.personaId === persona.id) }))
    .filter((g) => (only ? g.persona.id === only.id : g.tanks.length > 0 || g.persona.id === viewer?.id));
  const again = () => showShelf({ only, title, viewer: who });
  renderShelf(overlay, {
    title,
    lead: SHELF_LEAD,
    groups,
    viewerId: viewer?.id,
    currentTankId: current?.tank.id,
    onOpen: (persona, rec) => attempt('水槽をひらく', () => openTank(persona, rec.id)),
    onPeek: (persona, rec) => attempt('のぞく', () => peekTank(persona, rec.id)),
    onRequests: (persona) => attempt('おねがい', () => showRequests(persona, again)),
    onAddTank: (persona) =>
      attempt('水槽をふやす', async () => {
        const tank = Tank.createNew(persona.id);
        await saveTank(tank.toData());
        await openTank(persona, tank.id);
      }),
    onRename: (persona, rec, index) => showTankSettings(persona, rec, index, again),
    onColor: (persona, index) => showColor(persona, index, again),
    onSound: (persona) => showSoundSettings(persona, again),
    onDeletePersona: (persona) => confirmDeletePersona(persona, again),
    onSpecimens: (persona) => attempt('標本', () => showSpecimens(persona, again, own(persona))),
    onCollection: (persona) => attempt('図鑑', () => showCollection(persona, again, own(persona))),
    onOther: () => showWho({ canGoBack: !!current }),
    onBackup: () => attempt('データの書き出し・読み込み', () => showBackup(again)),
    onHelp: () => showHelp(again),
    onClose: current ? closeOverlay : null,
  });
}

// 水槽の名前と設定(繁殖する・しない)。いちばん下に「この水槽を消す」
function showTankSettings(persona, rec, index, back) {
  const open = current && !current.peek && current.tank.id === rec.id;
  let noBreed = open ? current.tank.noBreed : rec.noBreed === true;
  const choices = [
    { on: false, label: 'する' },
    { on: true, label: 'しない' },
  ].map((o) =>
    el('button', {
      class: 'chip',
      type: 'button',
      text: o.label,
      onclick: () => {
        noBreed = o.on;
        sync();
      },
    }),
  );
  const sync = () => [false, true].forEach((on, i) => choices[i].setAttribute('aria-pressed', String(on === noBreed)));
  sync();
  renderTextDialog(overlay, {
    title: '水槽の名前と設定',
    fields: [{ key: 'name', label: '名前', value: rec.name ?? '', placeholder: tankLabel({}, index) }],
    extra: el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: '繁殖' }),
      el('div', { class: 'chip-row' }, choices),
      el('p', { class: 'quiet', text: 'しないにしても、交流はふつうにします。今ある卵は、そのままかえります。' }),
    ]),
    after: el('div', { class: 'row' }, [
      el('button', { class: 'quiet-btn', type: 'button', text: 'この水槽を消す', onclick: () => confirmDeleteTank(persona, rec, index, back) }),
    ]),
    onCancel: back,
    onOk: ({ name }) =>
      attempt('名前と設定', async () => {
        // 開いている水槽は、中も変える(次の保存で元に戻らないように)
        if (open && current?.tank.id === rec.id) {
          current.tank.name = name;
          current.tank.setNoBreed(noBreed);
          await saveCurrent();
        } else {
          await updateTank(rec.id, { name, noBreed });
        }
        await refreshTankButton();
        await back();
      }),
  });
}

// 開いている水槽を画面から外す(消したとき)
async function closeCurrent() {
  await resetModes();
  current = null;
  incomingCount = 0;
  applySound();
  renderer.setTank(null);
  syncUi();
}

// 水槽を消す(確認1回)。今開いている水槽なら、画面から外して棚に戻る
function confirmDeleteTank(persona, rec, index, back) {
  const open = current && !current.peek && current.tank.id === rec.id;
  const creatures = open ? current.tank.creatures.length : (rec.creatures?.length ?? 0);
  const eggs = open ? current.tank.eggs.count : (rec.eggs?.length ?? 0);
  const label = tankLabel(rec, index);
  const inside = [creatures ? `中の${creatures}匹` : '', eggs ? `たまご${eggs}個` : ''].filter(Boolean).join('と');
  renderConfirm(overlay, {
    title: '水槽を消す',
    lines: [`「${label}」を消しますか?`, inside ? `${inside}も、いっしょに消えます。` : ''].filter(Boolean),
    onCancel: () => showTankSettings(persona, rec, index, back),
    onOk: () =>
      attempt('水槽を消す', async () => {
        if (open) await closeCurrent();
        await deleteTank(rec.id);
        if (open) return showShelf({ viewer: persona });
        await refreshTankButton();
        await refreshRequestButton();
        await back();
      }),
  });
}

// 3(a). 名前を消す(確認2回)。消したら「今は誰?」へ
function confirmDeletePersona(persona, back) {
  renderConfirm(overlay, {
    title: '名前を消す',
    lines: [`「${persona.name}」を消しますか?`],
    okText: 'つぎへ',
    onCancel: back,
    onOk: () =>
      renderConfirm(overlay, {
        title: '名前を消す',
        lines: [`${persona.name}の水槽・図鑑・標本と、やりとりのおねがいが、すべて消えます。`, 'それでも消しますか?'],
        okText: 'すべて消す',
        onCancel: back,
        onOk: () =>
          attempt('名前を消す', async () => {
            if (current?.persona.id === persona.id || current?.peek?.viewer.id === persona.id) await closeCurrent();
            await deletePersona(persona.id);
            await showWho({ canGoBack: !!current });
          }),
      }),
  });
}

// 5. 名前の色を変える
function showColor(persona, index, back) {
  let color = colorOf(persona, index);
  const sample = el('span', { class: 'shelf-name', text: `${persona.name}の水槽`, style: { background: color } });
  renderConfirm(overlay, {
    title: '名前の色',
    lead: el('div', { class: 'color-dialog' }, [
      sample,
      colorPicker(color, (c) => {
        color = c;
        sample.style.background = c;
      }),
    ]),
    okText: 'きめる',
    cancelText: 'もどる',
    onCancel: back,
    onOk: () =>
      attempt('名前の色', async () => {
        await setPersonaColor(persona.id, color);
        if (current?.persona.id === persona.id) current.persona.color = color;
        await back();
      }),
  });
}

// ---- 遊び方 ----

function showHelp(back) {
  renderHelp(overlay, { onBack: back });
}

// 水槽の「?」。押したら、もう吹き出しで知らせない
helpButton.addEventListener('click', () => {
  hideHelpHint();
  const who = current && !current.peek ? current.persona : null;
  if (who && !who.helpHintShown) {
    who.helpHintShown = true;
    attempt('遊び方の知らせ', () => markHelpHintShown(who.id));
  }
  showHelp(closeOverlay);
});

const HELP_HINT_MS = 6500; // 吹き出しが自然に消えるまで(CSS のアニメーションと同じ長さ)

function hideHelpHint() {
  helpHint?.remove();
  helpHint = null;
}

// 初めて水槽を開いた人にだけ、一度だけ「?」の場所を控えめに知らせる(人ごとに覚える)。
// ほかの知らせが出ているときは、次に開いたときに回す
async function maybeHelpHint(persona) {
  if (!current || current.peek || current.persona.id !== persona.id) return;
  if (persona.helpHintShown || overlay.hasChildNodes() || helpButton.hidden) return;
  persona.helpHintShown = true;
  await markHelpHintShown(persona.id);
  hideHelpHint();
  const hint = el('div', { class: 'help-hint', role: 'status', text: '?から遊び方を見られます' });
  helpHint = hint;
  document.body.append(hint);
  setTimeout(() => {
    if (helpHint === hint) hideHelpHint();
  }, HELP_HINT_MS);
}

// ---- 音(人ごと。最初は音なし) ----

// 今の人(のぞいているときは、のぞいている人)の設定で鳴らす。水槽を開いていなければ鳴らさない
function applySound() {
  const who = me();
  sound.setSettings(who ? who.sound : null);
}

// 今の人の設定を変えて保存する(画面の中の人の記録も合わせる)
async function saveSound(persona, next) {
  const saved = await setPersonaSound(persona.id, normalizeSound(next));
  for (const p of [current?.persona, current?.peek?.viewer]) if (p?.id === persona.id) p.sound = saved?.sound ?? next;
  persona.sound = saved?.sound ?? next;
}

// 右上のボタン:音のオン・オフだけ
soundButton.addEventListener('click', () => {
  const who = me();
  if (!who) return;
  const next = { ...normalizeSound(who.sound), on: !normalizeSound(who.sound).on };
  who.sound = next;
  applySound();
  sound.gesture(); // 押したこと自体を、最初のタップとして使う
  syncUi();
  attempt('音の設定', () => saveSound(who, next));
});

// 棚の「音」:鳴らす・鳴らさないと、2つの音量。動かしている間はその場で聞こえ方が変わる(今の人のときだけ)
function showSoundSettings(persona, back) {
  const before = normalizeSound(persona.sound);
  const live = () => me()?.id === persona.id;
  const preview = (s) => {
    if (!live()) return;
    sound.setSettings(s);
    sound.gesture();
  };
  renderSoundSettings(overlay, {
    persona,
    sound: before,
    ambientOk: useAmbientSession(),
    status: () => sound.status(),
    onChange: preview,
    onCancel: () => {
      if (live()) applySound();
      back();
    },
    onOk: (next) =>
      attempt('音の設定', async () => {
        await saveSound(persona, next);
        if (live()) applySound();
        syncUi();
        await back();
      }),
  });
}

// ---- データの書き出し・読み込み ----

// 開いたときに書き出すファイルを先に作っておく(iPhone では、押してすぐでないと共有シートが開かないことがあるため)
async function showBackup(back) {
  await saveCurrent(); // 開いている水槽の今の様子も入れる
  const stores = await exportAll();
  const counts = countBackup(stores);
  const json = JSON.stringify(makeBackup(stores, { dbVersion: DB_VERSION }));
  const file = new File([json], backupFileName(), { type: 'application/json' });
  const again = () => attempt('データの書き出し・読み込み', () => showBackup(back));
  renderBackupMenu(overlay, {
    counts,
    empty: isEmptyCounts(counts),
    onExport: () => attempt('書き出す', () => shareFile(file)),
    onPickFile: (f) => attempt('読み込む', () => previewImport(f, again)),
    onBack: back,
  });
}

// 共有シート(「ファイルに保存」)で渡す。使えなければダウンロード。共有をやめたときは何もしない
async function shareFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      // 共有できなかったときは、ダウンロードで
    }
  }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ファイルの中身を確かめてから見せる。読めないファイルなら、今のデータには何もしない
async function previewImport(file, back) {
  let parsed = { ok: false };
  try {
    parsed = parseBackup(await file.text());
  } catch {
    // 読めないファイル
  }
  if (!parsed.ok) return renderImportFailed(overlay, { onBack: back });
  const empty = await isDataEmpty();
  const preview = () =>
    renderImportPreview(overlay, {
      counts: parsed.counts,
      empty,
      onImport: () => attempt('読み込む', () => runImport(parsed.data, 'merge')),
      onAdd: () => attempt('読み込む', () => runImport(parsed.data, 'merge')),
      onReplace: () =>
        renderConfirm(overlay, {
          title: '今のデータと入れかえる',
          lines: ['今のデータは、このファイルの中身に入れかわります。'],
          okText: '入れかえる',
          cancelText: 'もどる',
          onCancel: preview,
          onOk: () => attempt('読み込む', () => runImport(parsed.data, 'replace')),
        }),
      onCancel: back,
    });
  preview();
}

// 読み込んで「今は誰?」へ。開いている水槽は先に保存して画面から外す(古い水槽を書き戻さないように)。
// 読み込みは1つのトランザクションなので、失敗したときは今のデータのまま
async function runImport(data, mode) {
  await saveCurrent();
  await closeCurrent();
  try {
    await importAll(data, mode);
  } catch (err) {
    console.error('読み込み', err);
    return renderImportFailed(overlay, { onBack: () => attempt('今は誰?', () => showWho()) });
  }
  await showWho();
}

// ---- 標本 ----
// own: 自分の標本(なおす・えらんで消す)。selected: えらぶモードで開く(確認から戻ったとき)
async function showSpecimens(persona, back, own, selected = null) {
  const specimens = await listSpecimens(persona.id);
  const again = (ids = null) => attempt('標本', () => showSpecimens(persona, back, own, ids));
  renderSpecimenList(overlay, {
    persona,
    specimens,
    selecting: !!selected,
    selected: selected ?? [],
    onOpen: (s) => showSpecimen(s, () => again(), own),
    onDelete: own
      ? (ids) =>
          renderConfirm(overlay, {
            title: '標本を消す',
            lines: [`えらんだ${ids.length}個の標本を消しますか?`],
            onCancel: () => again(ids),
            onOk: () =>
              attempt('標本を消す', async () => {
                await deleteSpecimens(ids);
                await again();
              }),
          })
      : null,
    onBack: back,
  });
}

function showSpecimen(specimen, back, own) {
  renderSpecimenDetail(overlay, {
    specimen,
    onBack: back,
    onEdit: !own
      ? null
      : () =>
        renderTextDialog(overlay, {
          title: '名前と説明',
          fields: [
            { key: 'name', label: '名前', value: specimen.name },
            { key: 'note', label: '説明', value: specimen.note, multiline: true },
          ],
          onCancel: () => showSpecimen(specimen, back, own),
          onOk: (values) =>
            attempt('名前と説明', async () => {
              const next = (await updateSpecimen(specimen.id, values)) ?? specimen;
              showSpecimen(next, back, own);
            }),
        }),
  });
}

// ---- 図鑑に残す(その瞬間の姿を写す。生き物は水槽にいたまま) ----
const SNAP_WAIT = 900; // 光が引いてから、名前とメモの画面を出すまで(ms)
let keeping = false; // 光っている間は、もう一度押しても重ねない

// 写真を撮ったような、静かな光と、澄んだ短い音(振動なし)
function snapLight() {
  const light = el('div', { class: 'snap-light', 'aria-hidden': 'true' });
  sound.play('clear');
  document.body.append(light);
  setTimeout(() => light.remove(), 2000);
  return new Promise((resolve) => setTimeout(resolve, SNAP_WAIT));
}

// 押した瞬間の姿(揺らぎを含めた見た目も)を写し、名前とメモをつけて図鑑に残す。生き物は水槽にいたまま
async function keepMoment() {
  if (!observing || !current || current.peek || keeping) return;
  const c = observing;
  const { persona, tank } = current;
  const moment = {
    id: makeId(),
    personaId: persona.id,
    tankId: tank.id,
    tankLabel: current.label, // 水槽が見つからないときの控え
    creatureId: c.id,
    name: '',
    note: '',
    takenAt: Date.now(),
    creature: c.toJSON(),
    look: { ...c.expressed },
  };
  keeping = true;
  try {
    await snapLight();
  } finally {
    keeping = false;
  }
  renderTextDialog(overlay, {
    title: '図鑑に残す',
    lead: el('div', {}, [
      photo(moment, 240, 160, 'lead').frame,
      el('p', { class: 'lead-note', text: '今の姿を写真のように図鑑に残します。この子はこのまま水槽で暮らし続けます。' }),
    ]),
    fields: [
      { key: 'name', label: '名前(なくてもだいじょうぶ)', value: '' },
      { key: 'note', label: 'メモ(なくてもだいじょうぶ)', value: '', multiline: true },
    ],
    okText: '図鑑に残す',
    cancelText: 'やめる',
    onCancel: closeOverlay,
    onOk: ({ name, note }) =>
      attempt('図鑑に残す', async () => {
        await saveMoment({ ...moment, name, note });
        closeOverlay();
        syncUi();
      }),
  });
}

// own: 自分の図鑑(なおす・図鑑から消す)
async function showCollection(persona, back, own) {
  const moments = await listMoments(persona.id);
  const tanks = (await listTanks(persona.id)).map((t, i) => ({ id: t.id, label: tankLabel(t, i), creatures: t.creatures ?? [] }));
  const again = () => attempt('図鑑', () => showCollection(persona, back, own));
  renderCollectionList(overlay, {
    persona,
    moments,
    tanks,
    onOpen: (m) => attempt('図鑑', () => showMoment(m, persona, tanks, again, own)),
    onBack: back,
  });
}

// 元の子が今いる水槽の id(標本になった子など、どこにもいなければ null)。ほかの水槽へ移った子も探す
function findCreatureTank(personaId, creatureId, tanks) {
  if (current?.persona.id === personaId && current.tank.creatures.some((c) => c.id === creatureId)) return current.tank.id;
  const t = tanks.find((x) => x.id !== current?.tank.id && x.creatures.some((c) => c.id === creatureId));
  return t?.id ?? null;
}

function showMoment(moment, persona, tanks, back, own) {
  const tankId = findCreatureTank(persona.id, moment.creatureId, tanks);
  renderMomentDetail(overlay, {
    moment,
    tankLabel: tanks.find((t) => t.id === moment.tankId)?.label ?? moment.tankLabel,
    onBack: back,
    onVisit: tankId ? () => attempt('今の姿を見に行く', () => visitCreature(persona, tankId, moment.creatureId)) : null,
    onEdit: !own
      ? null
      : () =>
        renderTextDialog(overlay, {
          title: '名前とメモ',
          fields: [
            { key: 'name', label: '名前', value: moment.name },
            { key: 'note', label: 'メモ', value: moment.note, multiline: true },
          ],
          onCancel: () => showMoment(moment, persona, tanks, back, own),
          onOk: (values) =>
            attempt('名前とメモ', async () => {
              const next = (await updateMoment(moment.id, values)) ?? moment;
              showMoment(next, persona, tanks, back, own);
            }),
        }),
    onDelete: !own
      ? null
      : () =>
        renderMomentDelete(overlay, {
          moment,
          onCancel: () => showMoment(moment, persona, tanks, back, own),
          onOk: () =>
            attempt('図鑑から消す', async () => {
              await deleteMoment(moment.id);
              await back();
            }),
        }),
  });
}

// その子のいる水槽を開いて、観察モードで見る(ほかの人の水槽なら、のぞく)
async function visitCreature(persona, tankId, creatureId) {
  const viewer = me();
  if (viewer && persona.id !== viewer.id) {
    if (current?.tank.id !== tankId) await peekTank(persona, tankId);
  } else if (current?.tank.id !== tankId || current?.peek) {
    await openTank(persona, tankId);
  }
  closeOverlay();
  const c = current?.tank.creatures.find((x) => x.id === creatureId);
  if (c) enterObserve(c);
}

// ---- すみかを決める(標本にする・別の水槽へ移す) ----
// selected: 最初から選んでおく子の id、newborn: 生まれたばかりの子の id、arrived: ほかの人から届いたばかりの子の id
async function showHome({ selected = null, newborn = null, arrived = null } = {}) {
  if (!current) return;
  await resetModes();
  const { persona, tank } = current;
  // 移せる水槽:同じ人の、空きがある水槽(卵がかえるぶんも数える)
  const targets = [];
  for (const [i, t] of (await listTanks(persona.id)).entries()) {
    if (t.id === tank.id) continue;
    if ((t.creatures?.length ?? 0) + (t.eggs?.length ?? 0) < TANK_CAPACITY) targets.push({ id: t.id, label: tankLabel(t, i) });
  }
  renderHomeChoice(overlay, {
    creatures: tank.creatures.map((c) => ({
      id: c.id,
      data: c.toJSON(),
      badge: c.id === newborn ? '生まれたばかり' : c.id === arrived ? '届いたばかり' : null,
    })),
    selectedId: selected,
    targets,
    crowded: tank.crowded,
    onSpecimen: (id) => showSpecimenForm(id, () => showHome({ selected: id, newborn, arrived })),
    onNewTank: (id) => attempt('新しい水槽へ', () => moveCreature(id, null)),
    onMove: (id, tankId) => attempt('別の水槽へ', () => moveCreature(id, tankId)),
    onLater: () => {
      closeOverlay();
      syncUi();
    },
  });
}

function showSpecimenForm(id, back) {
  const c = current?.tank.creatures.find((x) => x.id === id);
  if (!c) return back();
  const url = creaturePortrait(c.toJSON(), 240, 160);
  renderTextDialog(overlay, {
    title: '標本にする',
    lead: el('div', {}, [
      el('div', { class: 'crystal lead' }, [url ? el('img', { class: 'pic', src: url, alt: '' }) : null, el('span', { class: 'crystal-light' })]),
      el('p', { class: 'lead-note', text: '水槽から離れて、結晶の中で今の姿のまま残ります。' }),
    ]),
    fields: [
      { key: 'name', label: '名前(なくてもだいじょうぶ)', value: '' },
      { key: 'note', label: '説明(なくてもだいじょうぶ)', value: '', multiline: true },
    ],
    okText: '標本にする',
    onCancel: back,
    onOk: ({ name, note }) => attempt('標本にする', () => makeSpecimen(c, name, note)),
  });
}

// 標本にする:その瞬間の姿を写して保存し、水槽から外す。光に包まれて、結晶の中に収まる
async function makeSpecimen(c, name, note) {
  const { persona, tank } = current;
  if (!tank.creatures.includes(c)) return;
  const specimen = { id: makeId(), personaId: persona.id, tankId: tank.id, name, note, madeAt: Date.now(), creature: c.toJSON() };
  tank.removeCreature(c);
  await saveSpecimen(specimen, current.keepSaved ? null : tank.toData());
  renderer.farewells.add(c, 'crystal');
  closeOverlay();
  await refreshRequestButton(); // 標本になった子へのおねがいは消える
}

// 別の水槽へ移す。tankId が null なら、新しい水槽(初期の環境で、この子だけ)を作る
async function moveCreature(id, tankId) {
  const { persona, tank } = current;
  const c = tank.creatures.find((x) => x.id === id);
  if (!c) return;
  let target;
  if (tankId) {
    const data = await loadTank(tankId);
    if (!data) return;
    target = Tank.fromData(data);
  } else {
    target = Tank.createEmpty(persona.id);
  }
  await sendAway(c, target, (targetData) => saveTanks(current.keepSaved ? [targetData] : [tank.toData(), targetData]));
  await refreshRequestButton(); // ほかの水槽に移った子へのおねがいは消える
}

// 今の水槽の子 c を target へ引っ越させる(泡に包まれて昇る)。遺伝子・特徴遺伝子・受けやすさ・親の記録はそのまま。
// save(targetData) で保存する(今の水槽からは、もう外してある)
async function sendAway(c, target, save) {
  target.addCreature(new Creature(c.toJSON()));
  current.tank.removeCreature(c);
  await save(target.toData());
  renderer.farewells.add(c, 'move');
  closeOverlay();
  await refreshTankButton();
  syncUi();
}

homeButton.addEventListener('click', () => attempt('すみかを決める', () => showHome()));
tankButton.addEventListener('click', () => attempt('水槽の棚', () => showShelf()));

// iPhone の Safari で、2本指の操作が画面の拡大にならないように
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ダブルタップでの拡大も止める(CSS の touch-action が効かないときの念のため)。
// 水槽のキャンバスと入力欄はそのまま。2回目のタップだけを止めるので、1回目のボタンは押せる
const DOUBLE_TAP_MS = 350;
let lastTapEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    if (e.target === canvas || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const now = performance.now();
    if (now - lastTapEnd < DOUBLE_TAP_MS && e.cancelable) e.preventDefault();
    lastTapEnd = now;
  },
  { passive: false },
);

// 水槽の様子(位置など)は動き続けるので、一定時間ごとに保存する
setInterval(() => saveCurrent(), SAVE_INTERVAL);

// 見えていない間と、縦向きで案内を出している間は、描画と音を止めて電池を節約する
const portrait = window.matchMedia('(orientation: portrait)');
function updateRunning() {
  if (document.visibilityState === 'visible' && !portrait.matches) {
    renderer.start();
    sound.resume();
  } else {
    renderer.stop();
    sound.pause();
  }
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

// 開発中の確認用(公開版には入らない)
if (import.meta.env.DEV) {
  window.__aquarium = {
    renderer,
    get current() {
      return current;
    },
  };
}

updateRunning();
showWho();
