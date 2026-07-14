/**
 * colormap.ts — flood-depth ramp -> packed RGBA (canvas ImageData byte order).
 * 256-entry LUT over [0, DEPTH_MAX] m; deeper = darker blue, alpha ramps up fast
 * so shallow fringes stay readable over the basemap.
 */
export const DEPTH_MAX = 8 // m; depths above clamp to the last entry

// stops: depth fraction -> [r, g, b, a]
const STOPS: Array<[number, [number, number, number, number]]> = [
  [0.0, [191, 227, 242, 150]],
  [0.08, [140, 197, 226, 180]],
  [0.25, [82, 157, 204, 205]],
  [0.5, [43, 108, 172, 220]],
  [0.75, [19, 65, 133, 232]],
  [1.0, [8, 35, 92, 240]],
]

function linear_interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Build the LUT as Uint32 values matching ImageData's little-endian ABGR layout. */
export function buildLut(): Uint32Array {
  const lut = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    const f = i / 255
    let s = 0
    while (s < STOPS.length - 2 && STOPS[s + 1][0] < f) s++
    const [f0, c0] = STOPS[s]
    const [f1, c1] = STOPS[s + 1]
    const t = f1 === f0 ? 0 : (f - f0) / (f1 - f0)
    const r = Math.round(linear_interpolate(c0[0], c1[0], t))
    const g = Math.round(linear_interpolate(c0[1], c1[1], t))
    const b = Math.round(linear_interpolate(c0[2], c1[2], t))
    const a = Math.round(linear_interpolate(c0[3], c1[3], t))
    lut[i] = (a << 24) | (b << 16) | (g << 8) | r
  }
  return lut
}

export function lutIndex(depth: number): number {
  const f = depth / DEPTH_MAX
  const i = Math.round(f * 255)
  return i < 0 ? 0 : i > 255 ? 255 : i
}

/** CSS gradient stops for the on-page legend (kept in sync with STOPS). */
export function legendGradient(): string {
  return STOPS.map(([f, [r, g, b, a]]) =>
    `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${(f * 100).toFixed(0)}%`).join(', ')
}
