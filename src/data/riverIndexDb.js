/**
 * IndexedDB storage for the riverId -> riverIndex lookup. Shared by the worker that builds it and
 * the main thread that reads it.
 *
 * The whole lookup is ONE record holding two ArrayBuffers. Storing a row per river instead would
 * mean millions of keyed writes — minutes of work, and a read that costs more than refetching the
 * network. As one record it is a single structured clone in each direction.
 *
 * That clone is ~55 MB, so a second, tiny record shadows it: the same descriptive fields without
 * the buffers. Anything that only needs to know whether a lookup exists and how big it is — the
 * Settings rows, the search box on open — reads that one instead of deserializing the arrays.
 */
const DB_NAME = "rfs-v3";
const DB_VERSION = 1;
const STORE = "river-index";
const RECORD_KEY = "riverId-to-riverIndex";
const META_KEY = "riverId-to-riverIndex:meta";

// The version of the cached lookup, as the date it was last invalidated: yyyymmdd, with .0, .1, .2
// appended when more than one revision lands in a day. Bump it when the record layout changes, or
// when the store's riverId axis is republished in a new order — either way a cache from before is
// discarded rather than misread, since a lookup built from an earlier axis answers with the wrong
// position for every id. Earlier caches carried the integers 1 and 2 here and are discarded too.
const SCHEMA_VERSION = "20260828.0";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTransaction(mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("river index transaction aborted"));
    };
  }));
}

/** The arrays and everything else. ~55 MB to deserialize — for the lookup itself, never for a status line. */
const readRecord = () => runTransaction("readonly", (store) => store.get(RECORD_KEY));

/** The record's descriptive fields without its buffers: what's cached, from which source, how big. */
const readMeta = () => runTransaction("readonly", (store) => store.get(META_KEY));

/**
 * Both records in one transaction, with the meta derived from the record rather than passed in
 * beside it — the two cannot describe different things, and cannot half-commit.
 */
function writeRecord(record) {
  const {sortedIds, positions, ...meta} = record;
  return runTransaction("readwrite", (store) => {
    store.put(meta, META_KEY);
    return store.put(record, RECORD_KEY);
  });
}

const deleteRecord = () => runTransaction("readwrite", (store) => {
  store.delete(META_KEY);
  return store.delete(RECORD_KEY);
});

/**
 * Empty the store rather than deleting the keys we know about. A "clear stored data" that leaves an
 * orphaned record from a superseded key behind is a lie, and that record is exactly what a later
 * version would trip over.
 *
 * This is the whole database — openDb() creates exactly one store. A second store would be declared
 * there, and would have to be added here with it.
 */
const clearStore = () => runTransaction("readwrite", (store) => store.clear());

/**
 * A cached lookup is only usable if it was built by this version of the code and from the store the
 * app is reading now. Anything else and the caller rebuilds — a lookup that silently answers from
 * the wrong dataset hands back another river's hydrograph, and nothing downstream can tell (the
 * discharge readers echo back no riverId to check against).
 *
 * Takes either record: the meta carries the same three fields, which is the point of it.
 */
function isUsableMeta(meta, source) {
  return !!meta
    && meta.schema === SCHEMA_VERSION
    && meta.source === source
    && Number.isInteger(meta.n) && meta.n > 0;
}

/**
 * The above plus the buffers being the length the record claims. Only the path that is about to
 * binary-search them needs this — a truncated array yields plausible row numbers forever.
 */
function isUsable(record, source) {
  return isUsableMeta(record, source)
    && record.sortedIds?.byteLength === record.n * 4
    && record.positions?.byteLength === record.n * 4;
}

export {
  META_KEY,
  RECORD_KEY,
  SCHEMA_VERSION,
  clearStore,
  deleteRecord,
  isUsable,
  isUsableMeta,
  readMeta,
  readRecord,
  writeRecord
};
