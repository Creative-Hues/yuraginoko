// 体の節のつながり。
// 水槽の底の上(左右 x と奥行き z の平面)で、頭の節が向きを変えると、
// 後ろの節が少し遅れてついていく。これで「頭から先に曲がる」Uターンになる。
//
// 角度は底の平面での向き:0 = 右(+x)、π = 左、+π/2 = 奥へ(+z)、-π/2 = 手前へ。

export const SEGMENTS = 16; // 節の数(頭〜しっぽ)
export const BODY_WORLD_LENGTH = 0.24; // 体の長さ(水槽の幅に対する割合)
export const DEPTH_SPAN = 0.45; // 奥行き z の 0〜1 が、横幅でいうとどれくらいの距離か
const FOLLOW = 16; // 節が前の節の向きについていく速さ

export function normalizeAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// a から見て b がどれだけ回っているか(-π〜π)
export function angleDiff(target, current) {
  return normalizeAngle(target - current);
}

export function createBody(heading) {
  return { angles: new Array(SEGMENTS).fill(heading) };
}

export function updateBody(body, heading, dt) {
  const a = body.angles;
  a[0] = heading;
  const k = 1 - Math.exp(-FOLLOW * dt);
  for (let i = 1; i < a.length; i++) a[i] += angleDiff(a[i - 1], a[i]) * k;
}

// 頭の位置から、各節の位置(頭 → しっぽの順)を求める
export function bodyPoints(body, headX, headZ, lengthScale = 1, out = []) {
  const seg = (BODY_WORLD_LENGTH * lengthScale) / (SEGMENTS - 1);
  const a = body.angles;
  out.length = SEGMENTS;
  let x = headX;
  let z = headZ;
  out[0] = { x, z };
  for (let i = 1; i < SEGMENTS; i++) {
    x -= Math.cos(a[i]) * seg;
    z -= (Math.sin(a[i]) * seg) / DEPTH_SPAN;
    out[i] = { x, z };
  }
  return out;
}
