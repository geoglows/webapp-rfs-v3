/**
 * kernel.ts — the FLDPLN mapping kernel. Pure typed-array math, no DOM/network.
 *
 * Mirrors preprocessing/make_reference.py (itself the verified reference,
 * curve2flood fldpln_improvement make_flood_map semantics with the Q-dependent
 * q01/q99 outlier filter deliberately dropped — plan §12):
 *
 *   1. Q per COMID -> WSE per curve-bearing stream visit (30-pt piecewise-linear,
 *      Q<=QBaseflow -> Elev, Q>=q30 -> wse30, clamp >= bed, round half-even to 2 dp)
 *   2. per baked path: 3-pt mean over observed WSEs (edge-extended), limit_rise
 *      (max 0.01 m rise per downstream pixel), linear gap interpolation
 *   3. DoF(fsp) = smoothed WSE - bed;  duplicates across paths resolve by max
 *   4. depth(FPP) = max over library rows fround(DoF - DTF)  + fill;  flooded <=> depth > 0
 *
 * float32 notes: the reference computes DoF, avail, and depth in float32 (pandas
 * float32 columns). Math.fround at the same points keeps this kernel bit-compatible.
 */

export interface StreamsData {
  n: number            // visits (path-ordered; junction pixels may appear in 2 paths)
  nFsp: number         // unique FSP count
  pathId: Uint16Array
  fspIdx: Uint16Array  // unique-FSP ordinal per visit
  pixel: Uint32Array   // tile-linear pixel index (row-major, 0-based)
  comid: Float64Array
  bed: Float32Array    // bathymetry-burned bed elevation at the pixel
  hasCurve: Uint8Array
  elevVdt: Float64Array
  qBaseflow: Float64Array
  q: Float64Array      // n x 30, row-major
  wse: Float64Array    // n x 30
  pathStarts: Int32Array // offsets into visits per path, length nPaths+1
}

export interface LibraryData {
  n: number
  fpp: Uint32Array
  fspIdx: Uint16Array
  dtf: Float32Array   // fround(dtf_mm / 1000) — bit-identical to the source float32
  fill: Float32Array  // fround(fill_mm / 1000)
}

export const NP = 30 // rating-curve points per cell

/** numpy-compatible round-half-even to 2 decimals (np.round(x, 2)). */
export function roundHalfEven2(x: number): number {
  const scaled = x * 100
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let r: number
  if (diff > 0.5) r = floor + 1
  else if (diff < 0.5) r = floor
  else r = floor % 2 === 0 ? floor : floor + 1
  return r / 100
}

/** Locate contiguous path runs in a path-ordered streams table. */
export function findPathStarts(pathId: Uint16Array): Int32Array {
  const starts: number[] = [0]
  for (let i = 1; i < pathId.length; i++) {
    if (pathId[i] !== pathId[i - 1]) starts.push(i)
  }
  starts.push(pathId.length)
  return Int32Array.from(starts)
}

/**
 * Steps 1-3: per-visit WSE, path smoothing, DoF per unique FSP.
 * Writes into dof (length nFsp, reset to NaN here). Returns dof for chaining.
 */
