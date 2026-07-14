/**
 * timeseries.ts — read a river's full retrospective discharge record from the GEOGLOWS v2 daily
 * Zarr store (VITE_RETROSPECTIVE_DAILY_ZARR).
 *
 * Fetching is patterned after geoglows-apps/rfs-v2-hydroviewer (src/data/zarrUtilities.js + data.js):
 * each variable is opened as its own v2 store and read whole, the `time` coordinate is converted
 * from its `units` attribute ("<step> since <origin>"), and `river_id` is fetched once and cached
 * for indexOf lookups. Variables:
 *   river_id [river]        int32   catchment id per column
 *   time     [time]         float64 seconds since 1940-01-01
 *   Q        [time, river]  float32 daily mean discharge (m³/s)
 *
 * MODEL-DEVELOPMENT NOTE: the clicked river id is ignored for now — we always resolve the fixed
 * DEV_RIVER_ID against `river_id` and slice that column. Pass the clicked id through here (and drop
 * the default) once the retrospective store's id space is aligned with the streams layer.
 */
import * as zarr from 'zarrita'
import Blosc from 'numcodecs/blosc'

// zarrita loads its blosc codec via a lazy dynamic import, which Rollup tree-shakes out of the
// production bundle (blosc decoding would then throw at runtime). Register it statically so the
// codec is bundled. Every array in this store is blosc-compressed — the internal cname (lz4 for
// river_id/time, zstd for Q) is handled by the one blosc WASM — so blosc is all we need.
// cast past a benign type-variance mismatch between numcodecs' Blosc and zarrita's CodecEntry
const blosc = (() => Promise.resolve(Blosc)) as never
zarr.registry.set('blosc', blosc)
zarr.registry.set('numcodecs.blosc', blosc)

const DAILY_ZARR_URL = import.meta.env.VITE_RETROSPECTIVE_DAILY_ZARR as string | undefined

/** During model development, always inspect this river regardless of which reach was clicked. */
export const DEV_RIVER_ID = 710431167

export interface RiverTimeseries {
  riverId: number
  datetime: Date[]
  discharge: number[]
}

// seconds/minutes/hours/days multiplier for the "<step> since <origin>" time units string
const UNIT_SECONDS: Record<string, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 }

// Open each variable as its own v2 store (reference pattern) and cache the handles. river_id
// (~27 MB) is downloaded once so repeated clicks only fetch the small time/Q reads.
async function openStore() {
  if (!DAILY_ZARR_URL) throw new Error('VITE_RETROSPECTIVE_DAILY_ZARR is not set')
  const arr = (name: string) => zarr.open.v2(new zarr.FetchStore(`${DAILY_ZARR_URL}/${name}`), { kind: 'array' })
  const [time, Q, riverIdArr] = await Promise.all([arr('time'), arr('Q'), arr('river_id')])
  const riverIdData = (await zarr.get(riverIdArr)).data as Int32Array
  // convert the time coordinate to Date[] up front — it is shared by every river
  const units = String(time.attrs.units ?? 'seconds since 1970-01-01')
  const [stepWord, originStr] = units.split('since')
  const factor = UNIT_SECONDS[stepWord.trim()] ?? 1
  const origin = new Date(originStr.trim()).getTime()
  const tData = (await zarr.get(time, [null])).data as Float64Array
  const datetime = Array.from(tData, (s) => new Date(origin + Number(s) * factor * 1000))
  return { Q, riverIdData, datetime, index: new Map<number, number>() }
}
type Store = Awaited<ReturnType<typeof openStore>>
let storePromise: Promise<Store> | null = null

function indexOfRiver(s: Store, riverId: number): number {
  const cached = s.index.get(riverId)
  if (cached != null) return cached
  const i = s.riverIdData.indexOf(riverId)
  s.index.set(riverId, i)
  return i
}

/** Full retrospective daily discharge series for `riverId`. */
export async function fetchRiverTimeseries(riverId: number = DEV_RIVER_ID): Promise<RiverTimeseries> {
  if (!storePromise) storePromise = openStore().catch((e) => { storePromise = null; throw e })
  const s = await storePromise
  const idx = indexOfRiver(s, riverId)
  if (idx < 0) throw new Error(`river ${riverId} not present in the retrospective store`)
  const q = (await zarr.get(s.Q, [null, idx])).data as Float32Array
  return { riverId, datetime: s.datetime, discharge: Array.from(q) }
}
