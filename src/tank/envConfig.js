// 環境(植物・土・光・水流)の調整値。
// 変化の速さ・植物の種類・土の種類・光の色などを足したり調整したりするときは、このファイルだけを直せばよいようにしてある。
//
// 効果(effect)の書き方。どれも「目標の値まで」で、目標を通り過ぎない
// - up:     { 遺伝子: 目標 } … 目標より小さければ、目標まで増やす(もう越えているときは何もしない)
// - down:   { 遺伝子: 目標 } … 目標より大きければ、目標まで減らす
// - toward: { 遺伝子: 目標 } … どちらからでも目標へ寄せる(色相は近いほうの回り方で)
// 目標は生き物ごとに ±ENV_CHANGE.TARGET_JITTER だけずれる(同じ環境でも、みんな同じ姿にならないように)
// - become: { pattern: 模様の種類 } … 模様をその種類へ移す(途中でほかの模様を通らない。src/creature/pattern.js)
import { FOODS } from '../creature/genes.js';

export const ENV_TICK = 1; // 植物が育つのと、環境に当てはまっているかを調べる間隔(秒)

// 環境による遺伝子の変化。水槽を開いている間だけ進む
// 1秒ごとに当てはまっている環境を記録して、INTERVAL 秒ごとに、その間に当てはまっていたぶんをまとめて変える
export const ENV_CHANGE = {
  INTERVAL: 60, // まとめて変わる間隔(秒)。生き物ごとにタイミングをずらす
  STEP: 0.015, // INTERVAL の間ずっと当てはまっていたときの、1回の変化量
  TARGET_JITTER: 0.08, // 目標の値の、生き物ごとのずれ(±)
  SHIFT_SECONDS: 1.5, // 変わるときに、見た目がこれだけかけて(静かに)変わる(秒)
  PATTERN_STEP: 0.025, // 模様:INTERVAL の間ずっと当てはまっていたときに、目標の模様が濃くなる量(約40分で移りきる)
};

// 生き物ごとの「環境の受けやすさ」。項目ごとに3段階で、当てはまっている強さに倍率をかける。
// エサの効き方には関係しない(全員同じ)
export const SENSITIVITY = {
  KINDS: {
    light: '光の色',
    brightness: '明るさ',
    soil: '土',
    plants: '植物',
    current: '水流',
  },
  LEVELS: {
    high: { label: '受けやすい', scale: 1.5 },
    normal: { label: 'ふつう', scale: 1 },
    low: { label: '受けにくい', scale: 0.2 },
  },
  HIGH_COUNT: [1, 2], // 1匹あたりの「受けやすい」の数
  LOW_COUNT: [1, 2], // 1匹あたりの「受けにくい」の数
  INHERIT_CHANGE: 0.2, // 赤ちゃんが親から受け継ぐとき、項目ごとに段階が変わる確率
};
export const SENSITIVITY_KEYS = Object.keys(SENSITIVITY.KINDS);

// ---- 植物 ----
export const PLANT_LIMIT = 8; // 植物は合計でこれだけまで(上限のときは勝手に生えない)
export const PLANT_REACH = 0.18; // 生き物(体の真ん中)がこれより近いと「近くにいる」(横幅と同じ尺度)

// 育ち方:growth が 0 → 2 に増える。SMALL_AT までは芽、1 で大きい、2 でとても大きい
export const PLANT_GROWTH = {
  SMALL_AT: 0.3,
  SECONDS: 600, // 栄養がないとき、芽から大きくなるまで(秒)。小さくなるまでは SMALL_AT ぶん(約3分)
  HUGE_SECONDS: 1200, // 栄養がないとき、大きいからとても大きいになるまで(秒)
  NUTRIENT_BOOST: 2, // 栄養がいっぱいのとき、何倍ぶん早くなるか(2 なら最大 3倍の速さ)
  NUTRIENT_USE: 0.4, // 1段(芽 → 大きい、大きい → とても大きい)育つごとに、その場所の栄養を使う量
};
export const PLANT_MAX_GROWTH = 2;

// 育ち具合ごとの、生き物への効果の強さ(芽・小さい・大きい・とても大きい)
export const STAGE_EFFECT = { sprout: 0, small: 0.5, large: 1, huge: 1.5 };

// 生き物が植物の奥を通るとき、植物を透かす
export const PLANT_FADE = {
  ALPHA: 0.5, // いちばん透けたときの濃さ
  SPEED: 3, // 透けたり戻ったりする速さ
};

