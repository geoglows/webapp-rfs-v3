// Every data URL the app uses, obtained from the rfsjs package.
//
// The package owns the v3 layout — which directory a store lives in, how a date is partitioned,
// what the style tables are called. This module does not rebuild any of that; it calls the
// package's url builders (`urls.*`) and adds only what is genuinely app-side: the styleset ->
// directory mapping, which is this app's picker vocabulary, and the flood tile-boundary layer,
// which the package neither knows nor reads.
//
// Overrides: the roots are repointed via configure() in rfsConfig.js (VITE_RFS_V3_BASE,
// VITE_FIM_DATA_URL), which moves every derived URL at once. The per-URL VITE_* vars below are the
// finer-grained escape hatch for pointing one file somewhere else while the tree is in flux —
// each falls back to the package's answer when unset, so nothing here hardcodes a layout.
//
// rfsConfig must be imported before this module so those overrides are in effect by the time the
// builders below run at module scope; main.js does that, and this import makes it true regardless.
import {absolutize} from "./rfsConfig";
// The /urls subpath is the url builders only — importing them from the package root would pull
// zarrita and every reader into the main bundle, which is exactly what the app's dynamic imports
// of the package (floodController, chartsDock) exist to avoid.
import * as urls from "rfsjs/urls";

// ── Hydrography ──────────────────────────────────────────────────────────────
// The package knows where this lives but never fetches it — MapLibre does, so it can only tell us
// the URL. The filename comes from the package too: it defaults to whatever the tree its baked-in
// root publishes. VITE_STREAMS_PMTILES stays because dev serves this 1.7 GB archive from disk
// while the rest of the v3 tree still comes from the CDN — a whole-URL swap the layout can't express.
const STREAMS_PMTILES = import.meta.env.VITE_STREAMS_PMTILES ?? urls.streamsPmtiles();

// ── 15-day forecast tree ─────────────────────────────────────────────────────

/**
 * URLs of the two style-table files for one styleset on one forecast date, or null if the styleset
 * has no tables — "standard" paints a uniform network and is the only such case today.
 *
 * `styleset` is a key of urls.stylesets, which is also what index.html's <option value>s and the
 * switches in animation.js use. There is deliberately no app-side map from picker value to folder
 * name: that table is what let the picker, the code and the tree drift apart, and it is why one
 * folder rename previously had to be made in four places.
 *
 * urls.streamsStyles returns a prefix ending in `styles.` rather than a whole filename — one
 * styleset's tables differ only by extension — so the extension is appended here.
 */
function mapStyleUrls(date, styleset) {
  const dir = urls.stylesets[styleset];
  if (!dir) return null;
  const prefix = urls.streamsStyles({date, styleset: dir});
  return {json: `${prefix}json`, bin: `${prefix}bin`};
}

/** Today in UTC as YYYY-MM-DD — the default forecast initialization date. */
function todayUtc() {
  const d = new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

const DEFAULT_FORECAST_DATE = import.meta.env.VITE_FORECAST_DEFAULT_DATE ?? todayUtc();

// ── Flood library (FLDPLN) ───────────────────────────────────────────────────
// The flood library is entirely the app's now — map/fim/ reads these stores directly — so its
// location is settled here rather than routed through the package's endpoint config. One env var,
// one default, no indirection.
//
// Root serving manifest.json + the per-tile zarr stores the flood worker reads. The worker is a
// separate module instance and cannot see anything computed on this thread, so it is handed this
// value in its init message — see ensureWorker() in map/fim/floodController.js.
const FIM_DATA_URL = absolutize(import.meta.env.VITE_FIM_DATA_URL ?? "/data/fim");
// Vector footprints of those data tiles, used to work out what the viewport covers. Built by
// scripts/build_fim_tile_boundaries.mjs from the flood manifest, and read only by MapLibre.
const FIM_TILES_URL = `${FIM_DATA_URL}/tile_boundaries.pmtiles`;
// Below this zoom the viewport can cover hundreds of data tiles; loading every one's header
// would be a request storm, so coverage only loads once you're zoomed in to work.
const FIM_MIN_COVERAGE_ZOOM = 7;

// ── Development stand-ins ────────────────────────────────────────────────────
// The charts fetch this reach instead of the clicked one while the model is in development.
// The zarr stores are indexed by riverIndex (the dense store row the vector tiles carry per
// reach), so that is what the readers are given; the id is kept for display only.
const DEV_RIVER_ID = 710431167;
const DEV_RIVER_INDEX = 0;

export {
  DEFAULT_FORECAST_DATE,
  DEV_RIVER_ID,
  DEV_RIVER_INDEX,
  FIM_DATA_URL,
  FIM_MIN_COVERAGE_ZOOM,
  FIM_TILES_URL,
  STREAMS_PMTILES,
  mapStyleUrls
};
