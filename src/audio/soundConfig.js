// 音の高さ・長さ・大きさ。音はすべて Web Audio でその場で作る(音のファイルは使わない)。
// 音が苦手な人もいるので、どの音もやわらかく小さく:
// - 立ち上がり(attack)は 15ms 以上、終わりはなめらかに消える
// - 高さは FREQ_MAX まで。きらめき・澄んだ音もローパスを通して、キンとさせない
// - 同時に鳴る数と、全体の音量に上限がある
//
// 長さ・間隔の単位は秒、高さは Hz。gain は 0〜1(全体の上限 MASTER.GAIN をかける前の大きさ)

// 設定の初期値(最初は音なし)。ambient / effects は 0〜1
export const DEFAULTS = { on: false, ambient: 0.5, effects: 0.6 };

export const MASTER = {
  GAIN: 0.35, // 全体の上限
  FADE: 0.3, // オン・オフや音量を変えるときに、なめらかに変える時間
  CURVE: 2, // スライダーの値 → 音量(値 ** CURVE。小さい側を細かく調整できるように)
  MAX_VOICES: 6, // 同時に鳴る効果音の上限(これより多いときは、新しい音を鳴らさない)
  PAN: 0.3, // 水槽の左右の位置で、ほんの少し左右に振る
  FREQ_MAX: 1800, // これより高い音は作らない
  LOWPASS: 2400, // 効果音の全体にかけるローパス(耳ざわりな高い成分を落とす)
  COMPRESSOR: { threshold: -24, knee: 12, ratio: 6, attack: 0.01, release: 0.25 },
  MIN_ATTACK: 0.015,
};

// ノイズ(水音・しゃりしゃりのもと)。1つだけ作って使い回す
export const NOISE_SECONDS = 3;

// 環境音:こもった水の音(ずっと流れる)と、ときどき泡のぷくぷく
export const AMBIENT = {
  WATER: {
    gain: 0.5,
    lowpass: 320, // こもった感じ
    q: 0.5,
    lfoRate: 0.07, // ゆっくり揺れる(回/秒)
    lfoFreq: 80, // ローパスの揺れ幅(Hz)
    lfoGain: 0.12, // 大きさの揺れ幅
  },
  BUBBLES: {
    gain: 0.35,
    every: [6, 20], // 次の泡までの間隔(秒)
    count: [2, 4], // 1回に出る粒
    gap: [0.08, 0.2], // 粒と粒の間
    freq: [300, 700], // 粒の高さ
    rise: 1.6, // 粒の中で高さが上がる割合
    length: 0.07,
    attack: 0.015,
    lowpass: 1200,
  },
};

// 効果音。type: 'tone'(オシレーター)/ 'noise'(ノイズをフィルターに通す)
// freq → to:高さがなめらかに移る(tone)。filter / filterTo:ノイズの中心の高さ(noise)
export const SOUNDS = {
  // 撫でる:やわらかい水音
  stroke: { type: 'noise', filter: 'bandpass', freq: 500, to: 800, q: 0.8, attack: 0.06, length: 0.35, gain: 0.3, minGap: 0.15 },
  // 弾く:小さな「ぽこっ」
  flick: { type: 'tone', wave: 'sine', freq: 520, to: 260, attack: 0.015, length: 0.13, gain: 0.45, minGap: 0.08 },
  // エサが落ちる
  drop: { type: 'tone', wave: 'sine', freq: 380, to: 620, attack: 0.015, length: 0.14, gain: 0.3, minGap: 0.1 },
  // 食べる
  eat: { type: 'tone', wave: 'sine', freq: 300, to: 480, attack: 0.015, length: 0.1, gain: 0.25, minGap: 0.2 },
  // 交流:小さな鳴き声「きゅる」。上がってから少し下がる。個体ごとに spread 半音の幅で高さが違う
  chirp: {
    type: 'tone',
    wave: 'triangle',
    freq: 700,
    peak: 920, // 途中でここまで上がる
    to: 780,
    attack: 0.02,
    length: 0.18,
    gain: 0.2,
    lowpass: 1400,
    spread: 3,
    delay: 0.14, // 2匹目が鳴くまで
    minGap: 0.1,
  },
  // 繁殖・卵がかえる:小さなきらめき(やわらかい音の粒が順に)
  sparkle: { type: 'notes', wave: 'sine', freq: 620, notes: [0, 4, 7, 12], step: 0.09, attack: 0.02, length: 0.5, gain: 0.12, lowpass: 2000, minGap: 0.5 },
  // 標本の結晶・図鑑に残す:澄んだ短い音(2つの音を重ねる)
  clear: { type: 'notes', wave: 'sine', freq: 784, notes: [0, 7], step: 0.03, attack: 0.02, length: 0.9, gain: 0.16, lowpass: 2000, minGap: 0.5 },
  // ボタン:鳴らさない(gain を 0 より大きくすると、ごく小さく鳴る)
  button: { type: 'tone', wave: 'sine', freq: 600, to: 560, attack: 0.015, length: 0.06, gain: 0, minGap: 0.1 },
};

// 掃除:擦っている間だけ、しゃりしゃり(指が止まると静かに消える)
export const SCRUB = {
  gain: 0.22,
  filter: 1500, // バンドパスの中心
  q: 0.7,
  fullMove: 24, // 1回の動きがこれだけあれば(px)、いちばん大きく
  rise: 0.03, // 大きくなるときの速さ(時定数)
  hold: 0.06, // 動きが止まってから消え始めるまで
  fade: 0.08, // 消えるときの速さ(時定数)
  grainRate: 13, // しゃりしゃりの細かさ(回/秒)
  grainDepth: 0.45,
};
