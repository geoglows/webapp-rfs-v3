/**
 * The read-through cache in front of the discharge readers: look in IndexedDB, and only go to the
 * network for what isn't there.
 *
 * This is the v2 hydroviewer's pattern (src/data/main.js there) — check, fetch, store, return — and
 * the same reasoning holds. A reach's retrospective record is decades of daily values; a forecast is
 * an ensemble across a fortnight. Both are read again every time the user comes back to a river they
 * have already looked at, and neither changes between those two looks.
 *
 * ── Freshness is in the key ──
 * Nothing here expires on a timer. A forecast belongs to the initialization date it was fetched for,
 * so its date is part of its key and a new forecast is simply a key the cache has never seen. The
 * retrospective record has no such stamp of its own, so it takes one: the UTC date shifted back
 * twelve hours, which turns over once a day. A record cached yesterday is not invalidated — it is
 * left to age out of the cache while today's read goes and gets the appended tail.
 *
 * Nothing in here is required: a cache that cannot be read is a fetch, and a cache that cannot be
 * written is a fetch next time too. Every storage call is allowed to fail on its own.
 */
import {clear, readEntry, summary, writeEntry} from "./timeseriesDb.js";
import {forget as forgetLocations} from "./riverLocation.js";

const dischargeReaders = () => import("riverforecastsystem/v3/discharge");

/**
 * The day a retrospective read belongs to: the UTC date twelve hours ago.
 *
 * The offset is what makes this a boundary rather than a race. The store's daily append lands in
 * the small hours UTC, so keying on today's date would have every device asking for the new tail
 * the moment the clock rolled over — before it is there — and then holding the answer all day.
 */
const retroDay = () => new Date(Date.now() - 12 * 3600 * 1000).toISOString().slice(0, 10);

/** Cache reads are advisory: a miss and a broken cache are the same instruction — go and fetch. */
const peek = (key) => readEntry(key).catch(() => undefined);

/**
 * `fetch()`'s result, from the cache when it is there and from the network when it isn't.
 *
 * `cacheable` decides whether what came back is worth keeping — a forecast that arrived without its
 * warning levels is still a chart, but caching it would make one bad read of the threshold store
 * stick to the river for as long as the entry lives.
 */
async function readThrough(key, fetch, cacheable = () => true) {
  const hit = await peek(key);
  if (hit !== undefined) return hit;
  const data = await fetch();
  if (cacheable(data)) void writeEntry(key, data).catch(() => {});
  return data;
}

/** A reach's simulated record. `{riverIndex, time, discharge}`, cached for the day. */
function retrospective({riverIndex, riverId, resolution = "daily"}) {
  return readThrough(
    `ts:retro:${resolution}:${riverIndex ?? riverId}:${retroDay()}`,
    async () => (await dischargeReaders()).retrospective({resolution, riverIndex, riverId})
  );
}

/**
 * A reach's forecast and the warning levels it is read against, cached under the initialization
 * date it was fetched for.
 *
 * The pair is cached as a pair rather than as two entries. Splitting them would mean writing out
 * the rule that lets the thresholds fail without costing the hydrograph — which is the whole reason
 * forecastWithLevels() exists in the package — a second time, here.
 */
function forecastWithLevels({riverIndex, riverId, date, resolution = "hourly"}) {
  return readThrough(
    `ts:forecast:${date}:${resolution}:${riverIndex ?? riverId}`,
    async () => (await dischargeReaders()).forecastWithLevels({date, riverIndex, riverId, resolution}),
    (pair) => pair?.returnPeriods != null
  );
}

/**
 * Empty everything browsing has put on the device, and let go of what is still held in memory —
 * a cache the user has just cleared must not come back from a copy the page was sitting on.
 */
async function clearCache() {
  await clear();
  forgetLocations();
}

export {clearCache, forecastWithLevels, retrospective, summary};
