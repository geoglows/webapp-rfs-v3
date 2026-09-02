import {urls} from "riverforecastsystem/v3";
import {
  SCHEMA_VERSION,
  deleteRecord,
  isFresh,
  isUsable,
  isUsableMeta,
  nextExpiry,
  readMeta,
  readRecord,
  restamp,
  writeRecord
} from "./riverNamesDb.js";

const SOURCE = () => urls.riverNamesJson();

// The table, once read out of IndexedDB, with the search keys folded onto each row.
let loaded = null;
// The published file as it stands, kept beside the prepared rows. This app searches the rows; the
// explorer next door paints its named spans from `bounds`/`stops`/`palette`, which sit beside them
// in the same file — so what is cached is the file, and each app takes the half it reads.
let raw = null;
let loading = null;
let refreshing = null;
let watching = false;

// Lowercased and stripped of accents
const fold = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * What the app searches: the published row plus its folded name, and its parent resolved from an
 * index into a name. Done once on load rather than per keystroke, and stored nowhere — the cache
 * holds what was published, so a change to any of this is not a reason to refetch.
 */
function prepare(rivers) {
  return rivers.map((r) => ({
    ...r,
    // The mouth reach's position on the zarr riverId axis. Named here because `hi` is a span
    // bound everywhere else in this file and an axis position everywhere else in the app.
    riverIndex: r.hi,
    reaches: r.hi - r.lo + 1,
    key: fold(r.name),
    parentName: r.parent == null ? null : rivers[r.parent]?.name ?? null
  }));
}

/** What's cached right now, or null. Reads the meta record, so it costs nothing to call. */
async function status() {
  const meta = await readMeta().catch(() => null);
  if (!isUsableMeta(meta, SOURCE())) return null;
  return {n: meta.n, bytes: meta.bytes, fetchedAt: meta.fetchedAt, expiresAt: meta.expiresAt, generatedAt: meta.generatedAt};
}

/**
 * Fetch the table and store it. Conditional when the device already has a copy: the file changes
 * only when someone edits a name, so most revalidations are a 304 and a new expiry date rather
 * than another download.
 *
 * Resolves to the payload when it changed and null when the server said it had not.
 */
async function fetchTable(etag) {
  const res = await fetch(SOURCE(), etag ? {headers: {"If-None-Match": etag}} : undefined);
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = await res.text();
  const data = JSON.parse(text);
  if (!Array.isArray(data?.rivers) || !data.rivers.length) {
    throw new Error("riverNames.json is not the shape this app reads");
  }
  const at = Date.now();
  await writeRecord({
    schema: SCHEMA_VERSION,
    source: SOURCE(),
    n: data.rivers.length,
    // What the payload weighs on the wire, which is what the Settings row reports. Measured from
    // the text rather than the parsed rows, because that is the number a user would recognise.
    bytes: new Blob([text]).size,
    generatedAt: data.generatedAt ?? null,
    etag: res.headers.get("ETag"),
    fetchedAt: at,
    checkedAt: at,
    expiresAt: nextExpiry(at),
    payload: data
  });
  return data;
}

/**
 * The table, downloading it if this device hasn't got it.
 *
 * A structurally valid cache is used whatever its age; if it is past its boundary a revalidation
 * is started behind it and not waited on. That ordering is the whole freshness policy: the user
 * gets an answer from the copy in hand, and the copy quietly becomes current.
 */
function load() {
  if (loaded) return Promise.resolve(loaded);
  if (loading) return loading;
  loading = (async () => {
    const record = await readRecord().catch(() => null);
    if (isUsable(record, SOURCE())) {
      raw = record.payload;
      loaded = prepare(raw.rivers);
      if (!isFresh(record)) void refresh();
      return loaded;
    }
    // No cache to be told about, so the server has nothing to answer "not modified" to.
    raw = await fetchTable(null);
    loaded = prepare(raw.rivers);
    return loaded;
  })();
  const finish = () => {
    loading = null;
  };
  loading.then(finish, finish);
  return loading;
}

/**
 * Ask the server whether the copy on the device is still the published one, and take whichever
 * answer comes back. Never throws to its caller: a revalidation that fails is a device that keeps
 * the table it already had, which is the correct outcome offline and on a bad network alike.
 *
 * `force` skips the freshness check — what the Settings row's download button does, and the only
 * way to refetch before the boundary.
 */
function refresh({force = false} = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const meta = await readMeta().catch(() => null);
    const held = isUsableMeta(meta, SOURCE());
    // Nothing to revalidate. The clock this runs on keeps a copy current; it does not go and get
    // one, or a device whose user never opened the search box would download the table anyway an
    // hour into the session. load() is what fetches a first copy.
    if (!held && !force) return false;
    if (held && !force && isFresh(meta)) return false;
    try {
      const data = await fetchTable(held ? meta.etag : null);
      if (data) {
        raw = data;
        loaded = prepare(data.rivers);
        return true;
      }
      // Unchanged: the same table, good for another month.
      await restamp();
      return false;
    } catch (e) {
      console.warn(`[names] the river names could not be refreshed: ${e.message}`);
      return false;
    }
  })();
  const finish = () => {
    refreshing = null;
  };
  refreshing.then(finish, finish);
  return refreshing;
}

/**
 * Reconsider the copy when the tab is brought back to the front.
 *
 * No timer: the thing being waited for is a date, and polling for it burns wake-ups on a question
 * whose answer is almost always "still fresh". The two moments that actually matter are covered
 * without one — load() catches the ordinary case of an app opened for the first time that month,
 * and this catches the tab that was left open and backgrounded across the boundary, at the point
 * where a stale name would first be seen.
 */
function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") return;
    void refresh();
  });
}

/**
 * Rivers whose name matches `query`, best first, or [] before the table has been loaded — this is
 * synchronous because it runs on every keystroke, and the caller has already awaited load().
 *
 * Ranked by how the match sits in the name and then by size, so a whole-word hit beats a fragment
 * and, among the rivers that share a name, the biggest is offered first: someone typing "Colorado"
 * means the one with 31,726 reaches far more often than the one with 5,029. Size is the span's own
 * reach count, which every row already carries — no extra column, and it is the right measure of
 * "more of a river" for this purpose.
 */
function search(query, {limit = 25} = {}) {
  if (!loaded) return [];
  const q = fold(query);
  if (!q) return [];
  const hits = [];
  for (const river of loaded) {
    const at = river.key.indexOf(q);
    if (at < 0) continue;
    // 0 the whole name, 1 starts it, 2 starts a word inside it, 3 anywhere else.
    const rank = river.key === q ? 0 : at === 0 ? 1 : river.key[at - 1] === " " ? 2 : 3;
    hits.push({river, rank});
  }
  hits.sort((a, b) => a.rank - b.rank || b.river.reaches - a.river.reaches);
  return hits.slice(0, limit).map((h) => h.river);
}

/**
 * The published file itself, for a reader that wants a part of it this module does not search —
 * the explorer's span coloring. Null until load() has resolved.
 */
const payload = () => raw;

/** Drop this thread's copy of the table. For whoever erased the record underneath us. */
function forget() {
  loaded = null;
  raw = null;
}

async function clear() {
  await deleteRecord();
  forget();
}

export {SOURCE, clear, forget, load, payload, refresh, search, status, watch};
