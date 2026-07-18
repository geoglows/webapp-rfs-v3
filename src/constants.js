// ── Hosts ────────────────────────────────────────────────────────────────────
// Base of the co-located data tree; every other data URL falls back to a path under it.
const DATA_BASE = import.meta.env.VITE_DATA_URL ?? `${location.origin}/data`;

// ── Hydrography ──────────────────────────────────────────────────────────────
const STREAMS_PMTILES = import.meta.env.VITE_STREAMS_PMTILES ?? `${DATA_BASE}/streams.pmtiles`;

// ── 15-day forecast tree ─────────────────────────────────────────────────────
// Traversed as <base>/<date partition>/<map-styles dir>/<styleset dir>/styles.{json,bin}, e.g.
//   forecast15/year=2026/month=07/day=10/map-styles/q-time-series/styles.json
// Every segment is env-driven so the tree can be reorganized without touching app code.
const FORECAST15_BASE = (import.meta.env.VITE_FORECAST15_BASE ?? `${DATA_BASE}/forecast15`).replace(/\/+$/, "");

// Date partition template. {YYYY}/{MM}/{DD} are substituted from the forecast initialization date.
const FORECAST_DATE_PARTITION = import.meta.env.VITE_FORECAST_DATE_PARTITION ?? "year={YYYY}/month={MM}/day={DD}";

// Folder holding the per-styleset stream style tables for a given day.
const MAP_STYLES_DIR = import.meta.env.VITE_MAP_STYLES_DIR ?? "map-styles";

// Which folder under MAP_STYLES_DIR each stream styleset reads. Keys match the <select> values in
// index.html ("standard" needs no data, so it has no entry).
const STYLESET_DIRS = {
  forecast15: import.meta.env.VITE_STYLES_DIR_FORECAST15 ?? "q-time-series",
  maxflow: import.meta.env.VITE_STYLES_DIR_MAXFLOW ?? "max-flow",
  timetopeak: import.meta.env.VITE_STYLES_DIR_TIMETOPEAK ?? "time-to-peak",
  q95: import.meta.env.VITE_STYLES_DIR_Q95 ?? "q95"
};

const STYLES_JSON = import.meta.env.VITE_FORECAST_STYLES_JSON ?? "styles.json";
const STYLES_BIN = import.meta.env.VITE_FORECAST_STYLES_BIN ?? "styles.bin";

/** Expand FORECAST_DATE_PARTITION for a YYYY-MM-DD date. */
function forecastDatePath(date) {
  const [y, m, d] = date.split("-");
  return FORECAST_DATE_PARTITION.replace("{YYYY}", y).replace("{MM}", m).replace("{DD}", d);
}

/** Folder URL holding styles.{json,bin} for one styleset on one forecast date, or null if the
 * styleset has no style tables (e.g. "standard", which paints a uniform network). */
function mapStylesUrl(date, styleset) {
  const dir = STYLESET_DIRS[styleset];
  if (!dir) return null;
  return `${FORECAST15_BASE}/${forecastDatePath(date)}/${MAP_STYLES_DIR}/${dir}`;
}

// Per-day discharge store inside the partitioned tree — the fallback source for forecast
// hydrographs when no flat store host is configured.
const FORECAST_DISCHARGE_ZARR = import.meta.env.VITE_FORECAST_DISCHARGE_ZARR ?? "discharge.zarr";

// Flat per-run forecast Zarr stores (<YYYYMMDD><HH>.zarr), the source for forecast hydrographs.
const FORECAST_ZARR_BASE = (import.meta.env.VITE_FORECAST_ZARR_BASE ?? "https://d14ritg1bypdp7.cloudfront.net").replace(/\/+$/, "");
const FORECAST_INIT_HOUR = "00";

/** Today in UTC as YYYY-MM-DD — the default forecast initialization date. */
function todayUtc() {
  const d = new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

const DEFAULT_FORECAST_DATE = import.meta.env.VITE_FORECAST_DEFAULT_DATE ?? todayUtc();

// ── Retrospective ────────────────────────────────────────────────────────────
const RETROSPECTIVE_DAILY_ZARR = import.meta.env.VITE_RETROSPECTIVE_DAILY_ZARR;

// ── Flood library (FLDPLN) ───────────────────────────────────────────────────
// Root serving manifest.json + the per-tile zarr stores the flood worker reads.
const FIM_DATA_URL = import.meta.env.VITE_FIM_DATA_URL ?? `${DATA_BASE}/fim`;
// Vector footprints of those data tiles, used to work out what the viewport covers.
const FIM_TILES_URL = import.meta.env.VITE_FIM_TILES_PMTILES ?? `${FIM_DATA_URL}/tile_boundaries.pmtiles`;
// Below this zoom the viewport can cover hundreds of data tiles; loading every one's header
// would be a request storm, so coverage only loads once you're zoomed in to work.
const FIM_MIN_COVERAGE_ZOOM = 7;

// ── Development stand-ins ────────────────────────────────────────────────────
// The charts fetch this reach instead of the clicked one while the model is in development.
const DEV_RIVER_ID = 710431167;

export {
  DATA_BASE,
  DEFAULT_FORECAST_DATE,
  DEV_RIVER_ID,
  FIM_DATA_URL,
  FIM_MIN_COVERAGE_ZOOM,
  FIM_TILES_URL,
  FORECAST15_BASE,
  FORECAST_DATE_PARTITION,
  FORECAST_DISCHARGE_ZARR,
  FORECAST_INIT_HOUR,
  FORECAST_ZARR_BASE,
  MAP_STYLES_DIR,
  RETROSPECTIVE_DAILY_ZARR,
  STREAMS_PMTILES,
  STYLESET_DIRS,
  STYLES_BIN,
  STYLES_JSON,
  forecastDatePath,
  mapStylesUrl,
  todayUtc
};
