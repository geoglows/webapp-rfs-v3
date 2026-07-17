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
  fetchForecastTimeseries
};
