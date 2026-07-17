import { computeDofSlice, reduceSliceToCanvas, NP } from "./kernel";
import { FimIndex } from "./zarrTiles";
import { buildLut, lutIndex } from "./colormap";
import { buildMercatorRowMap } from "./mercator";
const MAX_CANVAS_PX = 16e6;
let index = null;
let lut;
let ses = null;
const median = (v) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const LADDER_IDX = [2, 7, 11, 14, 17, 21, 24, 27, 29];
const LADDER_LABELS = ["q3", "q8", "q12", "q15", "q18", "q22", "q25", "q28", "q30"];
function synthesizeFlows(slices) {
  const byComid = /* @__PURE__ */ new Map();
  for (const s of slices) {
    const list = byComid.get(s.comid);
    if (list) list.push(s);
    else byComid.set(s.comid, [s]);
  }
  const comids = {};
  for (const [comid, group] of byComid) {
    const qBase = [];
    const perIdx = LADDER_IDX.map(() => []);
    for (const s of group) {
      for (let i = 0; i < s.nVisit; i++) {
        const o = i * NP;
        if (Number.isNaN(s.q[o])) continue;
        if (Number.isFinite(s.qBaseflow[i])) qBase.push(s.qBaseflow[i]);
        for (let k = 0; k < LADDER_IDX.length; k++) perIdx[k].push(s.q[o + LADDER_IDX[k]]);
      }
    }
    comids[String(comid)] = { qBase: median(qBase) || 0, ladder: perIdx.map(median) };
  }
  return { source: "rating-curve medians (per selection)", ladderLabels: LADDER_LABELS, comids };
}
function buildSession(slices) {
  let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  for (const s of slices) {
    for (let i = 0; i < s.nPix; i++) {
      const r = s.pixRow[i], c = s.pixCol[i];
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
    }
  }
  if (!Number.isFinite(r0)) return null;
  const width = c1 - c0 + 1;
  const height = r1 - r0 + 1;
  if (width * height > MAX_CANVAS_PX) {
    throw new Error(`corridor canvas ${width}x${height} exceeds the ${MAX_CANVAS_PX.toLocaleString()} px cap — select fewer reaches`);
  }
  const offsets = slices.map((s) => {
    const off = new Int32Array(s.nPix);
    for (let i = 0; i < s.nPix; i++) off[i] = (s.pixRow[i] - r0) * width + (s.pixCol[i] - c0);
    return off;
  });
  const px = 1 / 3600;
  const bounds = {
    north: 90 - (r0 - 0.5) * px,
    south: 90 - (r1 + 0.5) * px,
    west: (c0 - 0.5) * px - 180,
    east: (c1 + 0.5) * px - 180
  };
  let maxVisits = 0;
  for (const s of slices) maxVisits = Math.max(maxVisits, s.nVisit);
  return {
    slices,
    offsets,
    dof: slices.map((s) => new Float32Array(s.nFsp)),
    scratch: { wse: new Float64Array(maxVisits) },
    row0: r0,
    col0: c0,
    width,
    height,
    bounds,
    grid: new Float32Array(width * height).fill(NaN),
    srcRgba: new Uint32Array(width * height),
    outRgba: new Uint32Array(width * height),
    rowMap: buildMercatorRowMap(bounds.north, bounds.south, height, height)
  };
}
self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      index = await FimIndex.open(msg.dataBase);
      lut = buildLut();
      self.postMessage({ type: "ready", nTiles: index.tilePath.size });
    } else if (msg.type === "viewport") {
      if (!index) throw new Error("worker not initialized");
      const coverage = await index.setActiveTiles(msg.tiles);
      self.postMessage(
        {
          type: "coverage",
          coverage: coverage.buffer,
          nActiveTiles: index.activeTiles.size,
          nRivers: index.comidTiles.size
        },
        [coverage.buffer]
      );
    } else if (msg.type === "select") {
      if (!index) throw new Error("worker not initialized");
      const comids = msg.comids;
      const slices = await index.slicesFor(comids);
      ses = buildSession(slices);
      if (!ses) {
        self.postMessage({ type: "selected", id: msg.id, empty: true });
        return;
      }
      let nRel = 0, nPix = 0;
      for (const s of slices) {
        nRel += s.relFspLocal.length;
        nPix += s.nPix;
      }
      self.postMessage({
        type: "selected",
        id: msg.id,
        empty: false,
        bounds: ses.bounds,
        width: ses.width,
        height: ses.height,
        flows: synthesizeFlows(slices),
        stats: {
          slices: slices.length,
          tiles: new Set(slices.map((s) => s.tile)).size,
          pixels: nPix,
          relations: nRel
        }
      });
    } else if (msg.type === "frame") {
      if (!ses) throw new Error("no selection");
      const t0 = performance.now();
      const flowMap = new Map(msg.flows);
      for (const off of ses.offsets) {
        const g = ses.grid;
        for (let i = 0; i < off.length; i++) g[off[i]] = NaN;
      }
      let floodedCells = 0;
      for (let k = 0; k < ses.slices.length; k++) {
        const s = ses.slices[k];
        const flow = flowMap.get(s.comid);
        if (flow === void 0) continue;
        computeDofSlice(s, flow, ses.dof[k], ses.scratch);
        floodedCells += reduceSliceToCanvas(s, ses.dof[k], ses.grid, ses.row0, ses.col0, ses.width);
      }
      for (let k = 0; k < ses.offsets.length; k++) {
        const off = ses.offsets[k];
        for (let i = 0; i < off.length; i++) {
          const p = off[i];
          const d = ses.grid[p];
          ses.srcRgba[p] = Number.isNaN(d) ? 0 : lut[lutIndex(d)];
        }
      }
      const w = ses.width;
      for (let r = 0; r < ses.height; r++) {
        const src = ses.rowMap[r] * w;
        ses.outRgba.set(ses.srcRgba.subarray(src, src + w), r * w);
      }
      const computeMs = performance.now() - t0;
      const buf = ses.outRgba.slice().buffer;
      self.postMessage(
        {
          type: "frame",
          id: msg.id,
          rgba: buf,
          width: w,
          height: ses.height,
          floodedCells,
          computeMs
        },
        [buf]
      );
    } else if (msg.type === "query") {
      let depth = null;
      if (ses) {
        const r = msg.row - ses.row0;
        const c = msg.col - ses.col0;
        if (r >= 0 && r < ses.height && c >= 0 && c < ses.width) {
          const d = ses.grid[r * ses.width + c];
          depth = Number.isNaN(d) ? null : d;
        }
      }
      self.postMessage({ type: "query", id: msg.id, depth });
    } else if (msg.type === "export") {
      if (!ses) {
        self.postMessage({ type: "export", id: msg.id, extent: null });
        return;
      }
      const extent = new Uint8Array(ses.grid.length);
      let flooded = 0;
      for (let i = 0; i < ses.grid.length; i++) {
        if (!Number.isNaN(ses.grid[i])) {
          extent[i] = 1;
          flooded++;
        }
      }
      const buf = extent.buffer;
      self.postMessage(
        {
          type: "export",
          id: msg.id,
          extent: buf,
          width: ses.width,
          height: ses.height,
          bounds: ses.bounds,
          tile: "corridor",
          flooded
        },
        [buf]
      );
    }
  } catch (err) {
    self.postMessage({ type: "error", message: err.message ?? String(err) });
  }
};
