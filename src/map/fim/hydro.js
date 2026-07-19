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

export {
  flowsAtLadderPosition,
  uniformFlows
};
