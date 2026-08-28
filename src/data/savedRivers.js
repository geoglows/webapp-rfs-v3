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
    savedAt: typeof entry.savedAt === "string" ? entry.savedAt : "",
    // Profile sync state (see data/userSync.js). A record not yet in the profile is unsynced; a
    // removed one stays as a tombstone until the profile has dropped it too.
    synced: entry.synced === true,
    deleted: entry.deleted === true
  };
}

/** What the UI sees: everything that hasn't been removed. */
const live = () => load().filter((e) => !e.deleted);

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
const listSavedRivers = () => live().map((e) => ({...e}));

/** Just the ids — what the map's outline filter matches on. */
const savedRiverIds = () => live().map((e) => e.riverId);

const getSavedRiver = (riverId) => live().find((e) => e.riverId === Number(riverId)) ?? null;

const isSavedRiver = (riverId) => getSavedRiver(riverId) != null;

/**
 * Save a river, or rename/complete one already saved. Keyed by river id, so saving the same reach
 * twice updates it in place rather than growing a duplicate row.
 *
 * A field the caller doesn't have is left as whatever was already stored rather than nulled — that
 * way renaming a saved river can't quietly discard the coordinate it was saved with.
 */
function saveRiver({riverId, riverIndex, lat, lon, name = ""}, {synced = false} = {}) {
  const list = load();
  const id = Number(riverId);
  const prior = list.find((e) => e.riverId === id);
  const entry = normalize({
    riverId: id,
    riverIndex: riverIndex ?? prior?.riverIndex,
    lat: lat ?? prior?.lat,
    lon: lon ?? prior?.lon,
    name,
    savedAt: prior?.deleted ? new Date().toISOString() : (prior?.savedAt || new Date().toISOString()),
    synced,
    deleted: false
  });
  if (prior) list[list.indexOf(prior)] = entry;
  else list.push(entry);
  persist();
  return entry;
}

function removeSavedRiver(riverId) {
  const list = load();
  const entry = list.find((e) => e.riverId === Number(riverId) && !e.deleted);
  if (!entry) return false;
  // A tombstone rather than a gap: the profile still has this row until the sync deletes it there.
  // One that never reached the profile has nothing to delete and can go now.
  if (entry.synced) entry.deleted = true;
  else list.splice(list.indexOf(entry), 1);
  persist();
  return true;
}

// ── Profile sync hooks · used only by data/userSync.js ──

/** Everything, tombstones included, for the sync to push. */
const listSavedRiversForSync = () => load().map((e) => ({...e}));

/**
 * Replace the list with what the profile holds. Local-only fields (riverIndex, savedAt) survive for
 * rivers already known here, since the profile doesn't store them; tombstones are gone because
 * the profile has dropped them; anything unsynced that the profile doesn't have is kept, so a save
 * made moments before a pull isn't lost — it goes up with the next push.
 */
function replaceFromSync(rows) {
  const prior = new Map(load().map((e) => [e.riverId, e]));
  const next = rows.map((r) => normalize({...prior.get(Number(r.riverId)), ...r, synced: true, deleted: false}));
  const have = new Set(next.map((e) => e.riverId));
  for (const e of prior.values()) if (!e.synced && !e.deleted && !have.has(e.riverId)) next.push(e);
  cache = next;
  persist();
}

/** The push succeeded for these ids: mark them synced and drop any tombstones among them. */
function markSynced(riverIds) {
  const ids = new Set(riverIds.map(Number));
  cache = load().filter((e) => !(e.deleted && ids.has(e.riverId)));
  for (const e of cache) if (ids.has(e.riverId)) e.synced = true;
  persist();
}

/** Everything off the device, without touching the profile: sign-out, or another account signing in. */
function clearSavedRivers() {
  cache = [];
  persist();
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
  clearSavedRivers,
  getSavedRiver,
  listSavedRiversForSync,
  markSynced,
  replaceFromSync,
  isSavedRiver,
  listSavedRivers,
  onSavedRiversChange,
  removeSavedRiver,
  saveRiver,
  savedRiverIds
};
