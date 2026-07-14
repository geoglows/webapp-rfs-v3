/**
 * hydro.ts — turn UI state into a per-COMID discharge vector.
 *
 * Modes:
 *  - ladder slider: continuous position along the per-COMID discharge ladder
 *    (demo ladders are medians of rating-curve q_i — labeled as such, NOT return periods)
 *  - uniform Q: one user-specified discharge applied to every reach
 *  - synthetic hydrograph: rise-peak-recession between baseflow and a chosen
 *    ladder level, for exercising animation offline
 */
import type { FlowsSpec } from './tileData'

export function flowsAtLadderPosition(spec: FlowsSpec, t: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const [comid, e] of Object.entries(spec.comids)) {
    const L = e.ladder
    const tt = Math.min(Math.max(t, 0), L.length - 1)
    const i0 = Math.floor(tt)
    const i1 = Math.min(i0 + 1, L.length - 1)
    const f = tt - i0
    out.set(Number(comid), L[i0] + (L[i1] - L[i0]) * f)
  }
  return out
}

export function uniformFlows(spec: FlowsSpec, q: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const comid of Object.keys(spec.comids)) out.set(Number(comid), q)
  return out
}

/**
 * Synthetic hydrograph shape on [0,1]: gamma-like rise and recession,
 * s(t) = (t/tp)^2 * exp(2*(1 - t/tp)) with peak at tp. s(tp) = 1.
 */
export function hydrographShape(t: number, tp = 0.35): number {
  if (t <= 0) return 0
  const r = t / tp
  return r * r * Math.exp(2 * (1 - r))
}

export function hydrographFlows(
  spec: FlowsSpec,
  t: number, // 0..1 through the event
  peakLadderPos: number,
): Map<number, number> {
  const s = hydrographShape(t)
  const peak = flowsAtLadderPosition(spec, peakLadderPos)
  const out = new Map<number, number>()
  for (const [comid, e] of Object.entries(spec.comids)) {
    const qp = peak.get(Number(comid)) ?? e.qBase
    out.set(Number(comid), e.qBase + (qp - e.qBase) * s)
  }
  return out
}
