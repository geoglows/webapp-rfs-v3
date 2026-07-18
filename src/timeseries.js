import * as zarr from "zarrita";
import Blosc from "numcodecs/blosc";
import { DEV_RIVER_ID, RETROSPECTIVE_DAILY_ZARR as DAILY_ZARR_URL } from "./constants";
const blosc = (() => Promise.resolve(Blosc));
zarr.registry.set("blosc", blosc);
zarr.registry.set("numcodecs.blosc", blosc);
const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
async function openStore() {
  if (!DAILY_ZARR_URL) throw new Error("VITE_RETROSPECTIVE_DAILY_ZARR is not set");
  const arr = (name) => zarr.open.v2(new zarr.FetchStore(`${DAILY_ZARR_URL}/${name}`), { kind: "array" });
  const [time, Q, riverIdArr] = await Promise.all([arr("time"), arr("Q"), arr("river_id")]);
  const riverIdData = (await zarr.get(riverIdArr)).data;
  const units = String(time.attrs.units ?? "seconds since 1970-01-01");
  const [stepWord, originStr] = units.split("since");
  const factor = UNIT_SECONDS[stepWord.trim()] ?? 1;
  const origin = new Date(originStr.trim()).getTime();
  const tData = (await zarr.get(time, [null])).data;
  const datetime = Array.from(tData, (s) => new Date(origin + Number(s) * factor * 1e3));
  return { Q, riverIdData, datetime, index: /* @__PURE__ */ new Map() };
}
let storePromise = null;
function indexOfRiver(s, riverId) {
  const cached = s.index.get(riverId);
  if (cached != null) return cached;
  const i = s.riverIdData.indexOf(riverId);
  s.index.set(riverId, i);
  return i;
}
async function fetchRiverTimeseries(riverId = DEV_RIVER_ID) {
  if (!storePromise) storePromise = openStore().catch((e) => {
    storePromise = null;
    throw e;
  });
  const s = await storePromise;
  const idx = indexOfRiver(s, riverId);
  if (idx < 0) throw new Error(`river ${riverId} not present in the retrospective store`);
  const q = (await zarr.get(s.Q, [null, idx])).data;
  return { riverId, datetime: s.datetime, discharge: Array.from(q) };
}
export {
  DEV_RIVER_ID,
  fetchRiverTimeseries
};
