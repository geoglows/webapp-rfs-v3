import {computeDofSlice, NP, reduceSliceToCanvas} from "./kernel.js";
import {buildLut, lutIndex} from "./colormap.js";
import {buildMercatorRowMap} from "./mercator.js";

const MAX_CANVAS_PX = 16e6;
const lut = buildLut();

const median = (v) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// Which of the synthetic rating curve's NP points the discharge slider can stop on, and what each
// is called. The bottom three are every point there is: the curve's first steps are where a reach
// goes from a trickle to in-bank flow, so that is the part worth resolving one point at a time.
// Above them the curve is sampled coarsely, because up there a step is a large discharge either way.
// Kept in step with the fallback copy of the labels in floodController.js, which is what the panel
// shows until the worker has sent a spec.
const LADDER_IDX = [0, 1, 2, 7, 11, 14, 17, 21, 24, 27, 29];
const LADDER_LABELS = ["q1", "q2", "q3", "q8", "q12", "q15", "q18", "q22", "q25", "q28", "q30"];

/**
 * The flood extent for one selection of river slices, rendered on a canvas sized to the corridor
 * those reaches cover. Built once per selection, then driven with a discharge per reach — one
 * frame() call per animation step.
 *
 * Rows are laid out on the source arc-second grid, so the canvas is resampled to Web Mercator on
 * the way out (rowMap) and can be pinned straight to its geographic bounds by the consumer.
 */
class FloodMapper {
  /** Build the mapper for a selection, or null when those reaches have no flood pixels. */
  static forSlices(slices) {
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
    return new FloodMapper(slices, {row0: r0, col0: c0, width: c1 - c0 + 1, height: r1 - r0 + 1});
  }

  constructor(slices, {row0, col0, width, height}) {
    if (width * height > MAX_CANVAS_PX) {
      throw new Error(`corridor canvas ${width}x${height} exceeds the ${MAX_CANVAS_PX.toLocaleString()} px cap — select fewer reaches`);
    }
    this.slices = slices;
    this.row0 = row0;
    this.col0 = col0;
    this.width = width;
    this.height = height;
    // every pixel's offset into the canvas, precomputed once so clearing and colorizing a frame
    // only touch the cells this selection actually owns
    this.offsets = slices.map((s) => {
      const off = new Int32Array(s.nPix);
      for (let i = 0; i < s.nPix; i++) off[i] = (s.pixRow[i] - row0) * width + (s.pixCol[i] - col0);
      return off;
    });
    const px = 1 / 3600;
    this.bounds = {
      north: 90 - (row0 - 0.5) * px,
      south: 90 - (row0 + height - 0.5) * px,
      west: (col0 - 0.5) * px - 180,
      east: (col0 + width - 0.5) * px - 180
    };
    let maxVisits = 0;
    for (const s of slices) maxVisits = Math.max(maxVisits, s.nVisit);
    this.dof = slices.map((s) => new Float32Array(s.nFsp));
    this.scratch = {wse: new Float64Array(maxVisits)};
    this.grid = new Float32Array(width * height).fill(NaN);
    this.srcRgba = new Uint32Array(width * height);
    this.outRgba = new Uint32Array(width * height);
    this.rowMap = buildMercatorRowMap(this.bounds.north, this.bounds.south, height, height);
  }

  /** How much library data this selection pulled in, for the consumer to report. */
  stats() {
    let relations = 0, pixels = 0;
    for (const s of this.slices) {
      relations += s.relFspLocal.length;
      pixels += s.nPix;
    }
    return {
      slices: this.slices.length,
      tiles: new Set(this.slices.map((s) => s.tile)).size,
      pixels,
      relations
    };
  }

  /**
   * Per-reach baseflow and a ladder of rating-curve discharges, taken as medians over the reach's
   * visited stream pixels. This is what the "Synthetic Rating Curve Slider" flood style interpolates
   * along when there is no forecast to drive the extent.
   */
  synthesizeFlows() {
    const byRiver = /* @__PURE__ */ new Map();
    for (const s of this.slices) {
      const list = byRiver.get(s.riverId);
      if (list) list.push(s);
      else byRiver.set(s.riverId, [s]);
    }
    const rivers = {};
    for (const [riverId, group] of byRiver) {
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
      rivers[String(riverId)] = {qBase: median(qBase) || 0, ladder: perIdx.map(median)};
    }
    return {source: "rating-curve medians (per selection)", ladderLabels: LADDER_LABELS, rivers};
  }

  /**
   * Render one frame for a Map of riverId -> discharge. Reaches missing from the map keep no water.
   * Returns the RGBA buffer (transferable) plus how much of the canvas came out flooded.
   */
  frame(flows) {
    const t0 = performance.now();
    for (const off of this.offsets) {
      const g = this.grid;
      for (let i = 0; i < off.length; i++) g[off[i]] = NaN;
    }
    let floodedCells = 0;
    for (let k = 0; k < this.slices.length; k++) {
      const s = this.slices[k];
      const flow = flows.get(s.riverId);
      if (flow === void 0) continue;
      computeDofSlice(s, flow, this.dof[k], this.scratch);
      floodedCells += reduceSliceToCanvas(s, this.dof[k], this.grid, this.row0, this.col0, this.width);
    }
    for (let k = 0; k < this.offsets.length; k++) {
      const off = this.offsets[k];
      for (let i = 0; i < off.length; i++) {
        const p = off[i];
        const d = this.grid[p];
        this.srcRgba[p] = Number.isNaN(d) ? 0 : lut[lutIndex(d)];
      }
    }
    const w = this.width;
    for (let r = 0; r < this.height; r++) {
      const src = this.rowMap[r] * w;
      this.outRgba.set(this.srcRgba.subarray(src, src + w), r * w);
    }
    return {
      rgba: this.outRgba.slice().buffer,
      width: w,
      height: this.height,
      floodedCells,
      computeMs: performance.now() - t0
    };
  }

  /** Depth at one global arc-second grid cell, or null where the last frame left it dry. */
  query(row, col) {
    const r = row - this.row0;
    const c = col - this.col0;
    if (r < 0 || r >= this.height || c < 0 || c >= this.width) return null;
    const d = this.grid[r * this.width + c];
    return Number.isNaN(d) ? null : d;
  }

  /** The last frame's wet/dry mask, for writing out as a GeoTIFF. */
  extent() {
    const extent = new Uint8Array(this.grid.length);
    let flooded = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (!Number.isNaN(this.grid[i])) {
        extent[i] = 1;
        flooded++;
      }
    }
    return {extent: extent.buffer, width: this.width, height: this.height, bounds: this.bounds, flooded};
  }
}

export {FloodMapper, MAX_CANVAS_PX};
