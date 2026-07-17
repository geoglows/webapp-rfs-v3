function flowsAtLadderPosition(spec, t) {
  const out = /* @__PURE__ */ new Map();
  for (const [comid, e] of Object.entries(spec.comids)) {
    const L = e.ladder;
    const tt = Math.min(Math.max(t, 0), L.length - 1);
    const i0 = Math.floor(tt);
    const i1 = Math.min(i0 + 1, L.length - 1);
    const f = tt - i0;
    out.set(Number(comid), L[i0] + (L[i1] - L[i0]) * f);
  }
  return out;
}
function uniformFlows(spec, q) {
  const out = /* @__PURE__ */ new Map();
  for (const comid of Object.keys(spec.comids)) out.set(Number(comid), q);
  return out;
}
function hydrographShape(t, tp = 0.35) {
  if (t <= 0) return 0;
  const r = t / tp;
  return r * r * Math.exp(2 * (1 - r));
}
function hydrographFlows(spec, t, peakLadderPos) {
  const s = hydrographShape(t);
  const peak = flowsAtLadderPosition(spec, peakLadderPos);
  const out = /* @__PURE__ */ new Map();
  for (const [comid, e] of Object.entries(spec.comids)) {
    const qp = peak.get(Number(comid)) ?? e.qBase;
    out.set(Number(comid), e.qBase + (qp - e.qBase) * s);
  }
  return out;
}
export {
  flowsAtLadderPosition,
  hydrographFlows,
  hydrographShape,
  uniformFlows
};
