function flowsAtLadderPosition(spec, t) {
  const out = new Map();
  for (const [riverId, e] of Object.entries(spec.rivers)) {
    const L = e.ladder;
    const tt = Math.min(Math.max(t, 0), L.length - 1);
    const i0 = Math.floor(tt);
    const i1 = Math.min(i0 + 1, L.length - 1);
    const f = tt - i0;
    out.set(Number(riverId), L[i0] + (L[i1] - L[i0]) * f);
  }
  return out;
}

function uniformFlows(spec, q) {
  const out = new Map();
  for (const riverId of Object.keys(spec.rivers)) out.set(Number(riverId), q);
  return out;
}

export {
  flowsAtLadderPosition,
  uniformFlows
};
