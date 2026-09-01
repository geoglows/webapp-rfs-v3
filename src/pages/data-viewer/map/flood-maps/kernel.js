const NP = 30;

function roundHalfEven2(x) {
  const scaled = x * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let r;
  if (diff > 0.5) r = floor + 1;
  else if (diff < 0.5) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1;
  return r / 100;
}

function computeDofSlice(s, flow, dof, scratch) {
  const n = s.nVisit;
  const wseV = scratch?.wse ?? new Float64Array(n);
  const flowOk = Number.isFinite(flow);
  for (let i = 0; i < n; i++) {
    const o = i * NP;
    if (!flowOk || Number.isNaN(s.q[o])) {
      wseV[i] = NaN;
      continue;
    }
    let w;
    if (flow <= s.qBaseflow[i]) {
      w = s.bed[i];
    } else if (flow >= s.q[o + NP - 1]) {
      w = s.wse[o + NP - 1];
    } else {
      if (flow <= s.q[o]) {
        w = s.wse[o];
      } else {
        let j = o;
        while (j < o + NP - 1 && s.q[j + 1] < flow) j++;
        const x0 = s.q[j], x1 = s.q[j + 1];
        const y0 = s.wse[j], y1 = s.wse[j + 1];
        w = x1 === x0 ? y0 : y0 + (y1 - y0) * (flow - x0) / (x1 - x0);
      }
      const bed = s.bed[i];
      if (w < bed) w = bed;
    }
    wseV[i] = roundHalfEven2(w);
  }
  dof.fill(NaN);
  const nRuns = s.runStarts.length - 1;
  for (let p = 0; p < nRuns; p++) {
    const a = s.runStarts[p], b = s.runStarts[p + 1];
    const obsPos = [];
    for (let i = a; i < b; i++) if (Number.isFinite(wseV[i])) obsPos.push(i - a);
    const m = obsPos.length;
    if (m === 0) continue;
    const y = new Float64Array(m);
    for (let k = 0; k < m; k++) y[k] = wseV[a + obsPos[k]];
    const sm = new Float64Array(m);
    if (m === 1) {
      sm[0] = y[0];
    } else {
      const third = 1 / 3;
      for (let k = 0; k < m; k++) {
        let acc = 0;
        if (k > 0) acc += y[k - 1] * third;
        acc += y[k] * third;
        if (k < m - 1) acc += y[k + 1] * third;
        sm[k] = acc;
      }
      sm[0] = sm[1];
      sm[m - 1] = sm[m - 2];
    }
    const MAX_WSE_RISE = 0.01;
    let last = sm[0];
    for (let k = 1; k < m; k++) {
      const maxAllowed = last + MAX_WSE_RISE;
      if (sm[k] > maxAllowed) sm[k] = maxAllowed;
      last = sm[k];
    }
    let seg = 0;
    for (let i = a; i < b; i++) {
      const x = i - a;
      let w;
      if (x <= obsPos[0]) w = sm[0];
      else if (x >= obsPos[m - 1]) w = sm[m - 1];
      else {
        while (obsPos[seg + 1] < x) seg++;
        const x0 = obsPos[seg], x1 = obsPos[seg + 1];
        w = x === x0 ? sm[seg] : sm[seg] + (sm[seg + 1] - sm[seg]) * (x - x0) / (x1 - x0);
      }
      const d = Math.fround(w - s.bed[i]);
      if (Number.isNaN(d)) continue;
      const f = s.fspLocal[i];
      if (!(dof[f] >= d)) dof[f] = d;
    }
  }
  return dof;
}

function reduceSliceToCanvas(lib, dof, grid, canvasRow0, canvasCol0, canvasW) {
  let flooded = 0;
  let off = 0;
  for (let i = 0; i < lib.nPix; i++) {
    const cnt = lib.relCount[i];
    let best = -Infinity;
    for (let k = 0; k < cnt; k++) {
      const a = Math.fround(dof[lib.relFspLocal[off + k]] - lib.relDtf[off + k]);
      if (a > best) best = a;
    }
    off += cnt;
    const depth = Math.fround(best + lib.fill[i]);
    if (depth > 0) {
      const p = (lib.pixRow[i] - canvasRow0) * canvasW + (lib.pixCol[i] - canvasCol0);
      const cur = grid[p];
      if (!(cur >= depth)) {
        if (Number.isNaN(cur)) flooded++;
        grid[p] = depth;
      }
    }
  }
  return flooded;
}

export {
  NP,
  computeDofSlice,
  reduceSliceToCanvas,
  roundHalfEven2
};
