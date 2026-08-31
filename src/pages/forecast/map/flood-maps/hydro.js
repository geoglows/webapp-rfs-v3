// Both build the Map(riverIndex -> discharge) a frame is rendered from; spec.rivers is keyed by
// riverIndex (mapper.js synthesizeFlows()).
function flowsAtLadderPosition(spec, t) {
  const out = new Map();
  for (const [riverIndex, e] of Object.entries(spec.rivers)) {
    const L = e.ladder;
    const tt = Math.min(Math.max(t, 0), L.length - 1);
    const i0 = Math.floor(tt);
    const i1 = Math.min(i0 + 1, L.length - 1);
    const f = tt - i0;
    out.set(Number(riverIndex), L[i0] + (L[i1] - L[i0]) * f);
  }
  return out;
}

function uniformFlows(spec, q) {
  const out = new Map();
  for (const riverIndex of Object.keys(spec.rivers)) out.set(Number(riverIndex), q);
  return out;
}

export {
  flowsAtLadderPosition,
  uniformFlows
};
