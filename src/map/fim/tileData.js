import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { NP, findPathStarts } from "./kernel";
const num = (v) => typeof v === "bigint" ? Number(v) : v == null ? NaN : v;
async function loadLibrary(file) {
  const rows = await parquetReadObjects({
    file,
    compressors,
    columns: ["fpp", "fspIdx", "dtf_mm", "fill_mm"]
  });
  const n = rows.length;
  const fpp = new Uint32Array(n);
  const fspIdx = new Uint16Array(n);
  const dtf = new Float32Array(n);
  const fill = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    fpp[i] = num(r.fpp);
    fspIdx[i] = num(r.fspIdx);
    dtf[i] = Math.fround(num(r.dtf_mm) / 1e3);
    fill[i] = Math.fround(num(r.fill_mm) / 1e3);
  }
  for (let i = 1; i < n; i++) {
    if (fpp[i] < fpp[i - 1]) throw new Error("library.parquet is not sorted by fpp");
  }
  return { n, fpp, fspIdx, dtf, fill };
}
async function loadStreams(file, nFsp) {
  const qCols = Array.from({ length: NP }, (_, i) => `q_${i + 1}`);
  const wCols = Array.from({ length: NP }, (_, i) => `wse_${i + 1}`);
  const rows = await parquetReadObjects({
    file,
    compressors,
    columns: [
      "pathId",
      "fspIdx",
      "pixel",
      "comid",
      "bed",
      "hasCurve",
      "elevVdt",
      "qBaseflow",
      ...qCols,
      ...wCols
    ]
  });
  const n = rows.length;
  const s = {
    n,
    nFsp,
    pathId: new Uint16Array(n),
    fspIdx: new Uint16Array(n),
    pixel: new Uint32Array(n),
    comid: new Float64Array(n),
    bed: new Float32Array(n),
    hasCurve: new Uint8Array(n),
    elevVdt: new Float64Array(n),
    qBaseflow: new Float64Array(n),
    q: new Float64Array(n * NP),
    wse: new Float64Array(n * NP),
    pathStarts: new Int32Array(0)
  };
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    s.pathId[i] = num(r.pathId);
    s.fspIdx[i] = num(r.fspIdx);
    s.pixel[i] = num(r.pixel);
    s.comid[i] = num(r.comid);
    s.bed[i] = num(r.bed);
    s.hasCurve[i] = r.hasCurve ? 1 : 0;
    s.elevVdt[i] = num(r.elevVdt);
    s.qBaseflow[i] = num(r.qBaseflow);
    for (let k = 0; k < NP; k++) {
      s.q[i * NP + k] = num(r[qCols[k]]);
      s.wse[i * NP + k] = num(r[wCols[k]]);
    }
  }
  s.pathStarts = findPathStarts(s.pathId);
  return s;
}
export {
  loadLibrary,
  loadStreams
};
