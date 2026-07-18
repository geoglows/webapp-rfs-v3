import * as zarr from "zarrita";
import Blosc from "numcodecs/blosc";
import { DEV_RIVER_ID } from "./timeseries";
const blosc = (() => Promise.resolve(Blosc));
zarr.registry.set("blosc", blosc);
zarr.registry.set("numcodecs.blosc", blosc);
const FORECAST15_BASE = (import.meta.env.VITE_FORECAST15_BASE ?? `${location.origin}/data/forecast15`).replace(/\/+$/, "");
const FLAT_FORECAST_BASE = (import.meta.env.VITE_FORECAST_ZARR_BASE ?? "https://d14ritg1bypdp7.cloudfront.net").replace(/\/+$/, "");
const FORECAST_INIT_HOUR = "00";
function forecastZarrUrlPartitioned(date) {
  const [y, m, d] = date.split("-");
  return `${FORECAST15_BASE}/year=${y}/month=${m}/day=${d}/discharge.zarr`;
}
function forecastZarrUrlFlat(date) {
  return `${FLAT_FORECAST_BASE}/${date.replace(/-/g, "")}${FORECAST_INIT_HOUR}.zarr`;
}
function absolute(url) {
  return url.startsWith("/") ? `${location.origin}${url}` : url;
}
function forecastZarrUrl(date) {
  return absolute(FLAT_FORECAST_BASE ? forecastZarrUrlFlat(date) : forecastZarrUrlPartitioned(date));
}
const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
async function openForecastStore(url) {
  const arr = (name) => zarr.open.v2(new zarr.FetchStore(`${url}/${name}`), { kind: "array" });
  const [time, Qout, rividArr, ensembleArr] = await Promise.all([
    arr("time"),
    arr("Qout"),
    arr("rivid"),
    arr("ensemble")
  ]);
  const rividData = (await zarr.get(rividArr)).data;
  const ensembleIds = Array.from((await zarr.get(ensembleArr)).data, Number);
  const units = String(time.attrs.units ?? "seconds since 1970-01-01");
  const [stepWord, originStr] = units.split("since");
  const factor = UNIT_SECONDS[stepWord.trim()] ?? 1;
  const origin = new Date(originStr.trim()).getTime();
  const tData = (await zarr.get(time, [null])).data;
  const datetime = Array.from(tData, (s) => new Date(origin + Number(s) * factor * 1e3));
  return { Qout, rividData, ensembleIds, datetime, initDate: new Date(origin), index: /* @__PURE__ */ new Map() };
}
const stores = /* @__PURE__ */ new Map();
function indexOfRiver(s, riverId) {
  const cached = s.index.get(riverId);
  if (cached != null) return cached;
  const i = s.rividData.indexOf(riverId);
  s.index.set(riverId, i);
  return i;
}
async function fetchForecastTimeseries(date, riverId = DEV_RIVER_ID) {
  const url = forecastZarrUrl(date);
  let sp = stores.get(url);
  if (!sp) {
    sp = openForecastStore(url).catch((e) => {
      stores.delete(url);
      throw e;
    });
    stores.set(url, sp);
  }
  const s = await sp;
  const idx = indexOfRiver(s, riverId);
  if (idx < 0) throw new Error(`river ${riverId} not present in the forecast store for ${date}`);
  const sel = await zarr.get(s.Qout, [null, null, idx]);
  const data = sel.data;
  const [nEns, nT] = sel.shape;
  const [sEns, sT] = sel.stride;
  const ensemble = [];
  for (let e = 0; e < nEns; e++) {
    const row = new Array(nT);
    for (let t = 0; t < nT; t++) row[t] = data[e * sEns + t * sT];
    ensemble.push(row);
  }
  return { riverId, initDate: s.initDate, datetime: s.datetime, ensembleIds: s.ensembleIds, ensemble };
}
/** Median of the first `n` entries of `buf` (which this sorts in place). */
function medianOfPrefix(buf, n) {
  if (!n) return NaN;
  const v = buf.subarray(0, n);
  v.sort();
  const h = n >> 1;
  return n % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/** Fill NaN gaps in place by linear interpolation, holding the end values flat. */
function fillGaps(q) {
  const n = q.length;
  let first = -1, last = -1;
  for (let i = 0; i < n; i++) if (Number.isFinite(q[i])) { if (first < 0) first = i; last = i; }
  if (first < 0) return false;
  for (let i = 0; i < first; i++) q[i] = q[first];
  for (let i = last + 1; i < n; i++) q[i] = q[last];
  let i = first;
  while (i < last) {
    let j = i + 1;
    while (!Number.isFinite(q[j])) j++;
    for (let k = i + 1; k < j; k++) q[k] = q[i] + (q[j] - q[i]) * ((k - i) / (j - i));
    i = j;
  }
  return true;
}

/**
 * Ensemble-median hydrographs for many rivers at once, for driving the flood-extent animation.
 * Reuses the per-date store cache above, so the (large) coordinate arrays are fetched once.
 *
 * Qout is chunked across the river axis (~686 rivers per chunk, tens of MB each), so reads are
 * grouped by chunk and each chunk is pulled exactly once — a flood corridor's reaches are adjacent
 * in the store, so a whole selection usually costs one or two chunks instead of one per reach.
 *
 * Rivers absent from the store are reported in `missing` rather than throwing — a selection can
 * legitimately mix reaches that do and don't appear in a given forecast run.
 *
 * The store's time axis is hourly, but the ensemble spread only populates a subset of it (3-hourly
 * over most of the horizon), so the returned axis is compacted to the steps that actually carry
 * ensemble data — every returned step maps a real forecast, with no blank animation frames.
 *
 * Returns `{ datetime, series: Map<riverId, Float64Array>, peak: Map<riverId, number>, missing }`,
 * where each series is the ensemble median at each returned step in m³/s (the unit the FLDPLN
 * rating curves take), and `peak` is that series' maximum — the "Forecast Maximum" flood style.
 */
async function fetchForecastFlows(date, riverIds, onProgress) {
  const url = forecastZarrUrl(date);
  let sp = stores.get(url);
  if (!sp) {
    sp = openForecastStore(url).catch((e) => {
      stores.delete(url);
      throw e;
    });
    stores.set(url, sp);
  }
  const s = await sp;
  const series = /* @__PURE__ */ new Map();
  const peak = /* @__PURE__ */ new Map();
  const missing = [];
  // Resolve every reach to its store row first, then bucket the rows by chunk.
  const byChunk = /* @__PURE__ */ new Map();
  const chunkLen = s.Qout.chunks[2];
  for (const riverId of riverIds) {
    const idx = indexOfRiver(s, riverId);
    if (idx < 0) {
      missing.push(riverId);
      continue;
    }
    const c = Math.floor(idx / chunkLen);
    const bucket = byChunk.get(c);
    if (bucket) bucket.push([riverId, idx]);
    else byChunk.set(c, [[riverId, idx]]);
  }
  let done = 0;
  const found = riverIds.length - missing.length;
  for (const bucket of byChunk.values()) {
    // One read per chunk, spanning only the rows actually wanted inside it.
    const lo = Math.min(...bucket.map(([, i]) => i));
    const hi = Math.max(...bucket.map(([, i]) => i));
    const sel = await zarr.get(s.Qout, [null, null, zarr.slice(lo, hi + 1)]);
    const data = sel.data;
    const [nEns, nT] = sel.shape;
    const [sEns, sT, sR] = sel.stride;
    // Median across the ensemble spread (all but the trailing high-res member, matching
    // deriveForecast) — the central estimate the animation maps.
    const spreadCount = nEns > 1 ? nEns - 1 : nEns;
    const col = new Float64Array(spreadCount);
    for (const [riverId, idx] of bucket) {
      const r = (idx - lo) * sR;
      const q = new Float64Array(nT);
      for (let t = 0; t < nT; t++) {
        let m = 0;
        for (let e = 0; e < spreadCount; e++) {
          const v = data[e * sEns + t * sT + r];
          if (Number.isFinite(v)) col[m++] = v;
        }
        q[t] = medianOfPrefix(col, m);
      }
      series.set(riverId, q);
      onProgress?.(++done, found);
    }
  }
  // Compact the hourly axis down to the steps the ensemble actually populates. A step is kept if
  // any reach has data there; a reach missing that particular step is interpolated across.
  const nT = s.datetime.length;
  const keep = [];
  for (let t = 0; t < nT; t++) {
    for (const q of series.values()) {
      if (Number.isFinite(q[t])) { keep.push(t); break; }
    }
  }
  const datetime = keep.map((t) => s.datetime[t]);
  for (const [riverId, q] of [...series]) {
    const c = new Float64Array(keep.length);
    for (let i = 0; i < keep.length; i++) c[i] = q[keep[i]];
    if (!fillGaps(c)) {
      // Present in the store but with no ensemble data at all — treat as unforecast.
      series.delete(riverId);
      missing.push(riverId);
      continue;
    }
    series.set(riverId, c);
    let mx = 0;
    for (let i = 0; i < c.length; i++) if (c[i] > mx) mx = c[i];
    peak.set(riverId, mx);
  }
  return { date, datetime, series, peak, missing };
}

function quantile(sortedAsc, p) {
  if (!sortedAsc.length) return NaN;
  const i = (sortedAsc.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (i - lo);
}
function deriveForecast(fc) {
  const n = fc.ensemble.length;
  const spread = n > 1 ? fc.ensemble.slice(0, n - 1) : fc.ensemble;
  const highResMember = fc.ensemble[n - 1] ?? [];
  const b = {
    datetime: fc.datetime,
    min: [],
    p25: [],
    median: [],
    p75: [],
    max: [],
    mean: [],
    highRes: [],
    memberCount: spread.length
  };
  for (let t = 0; t < fc.datetime.length; t++) {
    const col = spread.map((m) => m[t]).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
    b.min.push(col.length ? col[0] : NaN);
    b.p25.push(quantile(col, 0.25));
    b.median.push(quantile(col, 0.5));
    b.p75.push(quantile(col, 0.75));
    b.max.push(col.length ? col[col.length - 1] : NaN);
    b.mean.push(col.length ? col.reduce((s, v) => s + v, 0) / col.length : NaN);
    b.highRes.push(highResMember[t]);
  }
  return b;
}
export {
  DEV_RIVER_ID,
  deriveForecast,
  fetchForecastFlows,
  fetchForecastTimeseries
};