// 植物の種類
// - label:  名前
// - colors: [主な色, 2つ目の色]
// - plantable: true なら編集モードで植えられる / fromFood: そのエサの排泄物から勝手に生える
export const PLANTS = {
  toge: { label: 'トゲ草', colors: ['#3de8a0', '#1d9e7a'], plantable: true, effect: { up: { spikeLength: 0.85 } } },
  hira: { label: 'ひらひら葉', colors: ['#ff6fcf', '#c23a9a'], plantable: true, effect: { up: { edgeRuffle: 0.85 } } },
  nobi: { label: 'のびる藻', colors: ['#a6f03d', '#5f9e1d'], plantable: true, effect: { down: { bodyLength: 0.15 } } },
  maru: { label: 'まるい苔', colors: ['#6fd35a', '#3a8a3a'], plantable: true, effect: { up: { bodyLength: 0.85 } } },
  redFlower: { label: '赤い花草', colors: ['#ff3b5c', '#2fa878'], fromFood: 'red', effect: { toward: { hue: FOODS.red.hueToward } } },
  blueFlower: { label: '青い花草', colors: ['#3b7bff', '#2fa8a0'], fromFood: 'blue', effect: { toward: { hue: FOODS.blue.hueToward } } },
  yellowFlower: { label: '黄色い花草', colors: ['#ffd23b', '#5fae3a'], fromFood: 'yellow', effect: { toward: { hue: FOODS.yellow.hueToward } } },
  glowCap: { label: '光るキノコ', colors: ['#c6ff3d', '#e8e0ff'], fromFood: 'glow', effect: { up: { glow: 0.8 } } },
};
export const PLANT_KEYS = Object.keys(PLANTS);
export const PLANTABLE_KEYS = PLANT_KEYS.filter((k) => PLANTS[k].plantable);
// エサの種類 → 排泄物から生える植物
export const SPROUT_BY_FOOD = Object.fromEntries(PLANT_KEYS.filter((k) => PLANTS[k].fromFood).map((k) => [PLANTS[k].fromFood, k]));

// ---- 土と栄養 ----
// 土の種類。floor: 底の3段の色、grains: 砂粒の色 [明るい粒, 暗い粒]、ripple: 風紋の色、
// grainSize: 砂粒の大きさの倍率(なければ 1)、waves: ゆるやかな波の筋の色(さざなみ砂)、fine: きめの細かい粒の色(なめらか砂)
// 模様を寄せる土:小石 → 斑点、さざなみ砂 → 縞、泥 → 網目、なめらか砂 → グラデーション
export const SOILS = {
  sand: {
    label: '砂',
    floor: ['#5a2170', '#4a1a60', '#381250'],
    grains: ['rgba(200, 140, 230, 0.55)', 'rgba(15, 4, 30, 0.6)'],
    ripple: 'rgba(150, 80, 190, 0.55)',
    effect: {},
  },
  pebble: {
    label: '小石',
    floor: ['#4a2a6a', '#3c2258', '#2e1a46'],
    grains: ['rgba(190, 160, 230, 0.5)', 'rgba(15, 4, 30, 0.6)'],
    ripple: 'rgba(130, 90, 180, 0.4)',
    effect: { become: { pattern: 'spots' } },
  },
  wave: {
    label: 'さざなみ砂',
    floor: ['#62307e', '#52286c', '#3f1f58'],
    grains: ['rgba(215, 170, 240, 0.45)', 'rgba(15, 4, 30, 0.5)'],
    ripple: 'rgba(170, 110, 215, 0.35)',
    waves: ['rgba(150, 90, 190, 0.5)', 'rgba(40, 14, 62, 0.28)'], // 波の筋 [明るい筋, 影の筋]
    effect: { become: { pattern: 'stripes' } },
  },
  mud: {
    label: '泥',
    floor: ['#3d2238', '#331c30', '#271526'],
    grains: ['rgba(140, 100, 130, 0.35)', 'rgba(10, 3, 12, 0.55)'],
    ripple: 'rgba(20, 6, 22, 0.5)',
    effect: { become: { pattern: 'net' } },
  },
  smooth: {
    label: 'なめらか砂',
    floor: ['#8a6aa6', '#7a5c96', '#684d82'],
    grains: ['rgba(245, 232, 255, 0.4)', 'rgba(70, 40, 95, 0.3)'],
    ripple: 'rgba(250, 238, 255, 0.14)',
    grainSize: 0.45,
    fine: ['rgba(250, 242, 255, 0.35)', 'rgba(90, 60, 115, 0.25)'], // きめの細かい粒 [明るい粒, 暗い粒]
    effect: { become: { pattern: 'gradient' } },
  },
  glowSand: {
    label: '光る砂',
    floor: ['#243a78', '#1d3066', '#172552'],
    grains: ['rgba(150, 255, 220, 0.6)', 'rgba(6, 10, 30, 0.6)'],
    ripple: 'rgba(90, 200, 230, 0.45)',
    sparkle: ['198, 255, 61', '120, 255, 230'], // またたく粒の色
    effect: { up: { glow: 0.8 } },
  },
};
export const SOIL_KEYS = Object.keys(SOILS);

// 底の栄養(底を粗いマス目に分けて、マスごとに 0〜1)
export const NUTRIENT = {
  GRID_W: 16,
  GRID_H: 6,
  PER_DROPPING: 0.12, // 排泄の粒が1つ溶けたときにたまる量
  SHOW_MIN: 0.02, // これより少ないマスは、色を変えない
  DARKEN: 0.3, // 栄養がいっぱいのマスの、濃くなる量(ほんの少し)
};

