const DEPTH_MAX = 8;
const STOPS = [
  [0, [191, 227, 242, 150]],
  [0.08, [140, 197, 226, 180]],
  [0.25, [82, 157, 204, 205]],
  [0.5, [43, 108, 172, 220]],
  [0.75, [19, 65, 133, 232]],
  [1, [8, 35, 92, 240]]
];
function linear_interpolate(a, b, t) {
  return a + (b - a) * t;
}
function buildLut() {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const f = i / 255;
    let s = 0;
    while (s < STOPS.length - 2 && STOPS[s + 1][0] < f) s++;
    const [f0, c0] = STOPS[s];
    const [f1, c1] = STOPS[s + 1];
    const t = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
    const r = Math.round(linear_interpolate(c0[0], c1[0], t));
    const g = Math.round(linear_interpolate(c0[1], c1[1], t));
    const b = Math.round(linear_interpolate(c0[2], c1[2], t));
    const a = Math.round(linear_interpolate(c0[3], c1[3], t));
    lut[i] = a << 24 | b << 16 | g << 8 | r;
  }
  return lut;
}
function lutIndex(depth) {
  const f = depth / DEPTH_MAX;
  const i = Math.round(f * 255);
  return i < 0 ? 0 : i > 255 ? 255 : i;
}
function legendGradient() {
  return STOPS.map(([f, [r, g, b, a]]) => `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${(f * 100).toFixed(0)}%`).join(", ");
}
export {
  DEPTH_MAX,
  buildLut,
  legendGradient,
  lutIndex
};
