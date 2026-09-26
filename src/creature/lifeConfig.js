// 交流・交配・卵・成長・変異・水槽の定員・去りぎわの演出の調整値。
// 回数や時間を変えるときは、このファイルだけを直せばよいようにしてある。
// どれも、水槽を開いている間だけ進む(閉じている間は何も変わらない)。

// 交流:ときどき2匹が近づいて、触角を触れ合わせる
export const MEET = {
  FIRST_WAIT: [20, 40], // 水槽を開いてから、最初の交流を探し始めるまで(秒、この範囲でランダム)
  INTERVAL: [45, 90], // 交流が終わってから、次を探し始めるまで(秒、水槽ごと)
  GAP: 0.035, // 向かい合って止まるときの、頭と頭の間(横幅と同じ尺度)
  REACH: 0.05, // 頭どうしがこれより近づいたら、触れ合う
  TOUCH_SECONDS: 3.5, // 触れ合っている時間(秒)
  GIVE_UP: 20, // これだけ経っても会えなければ、今回はやめる(数えない)
  SPARKS: 5, // 触れ合った瞬間に、2匹の間に出る光の粒の数
  BUBBLES: 3, // 同じく、小さな泡の数
};

// 交配:同じ2匹の交流がこの回数たまると、自動で交配する
export const MATE = {
  MEETS: 8,
};

// 卵
export const EGG = {
  HATCH_SECONDS: 180, // 産まれてからかえるまで(秒)
  SIZE: 0.045, // 卵のかたまりの大きさ(水槽の横幅に対する割合、手前にあるとき)
  BEHIND: 0.05, // 親のしっぽから、これだけ後ろの砂に置く
};

// 赤ちゃんの成長
export const GROW = {
  BABY_SIZE: 0.4, // 生まれたときの大きさ(大人 = 1)
  SECONDS: 1800, // 大人の大きさになるまで(秒)
  BABY_PACE: 0.7, // 生まれたばかりの動きの速さ(大人になるにつれて 1 へ)
};

// 変異:赤ちゃんは両親の遺伝子を混ぜたうえで、必ず COUNT の範囲の項目数だけ大きくずれる。
// 1項目ずつ、QUIRK_CHANCE の確率で「新しい特徴が生える」、それ以外は「遺伝子が大きくずれる」
export const MUTATION = {
  COUNT: [1, 2],
  MIX_JITTER: 0.03, // 混ぜるときの、ふだんの小さなゆらぎ(±)
  SHIFT: [0.28, 0.45], // 大きくずれるときの量(この範囲で、増えるか減るか)
  SHIFT_KEYS: ['bodyLength', 'spikeCount', 'spikeLength', 'edgeRuffle', 'hue', 'hue2', 'pattern', 'translucency', 'glow'], // 見た目でわかる遺伝子
  QUIRK_CHANCE: 0.5,
  INHERIT: 0.5, // 親の特徴を、1つずつこの確率で受け継ぐ
  MAX_QUIRKS: 4, // 1匹が持てる特徴の数
};

// 特徴の種類と見た目の幅。u は体の場所(0 = しっぽ〜1 = 頭)
// - smudge: 体の一部の色が、輪郭の外へにじみ出す
// - notch:  体の縁が、小さく欠けている
// - sprout: 余分な突起が生えている(form: horn = 3本目の触角 / tail = しっぽの糸 / spike = ひとつだけ大きな突起)
export const QUIRKS = {
  smudge: { label: 'にじみ', u: [0.15, 0.85], size: [0.5, 1] },
  notch: { label: '欠け', u: [0.2, 0.8], size: [0.5, 1] },
  sprout: { label: '余分な突起', u: [0.25, 0.75], size: [0.6, 1], forms: ['horn', 'tail', 'spike'] },
};
export const QUIRK_KEYS = Object.keys(QUIRKS);

// 1つの水槽に住める数
export const TANK_CAPACITY = 4;

// 水槽を離れるときの演出(秒)
export const FAREWELL = {
  CRYSTAL_SECONDS: 5, // 標本:光に包まれて、結晶の中に収まり、昇っていく
  MOVE_SECONDS: 2.6, // 別の水槽へ:泡に包まれて、ふわっと昇っていく
};