export function computeDof(
  s: StreamsData,
  flowByComid: Map<number, number>,
  dof: Float32Array,
  scratch?: { wse: Float64Array },
): Float32Array {
  const wseV = scratch?.wse ?? new Float64Array(s.n)

  // -- step 1: WSE per visit (NaN when no rating curve) --
  for (let i = 0; i < s.n; i++) {
    if (!s.hasCurve[i]) { wseV[i] = NaN; continue }
    const flow = flowByComid.get(s.comid[i])
    if (flow === undefined || !Number.isFinite(flow)) { wseV[i] = NaN; continue }
    let w: number
    const o = i * NP
    if (flow <= s.qBaseflow[i]) {
      w = s.elevVdt[i]
    } else if (flow >= s.q[o + NP - 1]) {
      w = s.wse[o + NP - 1]
    } else {
      // np.interp equivalent over ascending q: CLAMPS below q_1 (no extrapolation)
      if (flow <= s.q[o]) {
        w = s.wse[o]
      } else {
        let j = o
        while (j < o + NP - 1 && s.q[j + 1] < flow) j++
        const x0 = s.q[j], x1 = s.q[j + 1]
        const y0 = s.wse[j], y1 = s.wse[j + 1]
        w = x1 === x0 ? y0 : y0 + ((y1 - y0) * (flow - x0)) / (x1 - x0)
      }
      const bed = s.bed[i]
      if (w < bed) w = bed
    }
    wseV[i] = roundHalfEven2(w)
  }

  dof.fill(NaN)

  // -- steps 2-3 per path --
  const nPaths = s.pathStarts.length - 1
  for (let p = 0; p < nPaths; p++) {
    const a = s.pathStarts[p], b = s.pathStarts[p + 1]
    const len = b - a

    // observed positions
    const obsPos: number[] = []
    for (let i = a; i < b; i++) if (Number.isFinite(wseV[i])) obsPos.push(i - a)
    const m = obsPos.length
    if (m === 0) continue

    // 3-pt mean over observed values (np.convolve 'same' with zero padding),
    // then edge overwrite sm[0]=sm[1], sm[m-1]=sm[m-2]
    const y = new Float64Array(m)
    for (let k = 0; k < m; k++) y[k] = wseV[a + obsPos[k]]
    const sm = new Float64Array(m)
    if (m === 1) {
      sm[0] = y[0] // reference would crash here; single-obs path keeps its value
    } else {
      const third = 1 / 3
      for (let k = 0; k < m; k++) {
        let acc = 0
        if (k > 0) acc += y[k - 1] * third
        acc += y[k] * third
        if (k < m - 1) acc += y[k + 1] * third
        sm[k] = acc
      }
      sm[0] = sm[1]
      sm[m - 1] = sm[m - 2]
    }

    // limit_rise over the COMPACTED observed array (reference applies it before
    // gap interpolation, so the step distance is always 1 observation, not pixels)
    const MAX_WSE_RISE = 0.01
    let last = sm[0]
    for (let k = 1; k < m; k++) {
      const maxAllowed = last + MAX_WSE_RISE
      if (sm[k] > maxAllowed) sm[k] = maxAllowed
      last = sm[k]
    }

    // np.interp over all positions (clamped at the ends), DoF, max over duplicates
    let seg = 0
    for (let i = a; i < b; i++) {
      const x = i - a
      let w: number
      if (x <= obsPos[0]) w = sm[0]
      else if (x >= obsPos[m - 1]) w = sm[m - 1]
      else {
        while (obsPos[seg + 1] < x) seg++
        const x0 = obsPos[seg], x1 = obsPos[seg + 1]
        w = x === x0
          ? sm[seg]
          : sm[seg] + ((sm[seg + 1] - sm[seg]) * (x - x0)) / (x1 - x0)
      }
      const d = Math.fround(w - s.bed[i])
      const f = s.fspIdx[i]
      if (!(dof[f] >= d)) dof[f] = d // handles NaN-current
    }
  }
  return dof
}

/**
 * Step 4: streaming group-max over the fpp-sorted library.
 * Writes depth into grid (length nrows*ncols, flooded cells only; dry cells get NaN
 * on the touched pixel set). Returns flooded-cell count.
 * The touched pixel set is Q-independent (all unique FPPs), so callers never need
 * to clear the grid between frames.
 */
export function reduceToGrid(lib: LibraryData, dof: Float32Array, grid: Float32Array): number {
  const { n, fpp, fspIdx, dtf, fill } = lib
  let flooded = 0
  let i = 0
  while (i < n) {
    const p = fpp[i]
    const f = fill[i]
    let best = -Infinity
    do {
      const a = Math.fround(dof[fspIdx[i]] - dtf[i]) // NaN dof -> NaN, skipped below
      if (a > best) best = a
      i++
    } while (i < n && fpp[i] === p)
    const depth = Math.fround(best + f)
    if (depth > 0) { grid[p] = depth; flooded++ }
    else grid[p] = NaN
  }
  return flooded
}

/** Convenience: unique FPP count (for stats/preallocation). */
export function countUniqueFpp(fpp: Uint32Array): number {
  let c = fpp.length > 0 ? 1 : 0
  for (let i = 1; i < fpp.length; i++) if (fpp[i] !== fpp[i - 1]) c++
  return c
}
