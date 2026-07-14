/**
 * forecastTimeseries.ts — read a river's GEOGLOWS v2 15-day ensemble forecast discharge from a
 * per-initialization-run Zarr store.
 *
 * Two store layouts are supported; the flat override is the one that's active:
 *
 *   NEW DATA STRUCTURE (Hive-partitioned; mirrors the animation cube's forecast15 tree). Kept so the
 *   traversal lives in the codebase for when the forecast timeseries store is colocated there:
 *     <forecast15>/year=YYYY/month=MM/day=DD/discharge.zarr
 *
 *   OVERRIDE (active): a flat store keyed by init datetime stamp. GEOGLOWS runs the forecast at 00Z:
 *     <VITE_FORECAST_ZARR_BASE>/YYYYMMDDHH.zarr        (HH = "00")
 *
 * Store layout (Zarr v2, blosc/zstd), from the CloudFront override store:
 *   rivid    [rivid]                  int32   river id per column        (chunk 213 716)
 *   ensemble [ensemble]               int64   member ids; last (52) = high-resolution deterministic
 *   time     [time]                   int32   "<step> since <init date>"
 *   Qout     [ensemble, time, rivid]  float32 forecast discharge (m³/s), fill NaN
 * A single reach is one rivid-chunk read (ensemble & time are one chunk each), so a river costs one
 * chunk fetch after the one-time ~27 MB `rivid` download used for the id→column lookup.
 *
 * MODEL-DEVELOPMENT NOTE (mirrors timeseries.ts): the clicked river id is ignored — we resolve the
 * fixed DEV_RIVER_ID (a GEOGLOWS v2 id) against `rivid` and slice that column. Pass the clicked id
 * through here (and drop the default) once the id spaces are aligned.
 */
import * as zarr from 'zarrita'
import Blosc from 'numcodecs/blosc'
import { DEV_RIVER_ID } from './timeseries'

export { DEV_RIVER_ID }

// Register the blosc codec statically (same rationale as timeseries.ts — zarrita's lazy dynamic
// import gets tree-shaken out of the production bundle, then blosc decoding throws at runtime).
// Idempotent: timeseries.ts registers the same handles, so importing either module is enough.
const blosc = (() => Promise.resolve(Blosc)) as never
zarr.registry.set('blosc', blosc)
zarr.registry.set('numcodecs.blosc', blosc)

// ---- store location: partitioned "new data structure" vs. the active flat override ----
// Hive-partitioned forecast root (mirrors animation.ts). A day's discharge store hangs off a
// year=/month=/day= partition below it.
const FORECAST15_BASE = ((import.meta.env.VITE_FORECAST15_BASE as string | undefined)
  ?? `${location.origin}/data/forecast15`).replace(/\/+$/, '')
// Flat per-run store base (override). Defaults to the GEOGLOWS forecast CloudFront distribution.
const FLAT_FORECAST_BASE = ((import.meta.env.VITE_FORECAST_ZARR_BASE as string | undefined)
  ?? 'https://d14ritg1bypdp7.cloudfront.net').replace(/\/+$/, '')
// GEOGLOWS initializes the forecast at 00Z, so the flat store's datetime stamp ends in "00".
const FORECAST_INIT_HOUR = '00'

/** NEW DATA STRUCTURE: partitioned discharge store for a forecast-init date (`YYYY-MM-DD`). */
function forecastZarrUrlPartitioned(date: string): string {
  const [y, m, d] = date.split('-')
  return `${FORECAST15_BASE}/year=${y}/month=${m}/day=${d}/discharge.zarr`
}
/** OVERRIDE: flat per-run store `…/YYYYMMDDHH.zarr` for a forecast-init date (`YYYY-MM-DD`). */
function forecastZarrUrlFlat(date: string): string {
  return `${FLAT_FORECAST_BASE}/${date.replace(/-/g, '')}${FORECAST_INIT_HOUR}.zarr`
}
// zarrita's FetchStore resolves keys with `new URL(root)`, which rejects a schemeless base, so a
// root-relative dev path (the Vite forecast proxy, or /data) must be absolutized against the origin.
function absolute(url: string): string {
  return url.startsWith('/') ? `${location.origin}${url}` : url
}
/** Resolve the store URL for a date. The flat override wins whenever its base is configured. */
function forecastZarrUrl(date: string): string {
  return absolute(FLAT_FORECAST_BASE ? forecastZarrUrlFlat(date) : forecastZarrUrlPartitioned(date))
}

// seconds/minutes/hours/days multiplier for the "<step> since <origin>" time units string
const UNIT_SECONDS: Record<string, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 }

export interface ForecastTimeseries {
  riverId: number
  initDate: Date        // forecast initialization datetime (the time-coordinate origin)
  datetime: Date[]      // valid time per step
  ensembleIds: number[] // member ids, in store order (last = high-resolution deterministic)
  ensemble: number[][]  // [member][step] discharge (m³/s)
}

