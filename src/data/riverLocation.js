import {fetchMetadataAt} from "riverforecastsystem/v3/hydrography";
import {readEntry, writeEntry} from "./timeseriesDb.js";

/**
 * Where a reach is, by riverIndex: `{lat, lon, upstreamCount}` read straight off the hydrography
 * metadata store.
 *
 * The point is the reach's downstream end, which is what the saved rivers in src/constants.js were
 * baked from — so a searched river and a saved one send the camera to the same kind of place.
 *
 * Three chunk reads, ~40 KB each, and no artifact to build or keep: the arrays sit on the same axis
 * as the riverIds, so an index is all it takes to read one. That is why this is looked up when a
 * reach needs it rather than downloaded up front like the id lookup next door — one reach costs a
 * fraction of a percent of what the whole axis would.
 *
 * `upstreamCount` rides along for the explorer, whose selection is the run of riverIndex above the
 * reach and cannot be built without it. This app ignores it. One read either way.
 */
// Searching the same reach twice, or flying to one whose charts are already open, must not go back
// to the network. Bounded only by how many reaches a session visits, at two numbers each.
const known = new Map();

/**
 * The whole table in one record rather than a record per reach.
 *
 * A reach's position is three numbers. As one record per reach they would be hundreds of entries
 * of fifty bytes, and the cache's entry cap — sized for series that are half a megabyte each —
 * would spend itself on them and evict the downloads it exists to keep. As one record they are a
 * single kilobyte-scale entry that no series ever competes with.
 */
const CACHE_KEY = "ts:locations";

// The read that fills `known` from the device, once. A cache that cannot be read is not an error
// here: it means the first look at each reach costs its three chunk reads, as it did before.
let hydrated = null;
const hydrate = () => (hydrated ??= readEntry(CACHE_KEY)
  .then((rows) => {
    for (const [index, at] of Object.entries(rows ?? {})) {
      if (!known.has(Number(index))) known.set(Number(index), at);
    }
  })
  .catch(() => {}));

async function locate(riverIndex) {
  const index = Number(riverIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  await hydrate();
  const cached = known.get(index);
  if (cached) return cached;
  const {lat, lon, upstreamCount} = await fetchMetadataAt({variables: ["lat", "lon", "upstreamCount"], index});
  // A store that answers with something other than a coordinate is not a place to fly to. Better to
  // leave the camera where it is than to send it to (0, 0).
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const at = {lat, lon, upstreamCount};
  known.set(index, at);
  // Not awaited: the caller is waiting to move a camera, and whether this reach is still here on
  // the next visit is not its problem. A write that fails is a lookup that happens again.
  void writeEntry(CACHE_KEY, Object.fromEntries(known)).catch(() => {});
  return at;
}

/**
 * Drop the session's copy, so emptying the cache on disk actually empties it: without this the next
 * reach looked up would write the whole in-memory table straight back over what was just cleared.
 */
function forget() {
  known.clear();
  hydrated = null;
}

export {forget, locate};
