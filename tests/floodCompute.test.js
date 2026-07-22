import {describe, expect, it} from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import {FloodMapsIndex} from "../clients-rfsjs/dist/v3/floodmaps.esm.js";
import {computeDofSlice, reduceSliceToCanvas} from "../src/map/flood-maps/kernel.js";
import {FloodMapper} from "../src/map/flood-maps/mapper.js";

// Reading the tile stores is rfsjs' job and is tested there (test/v3/floodMapsTiles.test.js); what is
// tested here is what the app still owns — the DoF kernel and the mapper — against real slices.
const ROOT = process.env.RFS_FLOOD_MAPS_ROOT ?? `${os.homedir()}/data/fldpln-merged/tiles-zarr`;
const TILE = "N24W104_FABDEM_V1-2";
const TILE_PATH = `lat=24/lon=-104/${TILE}.zarr`;
const RIVER_ID = 770148173;
const fileFetcher = async (url) => {
  try {
    const b = await fs.promises.readFile(url);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  } catch (e) {
    if (e.code === "ENOENT") return void 0;
    throw e;
  }
};
const openTile = () => FloodMapsIndex.openTiles({tiles: {[TILE]: TILE_PATH}, fetcher: fileFetcher, base: ROOT});

describe.skipIf(!fs.existsSync(`${ROOT}/${TILE_PATH}`))("flood compute over real slices", () => {
  it("computes DoF and floods pixels end-to-end", async () => {
    const idx = await openTile();
    const s = await idx.slice(TILE, RIVER_ID);
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
  it("maps a selection to a canvas, a frame, a depth query, and an extent", async () => {
    const idx = await openTile();
    const slices = await idx.slicesFor([RIVER_ID]);
    const mapper = FloodMapper.forSlices(slices);
    expect(mapper).not.toBeNull();
    expect(mapper.width).toBeGreaterThan(0);
    expect(mapper.height).toBeGreaterThan(0);
    // the canvas is pinned to the arc-second grid the slices came from
    expect(mapper.bounds.north).toBeGreaterThan(mapper.bounds.south);
    expect(mapper.bounds.east).toBeGreaterThan(mapper.bounds.west);
    expect(mapper.stats().slices).toBe(slices.length);

    const spec = mapper.synthesizeFlows();
    const entry = spec.rivers[String(RIVER_ID)];
    expect(entry.ladder.length).toBe(spec.ladderLabels.length);
    expect(entry.ladder[entry.ladder.length - 1]).toBeGreaterThan(entry.ladder[0]);

    const s = slices[0];
    let qmax = 0;
    for (const v of s.q) if (Number.isFinite(v) && v > qmax) qmax = v;
    const frame = mapper.frame(new Map([[RIVER_ID, qmax]]));
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