// Open the four arrays for one run and cache the shared coordinates (rivid/ensemble/time).
async function openForecastStore(url: string) {
  const arr = (name: string) => zarr.open.v2(new zarr.FetchStore(`${url}/${name}`), { kind: 'array' })
  const [time, Qout, rividArr, ensembleArr] = await Promise.all([
    arr('time'), arr('Qout'), arr('rivid'), arr('ensemble'),
  ])
  const rividData = (await zarr.get(rividArr)).data as Int32Array
  const ensembleIds = Array.from((await zarr.get(ensembleArr)).data as BigInt64Array, Number)
  // "<step> since <origin>": the origin is the forecast init datetime, shared by every reach
  const units = String(time.attrs.units ?? 'seconds since 1970-01-01')
  const [stepWord, originStr] = units.split('since')
  const factor = UNIT_SECONDS[stepWord.trim()] ?? 1
  const origin = new Date(originStr.trim()).getTime()
  const tData = (await zarr.get(time, [null])).data as Int32Array
  const datetime = Array.from(tData, (s) => new Date(origin + Number(s) * factor * 1000))
  return { Qout, rividData, ensembleIds, datetime, initDate: new Date(origin), index: new Map<number, number>() }
}
type Store = Awaited<ReturnType<typeof openForecastStore>>
// one open store per URL (per forecast date); reopening the same run reuses the rivid array
const stores = new Map<string, Promise<Store>>()

function indexOfRiver(s: Store, riverId: number): number {
  const cached = s.index.get(riverId)
  if (cached != null) return cached
  const i = s.rividData.indexOf(riverId)
  s.index.set(riverId, i)
  return i
}

/** Full ensemble forecast for `riverId` from the run initialized on `date` (`YYYY-MM-DD`). */
export async function fetchForecastTimeseries(
  date: string, riverId: number = DEV_RIVER_ID,
): Promise<ForecastTimeseries> {
  const url = forecastZarrUrl(date)
  let sp = stores.get(url)
  if (!sp) { sp = openForecastStore(url).catch((e) => { stores.delete(url); throw e }); stores.set(url, sp) }
  const s = await sp
  const idx = indexOfRiver(s, riverId)
  if (idx < 0) throw new Error(`river ${riverId} not present in the forecast store for ${date}`)
  // Qout[ensemble, time, rivid] → slice the reach's column: result shape [ensemble, time]
  const sel = await zarr.get(s.Qout, [null, null, idx])
  const data = sel.data as Float32Array
  const [nEns, nT] = sel.shape
  const [sEns, sT] = sel.stride
  const ensemble: number[][] = []
  for (let e = 0; e < nEns; e++) {
    const row = new Array<number>(nT)
    for (let t = 0; t < nT; t++) row[t] = data[e * sEns + t * sT]
    ensemble.push(row)
  }
  return { riverId, initDate: s.initDate, datetime: s.datetime, ensembleIds: s.ensembleIds, ensemble }
}

// ---- derived ensemble statistics for plotting ----
export interface ForecastBands {
  datetime: Date[]
  min: number[]; p25: number[]; median: number[]; p75: number[]; max: number[]; mean: number[]
  highRes: number[]   // the high-resolution deterministic member (ensemble 52)
  memberCount: number // probabilistic members contributing to the band
}

// linear-interpolated quantile of an ascending-sorted array (p in [0,1])
function quantile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return NaN
  const i = (sortedAsc.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (i - lo)
}

/** Per-step spread (min/quartiles/max/mean) over the probabilistic members, plus the high-res run.
 * GEOGLOWS convention: the last member (id 52) is the high-resolution deterministic forecast; the
 * preceding members form the ensemble spread (falls back to all members when there's only one). */
export function deriveForecast(fc: ForecastTimeseries): ForecastBands {
  const n = fc.ensemble.length
  const spread = n > 1 ? fc.ensemble.slice(0, n - 1) : fc.ensemble
  const highResMember = fc.ensemble[n - 1] ?? []
  const b: ForecastBands = {
    datetime: fc.datetime, min: [], p25: [], median: [], p75: [], max: [], mean: [],
    highRes: [], memberCount: spread.length,
  }
  for (let t = 0; t < fc.datetime.length; t++) {
    const col = spread.map((m) => m[t]).filter((v) => Number.isFinite(v)).sort((x, y) => x - y)
    b.min.push(col.length ? col[0] : NaN)
    b.p25.push(quantile(col, 0.25))
    b.median.push(quantile(col, 0.5))
    b.p75.push(quantile(col, 0.75))
    b.max.push(col.length ? col[col.length - 1] : NaN)
    b.mean.push(col.length ? col.reduce((s, v) => s + v, 0) / col.length : NaN)
    b.highRes.push(highResMember[t])
  }
  return b
}
