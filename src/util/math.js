export const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
// 0〜1 の範囲で一周する値(色相など)を、範囲内に戻す
export const wrap01 = (v) => v - Math.floor(v);