// 勝手に生える芽(1回の排泄の粒がすべて溶けたときに、1度だけ判定)
export const SPROUT = {
  CHANCE: 0.3, // 芽が出る確率
  NUTRIENT_BONUS: 0.4, // その場所の栄養がいっぱいのとき、確率にこれだけ足す
  NUTRIENT_USE: 0.1, // 芽が出るときに使う栄養
};

// ---- 光 ----
// name: 観察中の「いま受けている影響」での名前、
// hue: 生き物の色を寄せる色相(null なら寄せない。目標は生き物ごとに少しずれる)、ray: 光の筋の色相、water: 水の色(上 → 下)
export const LIGHT_COLORS = {
  usual: { label: 'いつもの', name: 'いつもの光', swatch: '#7dffe0', hue: null, ray: 165, water: ['#1a0848', '#123a86', '#0a6b73'] },
  blue: { label: '青', name: '青い光', swatch: '#5b8bff', hue: 0.62, ray: 215, water: ['#0a0c48', '#10307e', '#0a4a8a'] },
  purple: { label: '紫', name: '紫の光', swatch: '#b06bff', hue: 0.76, ray: 275, water: ['#1c063f', '#3a1680', '#40207a'] },
  pink: { label: '桃', name: '桃色の光', swatch: '#ff6fcf', hue: 0.9, ray: 320, water: ['#2a0640', '#5a1470', '#6a2070'] },
  orange: { label: '橙', name: '橙色の光', swatch: '#ffa53b', hue: 0.08, ray: 35, water: ['#2a0a30', '#5a2a4a', '#7a4a3a'] },
  green: { label: '緑', name: '緑の光', swatch: '#8aff5b', hue: 0.3, ray: 110, water: ['#0a1c38', '#10484a', '#2a6a30'] },
};
export const LIGHT_COLOR_KEYS = Object.keys(LIGHT_COLORS);

// 明るさ(0〜1、真ん中の 0.5 は変化なし)。真ん中から離れるほど強く効く
// label: 一覧での名前、name: 観察中の「いま受けている影響」での名前
export const LIGHT_BRIGHTNESS = {
  dark: { label: '暗い', name: '暗い光', effect: { up: { translucency: 0.8, glow: 0.75 } } }, // 透けやすく、光りやすく
  bright: { label: '明るい', name: '明るい光', effect: { down: { translucency: 0.2, glow: 0.2 } } }, // その逆
};

// ---- 水流 ----
// 強さ 0〜1。強いほど効く。label: 一覧での名前、name: 観察中の名前
export const CURRENT_EFFECT = { up: { floatiness: 0.8 } };
export const CURRENT_NAMES = { label: '強い', name: '水の流れ' };
export const CURRENT_LOOK = {
  PARTICLE_SPEED: 0.06, // 強さ 1 のとき、ただよう粒が流れる速さ(画面の幅/秒)
  BUBBLE_SPEED: 45, // 泡が流れる速さ(px/秒)
  LEAF_LEAN: 0.45, // 植物の葉がなびく角度(ラジアン)
};

// ---- 影響の言葉 ----
// 「影響の一覧」と、編集・観察中の一言は、ここと上の effect の定義から作る(src/tank/influence.js)。
// 植物や土を増やしても、effect に使った「遺伝子と向き」の言葉がここにあれば、一覧に自動で並ぶ。
// effect に使えるのは、環境で変わる遺伝子(genes.js の GENE_DEFS)と模様(pattern)だけ。特徴遺伝子(TRAIT_DEFS)は環境では変わらない
export const EFFECT_WORDS = {
  bodyLength: { up: '体がずんぐりする', down: '体が細長くなる' },
  spikeLength: { up: '突起が長くなる', down: '突起が短くなる' },
  edgeRuffle: { up: '縁が波打つ', down: '縁がまっすぐになる' },
  hue: { toward: '体の色がその色に寄る' },
  hue2: { toward: '2つ目の色がその色に寄る' },
  pattern: { become: '{pattern}の模様に寄る' }, // {pattern} は目標の模様の名前
  translucency: { up: '透けやすくなる', down: '透けにくくなる' },
  glow: { up: '光り方が強くなる', down: '光り方が弱くなる' },
  crawlSpeed: { up: '這うのが速くなる', down: '這うのがゆっくりになる' },
  floatiness: { up: '浮きやすくなる', down: '浮きにくくなる' },
};
export const NO_EFFECT_TEXT = '変化なし';
// 観察中の「いま受けている影響」に明るさ・水流を出すのは、効き方がこれより大きいとき
export const INFLUENCE_MIN = 0.1;

// 初期の環境(どれも「変化なし」)。環境のない古いデータは、これで開く
export const DEFAULT_ENV = {
  soil: 'sand',
  light: { color: 'usual', brightness: 0.5 },
  current: { strength: 0, dir: 1 },
};
