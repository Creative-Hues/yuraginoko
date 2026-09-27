import './style.css';
import {
  addPersona,
  deleteMoment,
  listAllTanks,
  listMoments,
  listPersonas,
  listSpecimens,
  listTanks,
  loadTank,
  markOpened,
  renameTank,
  saveMoment,
  saveSpecimen,
  saveTank,
  saveTanks,
  updateMoment,
  updateSpecimen,
} from './storage/db.js';
import { Tank } from './tank/tank.js';
import { Creature } from './creature/creature.js';
import { TANK_CAPACITY } from './creature/lifeConfig.js';
import { portrait as creaturePortrait } from './creature/portrait.js';
import { makeId } from './util/random.js';
import { TankRenderer } from './tank/renderer.js';
import { cleanMode, createTouchController, editMode, interactMode } from './tank/touch.js';
import { ALGAE } from './tank/algae.js';
import { renderWhoScreen } from './ui/whoScreen.js';
import { renderShelf, tankLabel } from './ui/shelf.js';
import { renderHomeChoice } from './ui/homeUi.js';
import { renderSpecimenDetail, renderSpecimenList } from './ui/specimenUi.js';
import { renderTextDialog } from './ui/textDialog.js';
import { photo, renderCollectionList, renderMomentDelete, renderMomentDetail } from './ui/collectionUi.js';
import { el } from './ui/dom.js';
import { createObserveUi } from './ui/observeUi.js';
import { createEditUi } from './ui/editUi.js';
import { showError, watchErrors } from './ui/errorBox.js';
import { eggMood } from './tank/eggs.js';
import { nowInfluences } from './tank/influence.js';
import { sensitivityLines } from './creature/sensitivity.js';

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

const renderer = new TankRenderer(canvas);
renderer.onError = (err) => showError(err, '描画');
// 卵がかえって5匹になったら、すみかを決める画面を出す(ほかの画面を開いているときは、左下のボタンだけ)
renderer.onTankEvent = (e) => {
  // 見ていた卵がかえったら、生まれた赤ちゃんをそのまま見る
  if (e.type === 'hatch' && observingEgg && e.egg === observingEgg) enterObserve(e.creature);
  if (e.type !== 'crowded' || !current?.tank.crowded) return;
  syncUi();
  if (!overlay.hasChildNodes()) attempt('すみかを決める', () => showHome({ newborn: e.creature?.id }));
};

// persona, tank, keepSaved(true のときは保存しない:読み込みに失敗した水槽の元のデータを上書きしないため)、
// label(水槽の表示名)
let current = null;
let cleaning = false;
let observing = null; // 観察中の生き物
let observingEgg = null; // 観察中の卵
let editing = false; // 環境編集モード
let plantKind = null; // 編集モードで、植えるために選んでいる種類
let selectedPlant = null; // 編集モードで、選んでいる植物

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
  onCare: () => {
    if (observing) attempt('この子のこと', () => showHome({ selected: observing.id }));
  },
  onKeep: () => attempt('図鑑に残す', () => keepMoment()),
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

// tankId の水槽を開く。null なら新しい水槽(初期の環境で、新しい2匹)を作って開く
async function openTank(persona, tankId) {
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
  await saveCurrent(true);
  await attempt('開いた時刻', () => markOpened(persona.id));
  await attempt('背景の準備', () => renderer.setTank(tank));
  await refreshTankButton();
  await attempt('ボタン', () => syncUi());
  closeOverlay();
}

// 左上のボタン:「〈人〉の水槽」。水槽が2つ以上か名前があれば「〈人〉・〈水槽の名前〉」
async function refreshTankButton() {
  if (!current) return;
  const { persona, tank } = current;
  let tanks = [];
  await attempt('水槽の一覧', async () => (tanks = await listTanks(persona.id)));
  const index = Math.max(0, tanks.findIndex((t) => t.id === tank.id));
  current.label = tankLabel(tank, index);
  tankButton.textContent = tanks.length > 1 || tank.name ? `${persona.name}・${current.label}` : `${persona.name}の水槽`;
}

