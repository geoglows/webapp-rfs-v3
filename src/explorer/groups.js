/**
 * Which publication group a reach belongs to.
 *
 * The geometry is published one GeoParquet per group, so an export cannot start without knowing
 * which one to open — and the stream tiles do not carry a group. `streams.pmtiles` declares
 * riverId, riverIndex, upstreamCount, the two orders, the two areas, length, TDXHydroRegion and the
 * two neighbours, and that is all; the only place a group is written down is the `groupId` column
 * of the global metadata table.
 *
 * That column is one int per river across 4.8 million rivers, which sounds like the wrong thing to
 * read to answer one question. It is not: a group is a whole set of watersheds and the riverIndex
 * axis is ordered by watershed, so every group is one unbroken run of the axis — 108 runs for the
 * whole world. The column compresses to about 4 kB per row group, the table is read by byte range,
 * and what comes back is a list short enough to binary-search.
 *
 * Read in the geometry worker rather than here, because that is where hyparquet and the ZSTD
 * decoder already are — pulling them onto the main thread to read 18 kB would put ~200 kB into the
 * page's own bundle. Loaded on demand, once: the first export pays for it and everything after,
 * including the group shown beside a selection, is a lookup.
 */
import {URLS} from './config.js';

/** `[{lo, hi, groupId}]`, ascending and non-overlapping, or null until the table has been read. */
let runs = null;
/** The read in flight, so a second caller joins it rather than starting another worker. */
let pending = null;

function readRuns() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./geomWorker.js', import.meta.url), {type: 'module'});
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data?.type === 'groups') return resolve(e.data.runs);
      reject(new Error(e.data?.key ?? e.data?.message ?? 'the group table could not be read'));
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'the group table could not be read'));
    };
    worker.postMessage({job: 'groups', url: URLS.metadata});
  });
}

/** Read the group table if it has not been read. Coalesces; a failure is retried on the next call. */
export function loadGroups() {
  if (runs) return Promise.resolve(runs);
  pending ??= readRuns()
    .then((list) => (runs = list))
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * The group `riverIndex` belongs to, or null — either because the table is not here yet or because
 * the index is off the end of the axis. Synchronous by design: the readout beside a selection asks
 * on every repaint, and after the first export the answer is already in memory.
 */
export function groupOf(riverIndex) {
  if (!runs || !Number.isFinite(riverIndex)) return null;
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const run = runs[mid];
    if (riverIndex < run.lo) hi = mid - 1;
    else if (riverIndex > run.hi) lo = mid + 1;
    else return run.groupId;
  }
  return null;
}

/**
 * The group publishing every reach between `lo` and `hi`, or null if they are not all in one.
 *
 * They should always be: a group is a set of whole watersheds and a selection never reaches past
 * the watershed it was cut from, so both ends land in the same run. The check is here because the
 * alternative to noticing is an export that quietly writes half a selection — one group's file
 * cannot contain the other group's reaches.
 */
export function groupOfRange(lo, hi) {
  const at = groupOf(lo);
  return at != null && at === groupOf(hi) ? at : null;
}
