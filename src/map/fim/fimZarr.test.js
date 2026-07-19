import {describe, expect, it} from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import {FimIndex} from "./zarrTiles.js";
import {computeDofSlice, reduceSliceToCanvas} from "./kernel.js";
import {FloodMapper} from "./mapper.js";

const ROOT = `${os.homedir()}/data/fldpln-merged/tiles-zarr`;
const TILE = "N24W104_FABDEM_V1-2";
const TILE_PATH = `lat=24/lon=-104/${TILE}.zarr`;
const G_ROW0 = Math.round((90 - (24 + 1.1)) * 3600);
const G_COL0 = Math.round((-104 - 0.1 + 180) * 3600);
const fileFetcher = async (url) => {
  try {
    const b = await fs.promises.readFile(url);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  } catch (e) {
    if (e.code === "ENOENT") return void 0;
    throw e;
  }
};
describe.skipIf(!fs.existsSync(`${ROOT}/${TILE_PATH}`))("fim zarr stores", () => {
  

  it("loads a river slice with correct shapes and global coordinates", async () => {
    const idx = await FimIndex.openTiles(ROOT, {[TILE]: TILE_PATH}, fileFetcher);
    expect(idx.comidTiles.size).toBe(159);
    const s = await idx.slice(TILE, 770148173);
    expect(s.nVisit).toBe(280);
    expect(s.relFspLocal.length).toBe(31193);
    expect(s.relDtf.length).toBe(31193);
    let relSum = 0;
    for (const c of s.relCount) relSum += c;
    expect(relSum).toBe(31193);
    expect(s.runStarts[0]).toBe(0);
    expect(s.runStarts[s.runStarts.length - 1]).toBe(s.nVisit);
    expect(s.q.length).toBe(s.nVisit * 30);
    for (const v of [s.row[0], s.row[s.nVisit - 1], s.pixRow[0], s.pixRow[s.nPix - 1]]) {
      expect(v).toBeGreaterThanOrEqual(G_ROW0);
      expect(v).toBeLessThan(G_ROW0 + 4320);
    }
    for (const v of [s.col[0], s.pixCol[0], s.pixCol[s.nPix - 1]]) {
      expect(v).toBeGreaterThanOrEqual(G_COL0);
      expect(v).toBeLessThan(G_COL0 + 4320);
    }
    let dtfMax = 0;
    for (const d of s.relDtf) if (d > dtfMax) dtfMax = d;
    expect(dtfMax).toBeGreaterThan(0);
    expect(dtfMax).toBeLessThanOrEqual(25.5);
  });
  it("computes DoF and floods pixels end-to-end", async () => {
    const idx = await FimIndex.openTiles(ROOT, {[TILE]: TILE_PATH}, fileFetcher);
    const s = await idx.slice(TILE, 770148173);
    let qmax = 0;
    for (const v of s.q) if (Number.isFinite(v) && v > qmax) qmax = v;
    expect(qmax).toBeGreaterThan(0);
    const dof = new Float32Array(s.nFsp);
    computeDofSlice(s, qmax, dof);
    let finite = 0;
    for (const d of dof) if (Number.isFinite(d)) finite++;
    expect(finite).toBeGreaterThan(0);
    let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
    for (let i = 0; i < s.nPix; i++) {
      if (s.pixRow[i] < r0) r0 = s.pixRow[i];
      if (s.pixRow[i] > r1) r1 = s.pixRow[i];
      if (s.pixCol[i] < c0) c0 = s.pixCol[i];
      if (s.pixCol[i] > c1) c1 = s.pixCol[i];
    }
    const W = c1 - c0 + 1;
    const grid = new Float32Array(W * (r1 - r0 + 1)).fill(NaN);
    const flooded = reduceSliceToCanvas(s, dof, grid, r0, c0, W);
    expect(flooded).toBeGreaterThan(0);
    let dmax = 0;
    for (const g of grid) if (!Number.isNaN(g) && g > dmax) dmax = g;
    expect(dmax).toBeGreaterThan(0);
    expect(dmax).toBeLessThan(700);
  });
  it.skipIf(!fs.existsSync(`${ROOT}/manifest.json`))(
    "opens via manifest and builds coverage from active (viewport) tiles",
    async () => {
      const idx = await FimIndex.open(ROOT, fileFetcher);
      expect(idx.tilePath.size).toBe(1106);
      // no global comid->tile index anymore; coverage is empty until a tile is made active
      expect(idx.comidTiles.size).toBe(0);
      const coverage = await idx.setActiveTiles([TILE]);
      expect(idx.activeTiles.has(TILE)).toBe(true);
      expect(coverage.length).toBe(idx.comidTiles.size);
      expect(coverage.length).toBeGreaterThan(0);
      expect(idx.comidTiles.get(770148173)).toContain(TILE);
      const slices = await idx.slicesFor([770148173]);
      expect(slices.length).toBeGreaterThanOrEqual(1);
    }
  );
  it("maps a selection to a canvas, a frame, a depth query, and an extent", async () => {
    const idx = await FimIndex.openTiles(ROOT, {[TILE]: TILE_PATH}, fileFetcher);
    const slices = await idx.slicesFor([770148173]);
    const mapper = FloodMapper.forSlices(slices);
    expect(mapper).not.toBeNull();
    expect(mapper.width).toBeGreaterThan(0);
    expect(mapper.height).toBeGreaterThan(0);
    // the canvas is pinned to the arc-second grid the slices came from
    expect(mapper.bounds.north).toBeGreaterThan(mapper.bounds.south);
    expect(mapper.bounds.east).toBeGreaterThan(mapper.bounds.west);
    expect(mapper.stats().slices).toBe(slices.length);

    const spec = mapper.synthesizeFlows();
    const entry = spec.comids["770148173"];
    expect(entry.ladder.length).toBe(spec.ladderLabels.length);
    expect(entry.ladder[entry.ladder.length - 1]).toBeGreaterThan(entry.ladder[0]);

    const s = slices[0];
    let qmax = 0;
    for (const v of s.q) if (Number.isFinite(v) && v > qmax) qmax = v;
    const frame = mapper.frame(new Map([[770148173, qmax]]));
    expect(frame.floodedCells).toBeGreaterThan(0);
    expect(frame.rgba.byteLength).toBe(mapper.width * mapper.height * 4);

    // every stream pixel the reach visits sits inside the canvas, and the wettest of them has depth
    let queried = 0;
    for (let i = 0; i < s.nPix; i++) {
      if (mapper.query(s.pixRow[i], s.pixCol[i]) > 0) queried++;
    }
    expect(queried).toBeGreaterThan(0);
    expect(mapper.query(mapper.row0 - 1, mapper.col0)).toBeNull();

    const out = mapper.extent();
    expect(out.flooded).toBe(frame.floodedCells);
    expect(out.extent.byteLength).toBe(mapper.width * mapper.height);
  });
});