// ---- 掃除モード ----
function setCleaning(on) {
  if (on && editing) setEditing(false);
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
  const changed = tank.scrub(sx / W, sy / H, r / W, r / H, amount);
  // 見える藻がすべてなくなったら、見えないほど薄い残りも消して、掃除を終える
  if (changed && !tank.algae.hasVisible()) {
    tank.clearAlgae();
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
  touch.setMode(on ? editMode : interactMode);
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
  tankButton.hidden = !tank || watching || editing;
  homeButton.hidden = !tank?.crowded || watching || editing || cleaning;
  cleanButton.hidden = !tank || watching || editing; // 藻の量に関係なく、いつでも掃除できる
  editButton.hidden = !tank || watching;
  if (editing && tank) {
    // 抜かれた植物は選ばない
    if (selectedPlant && !tank.plants.list.includes(selectedPlant)) selectPlant(null);
    editUi.update({ env: tank.env, plantCount: tank.plants.count, kind: plantKind, selected: selectedPlant });
  }
  if (observing && tank) {
    observing.refreshMeal();
    observeUi.update(observing, {
      now: nowInfluences(observing, tank.env, tank.plants.list),
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
    onCreate: (name) => attempt('水槽をひらく', async () => pickTank(await addPersona(name))),
    onBack: canGoBack ? closeOverlay : null,
  });
}

// ---- 水槽の棚 ----
// only: その人の棚だけを出す(「今は誰?」で水槽が2つ以上あったとき)
async function showShelf({ only = null, title } = {}) {
  await saveCurrent();
  const personas = await listPersonas();
  const tanks = await listAllTanks();
  const groups = personas
    .map((persona, index) => ({ persona, index, tanks: tanks.filter((t) => t.personaId === persona.id) }))
    .filter((g) => (only ? g.persona.id === only.id : g.tanks.length > 0 || g.persona.id === current?.persona.id));
  const again = () => showShelf({ only, title });
  renderShelf(overlay, {
    title,
    groups,
    currentTankId: current?.tank.id,
    onOpen: (persona, rec) => attempt('水槽をひらく', () => openTank(persona, rec.id)),
    onAddTank: (persona) =>
      attempt('水槽をふやす', async () => {
        const tank = Tank.createNew(persona.id);
        await saveTank(tank.toData());
        await openTank(persona, tank.id);
      }),
    onRename: (persona, rec, index) => showRename(rec, index, again),
    onSpecimens: (persona) => attempt('標本', () => showSpecimens(persona, again)),
    onCollection: (persona) => attempt('図鑑', () => showCollection(persona, again)),
    onOther: () => showWho({ canGoBack: !!current }),
    onClose: current ? closeOverlay : null,
  });
}

function showRename(rec, index, back) {
  renderTextDialog(overlay, {
    title: '水槽の名前',
    fields: [{ key: 'name', label: '名前', value: rec.name ?? '', placeholder: tankLabel({}, index) }],
    onCancel: back,
    onOk: ({ name }) =>
      attempt('名前をつける', async () => {
        // 開いている水槽は、中の名前も変える(次の保存で元に戻らないように)
        if (current?.tank.id === rec.id) {
          current.tank.name = name;
          await saveCurrent();
        } else {
          await renameTank(rec.id, name);
        }
        await refreshTankButton();
        await back();
      }),
  });
}

// ---- 標本 ----
async function showSpecimens(persona, back) {
  const specimens = await listSpecimens(persona.id);
  renderSpecimenList(overlay, {
    persona,
    specimens,
    onOpen: (s) => showSpecimen(s, () => attempt('標本', () => showSpecimens(persona, back))),
    onBack: back,
  });
}

function showSpecimen(specimen, back) {
  renderSpecimenDetail(overlay, {
    specimen,
    onBack: back,
    onEdit: () =>
      renderTextDialog(overlay, {
        title: '名前と説明',
        fields: [
          { key: 'name', label: '名前', value: specimen.name },
          { key: 'note', label: '説明', value: specimen.note, multiline: true },
        ],
        onCancel: () => showSpecimen(specimen, back),
        onOk: (values) =>
          attempt('名前と説明', async () => {
            const next = (await updateSpecimen(specimen.id, values)) ?? specimen;
            showSpecimen(next, back);
          }),
      }),
  });
}

// ---- 図鑑に残す(その瞬間の姿を写す。生き物は水槽にいたまま) ----
const SNAP_WAIT = 900; // 光が引いてから、名前とメモの画面を出すまで(ms)
let keeping = false; // 光っている間は、もう一度押しても重ねない

// 写真を撮ったような、静かな光(DOM と CSS だけ。音・振動なし)
function snapLight() {
  const light = el('div', { class: 'snap-light', 'aria-hidden': 'true' });
  document.body.append(light);
  setTimeout(() => light.remove(), 2000);
  return new Promise((resolve) => setTimeout(resolve, SNAP_WAIT));
}

// 押した瞬間の姿(揺らぎを含めた見た目も)を写し、名前とメモをつけて図鑑に残す。生き物は水槽にいたまま
async function keepMoment() {
  if (!observing || !current || keeping) return;
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

async function showCollection(persona, back) {
  const moments = await listMoments(persona.id);
  const tanks = (await listTanks(persona.id)).map((t, i) => ({ id: t.id, label: tankLabel(t, i), creatures: t.creatures ?? [] }));
  const again = () => attempt('図鑑', () => showCollection(persona, back));
  renderCollectionList(overlay, {
    persona,
    moments,
    tanks,
    onOpen: (m) => attempt('図鑑', () => showMoment(m, persona, tanks, again)),
    onBack: back,
  });
}

// 元の子が今いる水槽の id(標本になった子など、どこにもいなければ null)。ほかの水槽へ移った子も探す
function findCreatureTank(personaId, creatureId, tanks) {
  if (current?.persona.id === personaId && current.tank.creatures.some((c) => c.id === creatureId)) return current.tank.id;
  const t = tanks.find((x) => x.id !== current?.tank.id && x.creatures.some((c) => c.id === creatureId));
  return t?.id ?? null;
}

function showMoment(moment, persona, tanks, back) {
  const tankId = findCreatureTank(persona.id, moment.creatureId, tanks);
  renderMomentDetail(overlay, {
    moment,
    tankLabel: tanks.find((t) => t.id === moment.tankId)?.label ?? moment.tankLabel,
    onBack: back,
    onVisit: tankId ? () => attempt('今の姿を見に行く', () => visitCreature(persona, tankId, moment.creatureId)) : null,
    onEdit: () =>
      renderTextDialog(overlay, {
        title: '名前とメモ',
        fields: [
          { key: 'name', label: '名前', value: moment.name },
          { key: 'note', label: 'メモ', value: moment.note, multiline: true },
        ],
        onCancel: () => showMoment(moment, persona, tanks, back),
        onOk: (values) =>
          attempt('名前とメモ', async () => {
            const next = (await updateMoment(moment.id, values)) ?? moment;
            showMoment(next, persona, tanks, back);
          }),
      }),
    onDelete: () =>
      renderMomentDelete(overlay, {
        moment,
        onCancel: () => showMoment(moment, persona, tanks, back),
        onOk: () =>
          attempt('図鑑から消す', async () => {
            await deleteMoment(moment.id);
            await back();
          }),
      }),
  });
}

// その子のいる水槽を開いて、観察モードで見る
async function visitCreature(persona, tankId, creatureId) {
  if (current?.tank.id !== tankId) await openTank(persona, tankId);
  closeOverlay();
  const c = current?.tank.creatures.find((x) => x.id === creatureId);
  if (c) enterObserve(c);
}

// ---- すみかを決める(標本にする・別の水槽へ移す) ----
// selected: 最初から選んでおく子の id、newborn: 生まれたばかりの子の id
async function showHome({ selected = null, newborn = null } = {}) {
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
    creatures: tank.creatures.map((c) => ({ id: c.id, data: c.toJSON(), newborn: c.id === newborn })),
    selectedId: selected,
    targets,
    crowded: tank.crowded,
    onSpecimen: (id) => showSpecimenForm(id, () => showHome({ selected: id, newborn })),
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
  syncUi();
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
  target.addCreature(new Creature(c.toJSON()));
  tank.removeCreature(c);
  await saveTanks(current.keepSaved ? [target.toData()] : [tank.toData(), target.toData()]);
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
