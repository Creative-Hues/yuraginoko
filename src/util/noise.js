// ゆっくり滑らかに揺れる値(-1〜1)。
// 周期の違うサイン波を重ねて、同じ動きの繰り返しに見えにくくしている。
// t を 1 進めると、おおよそ1往復する。
const TAU = Math.PI * 2;

export function wave(t, offset = 0) {
  return (
    Math.sin(t * TAU + offset) * 0.55 +
    Math.sin(t * TAU * 0.613 + offset * 1.7 + 1.3) * 0.3 +
    Math.sin(t * TAU * 1.37 + offset * 0.6 + 4.1) * 0.15
  );
}
