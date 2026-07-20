import {absolutize} from "./rfsConfig";
import * as urls from "rfsjs/urls";

// ── Hydrography ──────────────────────────────────────────────────────────────
// The package knows where this lives but never fetches it — MapLibre does, so it can only tell us
// the URL. The filename comes from the package too: it defaults to whatever the tree its baked-in
// root publishes. VITE_STREAMS_PMTILES stays because dev serves this 1.7 GB archive from disk
// while the rest of the v3 tree still comes from the CDN — a whole-URL swap the layout can't express.
const STREAMS_PMTILES = import.meta.env.VITE_STREAMS_PMTILES ?? urls.streamsPmtiles();

// ── 15-day forecast tree ─────────────────────────────────────────────────────
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

const DEV_RIVER_ID = 710431167;
const DEV_RIVER_INDEX = 74225;

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
