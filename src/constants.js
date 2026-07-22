import {urls} from "rfsjs/v3";

// ── Hydrography ──────────────────────────────────────────────────────────────
const STREAMS_PMTILES = import.meta.env.VITE_STREAMS_PMTILES ?? urls.streamsPmtiles();

// ── 15-day forecast tree ─────────────────────────────────────────────────────
function mapStyleUrls(date, styleset) {
  const dir = urls.stylesets[styleset];
  if (!dir) return null;
  const prefix = urls.streamsStyles({date, styleset: dir});
  return {json: `${prefix}json`, bin: `${prefix}bin`};
}

/** Today in UTC as YYYY-MM-DD — the default forecast initialization date. */
function newestForecastExpected() {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() - 12);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}
const DEFAULT_FORECAST_DATE = "2026-07-10" // newestForecastExpected();

// ── Flood library (FLDPLN) ───────────────────────────────────────────────────
const FLOOD_MAPS_MIN_COVERAGE_ZOOM = 7;

// ── Sample data pin ──────────────────────────────────────────────────────────
// The synthetic sample store holds only the reaches in
// references/v3-synthetic-data/generate_v3_examples_data.py, so a request for any other position on
// the axis reads off the end of it. Until the real store is published the discharge readers are
// pinned here — at the last call before the network and nowhere else, so every layer above it works
// in real ids and real indices. Index 0 is the Mississippi, the first of DEFAULT_BOOKMARKS below.
const SAMPLE_DATA_RIVER_INDEX = 0;

// ── Saved rivers ─────────────────────────────────────────────────────────────
// Seeds the saved-rivers dock: one large-river outlet per major basin, for jumping straight to a
// hydrograph without hunting on the map.
//
// Every field is read straight out of the hydrography metadata zarr — the store the app itself
// reads — by looking each id up on the riverId axis:
//
//   riverIndex   its position on that axis, which is what the discharge readers take
//   lat / lon    the reach's downstream point, which is what the camera flies to
//
// So there is nothing to keep in sync by hand: rebuild the streams set and re-derive the lot from
// the new axis (see TODO.md). The reaches themselves are the ones the synthetic sample dataset was
// cut down to (references/v3-synthetic-data/generate_v3_examples_data.py).
const DEFAULT_BOOKMARKS = [
  {riverId: 760021611, riverIndex: 5192926, lat: 29.0929, lon: -89.2522, name: "Mississippi, USA"},
  {riverId: 160064246, riverIndex: 1138142, lat: 31.4749, lon: 30.3599, name: "Nile, East Africa"},
  {riverId: 710431167, riverIndex: 4725888, lat: 31.7776, lon: -114.7304, name: "Colorado, Mexico"},
  {riverId: 441057380, riverIndex: 3074511, lat: 23.1933, lon: 90.6048, name: "Ganges, India"},
  {riverId: 430157411, riverIndex: 2862943, lat: 10.1946, lon: 106.7421, name: "Mekong, Vietnam"},
  {riverId: 210393186, riverIndex: 1320246, lat: 41.7370, lon: 12.2307, name: "Tiber, Italy"},
  {riverId: 621010293, riverIndex: 4239728, lat: -0.4756, lon: -51.4222, name: "Amazon, Brazil"},
  {riverId: 130747391, riverIndex: 539910, lat: -6.0567, lon: 12.3688, name: "Congo, D.R. Congo"},
  {riverId: 640255644, riverIndex: 4485280, lat: -33.8890, lon: -58.4528, name: "Parana, Argentina"},
  {riverId: 540514417, riverIndex: 3841659, lat: -35.3793, lon: 139.3540, name: "Murray, Australia"},
  {riverId: 441077984, riverIndex: 3074481, lat: 24.0103, lon: 67.4701, name: "Indus, India"},
  {riverId: 280302448, riverIndex: 1761448, lat: 46.5486, lon: 49.4263, name: "Volga, Russia"},
  {riverId: 220463113, riverIndex: 1445605, lat: 45.1646, lon: 29.7219, name: "Danube, Romania"},
  {riverId: 230452055, riverIndex: 1515260, lat: 49.4346, lon: 0.2895, name: "Seine, France"},
  {riverId: 410641150, riverIndex: 2565012, lat: 53.1083, lon: 140.6268, name: "Amur, China/Russia"},
  {riverId: 140049491, riverIndex: 710249, lat: 4.3350, lon: 6.0729, name: "Niger, Nigeria"}
];

// How close the camera gets when a saved river is picked: enough that the reach fills the view, not
// so close that a sinuous one runs off the edges. Matches the zoom a map click settles at.
const BOOKMARK_ZOOM = 10;

export {
  BOOKMARK_ZOOM,
  DEFAULT_BOOKMARKS,
  DEFAULT_FORECAST_DATE,
  FLOOD_MAPS_MIN_COVERAGE_ZOOM,
  SAMPLE_DATA_RIVER_INDEX,
  STREAMS_PMTILES,
  mapStyleUrls
};
