import * as zarr from "zarrita";
const httpFetcher = async (url) => {
  const r = await fetch(url);
  if (r.status === 404) return void 0;
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.arrayBuffer();
};
function fetcherStore(baseUrl, fetcher) {
  return {
    async get(key) {
      const buf = await fetcher(`${baseUrl}${key}`);
      return buf === void 0 ? void 0 : new Uint8Array(buf);
    }
  };
}
const mPerMm = (v) => {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = Math.fround(v[i] / 1e3);
  return out;
};
const globalize = (v, origin) => {
  const out = new Int32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] + origin;
  return out;
};
class FimIndex {
  constructor(dataBase, fetcher, tilePath, comidTiles) {
    this.dataBase = dataBase;
    this.fetcher = fetcher;
    this.tilePath = tilePath;
    this.comidTiles = comidTiles;
  }
  dataBase;
  fetcher;
  tilePath;
  comidTiles;
  tiles = /* @__PURE__ */ new Map();
  slices = /* @__PURE__ */ new Map();
  // `${tile}/${comid}`
  activeTiles = /* @__PURE__ */ new Set();
  // tiles whose rivers.comid have been folded into comidTiles (viewport-driven coverage)
  /**
   * dataBase serves the tiles-zarr root: manifest.json and the lat=*\/lon=*\/*.zarr stores.
   * Coverage starts empty — call setActiveTiles() to fold viewport tiles' rivers into it.
   */
  static async open(dataBase, fetcher = httpFetcher) {
    const base = dataBase.replace(/\/+$/, "");
    const manBuf = await fetcher(`${base}/manifest.json`);
    if (!manBuf) throw new Error(`manifest.json not found under ${base}`);
    const manifest = JSON.parse(new TextDecoder().decode(manBuf));
    const tilePath = /* @__PURE__ */ new Map();
    for (const [name, t] of Object.entries(manifest.tiles)) tilePath.set(name, t.path);
    // Coverage is built up from the tiles the viewport actually touches, via setActiveTiles():
    // each tile's own rivers.comid list (read from its zarr.json header) is the source of truth.
    return new FimIndex(base, fetcher, tilePath, /* @__PURE__ */ new Map());
  }
  /** Dev/test entry: open named tiles directly (no manifest needed);
   * coverage is built from each tile's own directory. */
  static async openTiles(dataBase, tiles, fetcher = httpFetcher) {
    const idx = new FimIndex(
      dataBase.replace(/\/+$/, ""),
      fetcher,
      new Map(Object.entries(tiles)),
      /* @__PURE__ */ new Map()
    );
    for (const name of idx.tilePath.keys()) {
      const h = await idx.tile(name);
      for (const c of h.attrs.rivers.comid) {
        const list = idx.comidTiles.get(c);
        if (list) list.push(name);
        else idx.comidTiles.set(c, [name]);
      }
    }
    return idx;
  }
  /** All comids with flood-library coverage (transfer-friendly). */
  coverage() {
    return Uint32Array.from(this.comidTiles.keys());
  }
  hasCoverage(comid) {
    return this.comidTiles.has(comid);
  }
  /**
   * Fold the given tiles' river lists into coverage (comid -> tiles), loading each new tile's
   * header once. Accumulates: a tile stays active after it leaves the viewport, so coverage
   * only grows as the user pans. Returns the current coverage comids (transfer-friendly).
   *
   * Caveat: a river spanning several tiles is only fully covered once every tile it touches
   * has been made active — a reach whose flood library extends into an off-screen tile is
   * under-covered until that tile is panned into view.
   */
  async setActiveTiles(names) {
    for (const name of names) {
      if (this.activeTiles.has(name) || !this.tilePath.has(name)) continue;
      this.activeTiles.add(name);
      let h;
      try {
        h = await this.tile(name);
      } catch {
        this.activeTiles.delete(name);
        this.tiles.delete(name);
        continue;
      }
      for (const c of h.attrs.rivers.comid) {
        const list = this.comidTiles.get(c);
        if (list) {
          if (!list.includes(name)) list.push(name);
        } else {
          this.comidTiles.set(c, [name]);
        }
      }
    }
    return this.coverage();
  }
  tile(name) {
    let h = this.tiles.get(name);
    if (!h) {
      h = this.openTile(name);
      this.tiles.set(name, h);
    }
    return h;
  }
  async openTile(name) {
    const path = this.tilePath.get(name);
    if (!path) throw new Error(`tile ${name} not in manifest`);
    const storeUrl = `${this.dataBase}/${path}`;
    const metaBuf = await this.fetcher(`${storeUrl}/zarr.json`);
    if (!metaBuf) throw new Error(`zarr.json missing for ${name}`);
    const attrs = JSON.parse(new TextDecoder().decode(metaBuf)).attributes;
    if (!attrs.schemaVersion?.startsWith("tiles-1.")) {
      throw new Error(`${name}: unsupported store schema ${attrs.schemaVersion}`);
    }
    const rank = /* @__PURE__ */ new Map();
    attrs.rivers.comid.forEach((c, i) => rank.set(c, i));
    const root = zarr.root(fetcherStore(storeUrl, this.fetcher));
    return { attrs, rank, root, arrays: /* @__PURE__ */ new Map() };
  }
  array(h, name) {
    let a = h.arrays.get(name);
    if (!a) {
      a = zarr.open(h.root.resolve(name), { kind: "array" });
      h.arrays.set(name, a);
    }
    return a;
  }
  async read1d(h, name, start, count) {
    const arr = await this.array(h, name);
    if (count === 0) {
      return new (arr.shape.length ? Uint8Array : Uint8Array)(0);
    }
    const res = await zarr.get(arr, [zarr.slice(start, start + count)]);
    return res.data;
  }
  async read2d(h, name, start, count) {
    if (count === 0) return new Float32Array(0);
    const arr = await this.array(h, name);
    const res = await zarr.get(arr, [zarr.slice(start, start + count), null]);
    return res.data;
  }
  /** Load (and cache) one river's slice from one tile. */
  slice(tileName, comid) {
    const key = `${tileName}/${comid}`;
    let s = this.slices.get(key);
    if (!s) {
      s = this.loadSlice(tileName, comid);
      this.slices.set(key, s);
    }
    return s;
  }
  async loadSlice(tileName, comid) {
    const h = await this.tile(tileName);
    const r = h.rank.get(comid);
    if (r === void 0) throw new Error(`comid ${comid} not in tile ${tileName}`);
    const d = h.attrs.rivers;
    const { gRow0, gCol0 } = h.attrs.grid;
    const vs = d.visitStart[r];
    const vc = d.visitCount[r];
    const ps = d.pixStart[r];
    const pc = d.pixCount[r];
    const rs = d.relStart[r];
    const rc = d.relCount[r];
    const [fspLocal, sRow, sCol, bed, qBaseflow, q, wse, pixRow, pixCol, fill, relCount, relFspLocal, relDtf] = await Promise.all([
      this.read1d(h, "streams/fsp_local", vs, vc),
      this.read1d(h, "streams/row", vs, vc),
      this.read1d(h, "streams/col", vs, vc),
      this.read1d(h, "streams/bed", vs, vc),
      this.read1d(h, "streams/q_baseflow", vs, vc),
      this.read2d(h, "streams/q", vs, vc),
      this.read2d(h, "streams/wse", vs, vc),
      this.read1d(h, "library/pix_row", ps, pc),
      this.read1d(h, "library/pix_col", ps, pc),
      this.read1d(h, "library/fill_mm", ps, pc),
      this.read1d(h, "library/rel_count", ps, pc),
      this.read1d(h, "library/fsp_local", rs, rc),
      this.read1d(h, "library/dtf_mm", rs, rc)
    ]);
    const runs = d.runStarts[r];
    const runStarts = new Int32Array(runs.length + 1);
    runStarts.set(runs);
    runStarts[runs.length] = vc;
    return {
      comid,
      tile: tileName,
      nVisit: vc,
      nFsp: d.fspCount[r],
      runStarts,
      fspLocal,
      row: globalize(sRow, gRow0),
      col: globalize(sCol, gCol0),
      bed,
      qBaseflow,
      q,
      wse,
      nPix: pc,
      pixRow: globalize(pixRow, gRow0),
      pixCol: globalize(pixCol, gCol0),
      fill: mPerMm(fill),
      relCount,
      relFspLocal,
      relDtf: mPerMm(relDtf)
    };
  }
  /**
   * Fetch every (tile, comid) slice for the selected rivers. Comids without coverage are
   * silently skipped (callers gate UI on hasCoverage). A river crossing tiles yields one
   * slice per owning tile; the slices are disjoint by construction and compose by
   * scatter-max in the global frame.
   */
  async slicesFor(comids) {
    const jobs = [];
    for (const c of comids) {
      for (const t of this.comidTiles.get(c) ?? []) jobs.push(this.slice(t, c));
    }
    return Promise.all(jobs);
  }
}
export {
  FimIndex,
  httpFetcher
};
