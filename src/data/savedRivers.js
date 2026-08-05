/**
 * The rivers this device has saved, and the only place they are kept.
 *
 * Every entry is captured whole — id, riverIndex, lat, lon — at the moment it is saved, so reading
 * the list never resolves anything: no 17 MB lookup download to turn an id into an index, no
 * metadata read to find out where the reach is. All three are already in hand wherever the heart
 * is clicked (see docks/charts.js), which is the only reason saving can afford to be strict about
 * it and reading can afford to be free.
 *
 * localStorage rather than IndexedDB: this is a handful of small records, and the map's saved-river
 * outline wants the id list synchronously every time the style settles. The riverId lookup lives in
 * IndexedDB (data/riverIndexDb.js) because it is ~55 MB of typed arrays; this is not that.
 */
const STORAGE_KEY = "rfs-saved-rivers";

const watchers = new Set();
let cache = null;

/** Trust nothing off the wire: a hand-edited or half-written record shouldn't crash a render. */
function normalize(entry) {
  const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    riverId: Number(entry.riverId),
    riverIndex: num(entry.riverIndex),
    lat: num(entry.lat),
    lon: num(entry.lon),
    name: typeof entry.name === "string" ? entry.name : "",
    savedAt: typeof entry.savedAt === "string" ? entry.savedAt : ""
  };
}

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    // An entry without an id can't be found, jumped to, or outlined on the map — there is nothing
    // to do with it but drop it.
    cache = Array.isArray(raw)
      ? raw.filter((e) => e && Number.isFinite(Number(e.riverId))).map(normalize)
      : [];
  } catch {
    // Unparseable storage reads as an empty list rather than throwing on the way into the app: the
    // saved rivers are a convenience, and losing them must not cost anyone the map.
    console.warn("Saved rivers could not be read; starting from an empty list.");
    cache = [];
  }
  return cache;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    // Quota, or private-mode storage that refuses writes. The in-memory list is still correct for
    // this session, so the UI stays consistent — it just won't survive a reload.
    console.warn(`Saved rivers could not be written: ${e.message}`);
  }
  for (const fn of watchers) fn(listSavedRivers());
}

/** A copy, so a caller iterating it can't be surprised by a save landing mid-loop. */
const listSavedRivers = () => load().map((e) => ({...e}));

/** Just the ids — what the map's outline filter matches on. */
const savedRiverIds = () => load().map((e) => e.riverId);

const getSavedRiver = (riverId) => load().find((e) => e.riverId === Number(riverId)) ?? null;

const isSavedRiver = (riverId) => getSavedRiver(riverId) != null;

/**
 * Save a river, or rename/complete one already saved. Keyed by river id, so saving the same reach
 * twice updates it in place rather than growing a duplicate row.
 *
 * A field the caller doesn't have is left as whatever was already stored rather than nulled — that
 * way renaming a saved river can't quietly discard the coordinate it was saved with.
 */
function saveRiver({riverId, riverIndex, lat, lon, name = ""}) {
  const list = load();
  const id = Number(riverId);
  const prior = list.find((e) => e.riverId === id);
  const entry = normalize({
    riverId: id,
    riverIndex: riverIndex ?? prior?.riverIndex,
    lat: lat ?? prior?.lat,
    lon: lon ?? prior?.lon,
    name,
    savedAt: new Date().toISOString()
  });
  if (prior) list[list.indexOf(prior)] = entry;
  else list.push(entry);
  persist();
  return entry;
}

function removeSavedRiver(riverId) {
  const list = load();
  const at = list.findIndex((e) => e.riverId === Number(riverId));
  if (at < 0) return false;
  list.splice(at, 1);
  persist();
  return true;
}

/**
 * Watch the list. Three things follow it — the map outline, the saved-rivers dock, and the heart on
 * the charts dock — and none of them owns it, so every change fans out to all of them rather than
 * each edit having to remember who else was looking.
 */
function onSavedRiversChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

export {
  getSavedRiver,
  isSavedRiver,
  listSavedRivers,
  onSavedRiversChange,
  removeSavedRiver,
  saveRiver,
  savedRiverIds
};
