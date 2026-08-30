import {build, cancel, clear, isBuilding, status} from "./riverIndex.js";
import {clearAll} from "./db.js";
import * as names from "./riverNames.js";

/**
 * The catalogue of things the user can download and keep on the device: what each one is called,
 * how big it is right now, and how to fetch, cancel, and erase it.
 *
 * An entry earns its place by being something a feature actually reads and would otherwise refetch.
 * That is a smaller set than "data the app can reach": most of what the stores publish is read
 * on demand and never wants caching, and the sorted riverId -> riverIndex lookup gets no entry
 * because it is how the search uses the river IDs, not a second thing to download. What belongs
 * here is decided when a feature needs it, not in advance.
 *
 * Everything here is a cache. Erasing any of it costs a re-download and nothing else, which is why
 * clearing needs no ceremony beyond the sweeping button's confirm.
 *
 * Adding one is a single entry: `status` reporting `{n, bytes}` or null, `download({onProgress})`,
 * a `cancel`, a `remove`, and optionally `busy` for a dataset something outside Settings can start
 * fetching. The Settings list renders whatever is in here and names nothing.
 */
const DATASETS = [
  {
    key: "riverIds",
    label: "settings.data.riverIds",
    hint: "settings.data.riverIds.hint",
    /** `{n, bytes}` when held, else null. Reads the meta record, never the arrays it describes. */
    status: async () => {
      const meta = await status();
      // Two typed arrays of n int32s: the ids ascending and the axis position of each.
      return meta ? {n: meta.n, bytes: meta.n * 8} : null;
    },
    download: build,
    cancel,
    remove: clear,
    /** True while a build is in flight — this app prefetches this one after load. */
    busy: isBuilding
  },
  {
    key: "riverNames",
    label: "settings.data.riverNames",
    hint: "settings.data.riverNames.hint",
    /** `{n, bytes}` when held, else null. The row count and the weight of the file it came from. */
    status: async () => {
      const meta = await names.status();
      return meta ? {n: meta.n, bytes: meta.bytes} : null;
    },
    /**
     * Forced, because this is the button a user presses when they want the newest names — the
     * unforced path is the monthly boundary, and it would answer "already fresh" and do nothing.
     * There is no progress to report: one request for ~100 kB, against the river IDs' hundreds.
     */
    download: () => names.refresh({force: true}),
    // A single small request. Nothing to abort that would finish before the abort did.
    cancel: () => {},
    remove: names.clear
  }
];

const byKey = (key) => DATASETS.find((d) => d.key === key);

/**
 * Every dataset's current state, in list order: `{key, label, hint, status, busy}` — status null
 * when it isn't held, busy true while a download is in flight, whoever started it.
 */
const surveyAll = () => Promise.all(DATASETS.map(async (d) => ({
  key: d.key,
  label: d.label,
  hint: d.hint,
  status: await d.status().catch(() => null),
  busy: d.busy?.() ?? false
})));

/**
 * Erase the lot. Clears every store rather than looping the registry's `remove`s, so a record left
 * behind by a dataset this version no longer lists goes too — otherwise "delete everything" quietly
 * isn't, and the orphan is exactly what a later version would trip over.
 */
async function removeAll() {
  await clearAll();
  // The registry's own invalidation still has to run: clearing the store doesn't drop the copies
  // features are holding in memory.
  await Promise.all(DATASETS.map((d) => d.remove().catch(() => {})));
}

export {DATASETS, byKey, removeAll, surveyAll};
