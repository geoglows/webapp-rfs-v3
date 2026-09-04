/**
 * IndexedDB storage for downloaded timeseries — the forecasts and retrospective records the charts
 * dock reads, kept so the second look at a river costs nothing.
 *
 * Same shape as the v2 hydroviewer's discharge cache (src/data/cache.js there): a key per read, the
 * whole result stored under it, and a prune that drops the oldest once the cache outgrows its cap.
 * What is different is where it lives — the records go in the shared `datasets` store from db.js
 * under a `ts:` prefix rather than in a store of their own, because a new store means an upgrade and
 * db.js explains at length why an upgrade is not worth what it can cost.
 *
 * These records are unlike the two datasets beside them in the store: those are one big download
 * each, listed in Settings with a button, and either held or not. This is a cache that fills itself
 * as the user browses, so it has no download button — only a size, and a way to empty it.
 *
 * ── The index record ──
 * Pruning wants every entry's age and weight; the Settings readout wants the count and the total.
 * Reading the records themselves to get either would deserialize every cached series — tens of
 * megabytes — to answer a question about their sizes. So one small record shadows the lot, written
 * in the same transaction as the record it describes, and it is what both of those read instead.
 */
import {runTransaction} from "./db.js";

// Every key this module owns starts here, which is what lets the cache be enumerated and emptied
// without touching the datasets sharing the store.
const PREFIX = "ts:";
const INDEX_KEY = "ts:index";

// The whole prefix as a range: `ts:` up to anything that starts with it. ￿ is above every
// character the keys are built from, so the bound is the prefix and nothing after it.
const allKeys = () => IDBKeyRange.bound(PREFIX, `${PREFIX}￿`);

// The version of the cached records, as the date it was last invalidated: yyyymmdd, with .0, .1
// appended when more than one revision lands in a day. Bump it whenever a change makes what is
// already cached wrong — a reader returning different values, or a stored shape that has moved —
// and every cache written before is dropped rather than read.
const SCHEMA_VERSION = "20260904.0";

// What the cache is allowed to hold. Whichever ceiling is hit first, the oldest entries go until
// both are satisfied. A retrospective record is decades of daily values, so the byte ceiling is the
// one that usually bites; the count is there for a device that browses a great many forecasts.
const MAX_ENTRIES = 300;
const MAX_BYTES = 200e6;

/**
 * Roughly how much of the device this value occupies.
 *
 * Rough is the point: this feeds a size readout and an eviction order, and the alternative — a
 * structured clone measured exactly — costs more than the number is worth. Typed arrays are the
 * bulk of every record here and are counted exactly; everything else is counted by the width the
 * engine would most likely store it at.
 */
function estimateBytes(value, depth = 0) {
  if (value == null || depth > 6) return 0;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value instanceof Date) return 8;
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (typeof value === "string") return value.length * 2;
  if (Array.isArray(value)) {
    let sum = 0;
    for (const item of value) sum += estimateBytes(item, depth + 1);
    return sum;
  }
  if (typeof value === "object") {
    let sum = 0;
    for (const [k, v] of Object.entries(value)) sum += k.length * 2 + estimateBytes(v, depth + 1);
    return sum;
  }
  return 0;
}

const emptyIndex = () => ({schema: SCHEMA_VERSION, entries: {}});

/** The index as it should be read: anything written by another version of the code is not it. */
const usable = (index) => (index?.schema === SCHEMA_VERSION ? index : null);

/**
 * The keys to drop so the cache fits under both ceilings, oldest first.
 *
 * Oldest by when it was stored, not when it was last read: a read does not rewrite the index — that
 * would turn every cache hit into a write — so the age here is the age of the download. For a cache
 * whose entries are re-fetched on demand that is the honest ordering anyway.
 */
function overflowing(entries) {
  const keys = Object.keys(entries).sort((a, b) => entries[a].at - entries[b].at);
  let count = keys.length;
  let bytes = keys.reduce((sum, k) => sum + entries[k].bytes, 0);
  const drop = [];
  for (const key of keys) {
    if (count <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    drop.push(key);
    count -= 1;
    bytes -= entries[key].bytes;
  }
  return drop;
}

/** The cached value under `key`, or undefined — a miss, an expired schema and a cold cache alike. */
async function readEntry(key) {
  const record = await runTransaction("readonly", (store) => store.get(key));
  return record?.schema === SCHEMA_VERSION ? record.data : undefined;
}

/**
 * Store `data` under `key`, update the index, and prune — one transaction, so the index can never
 * describe a record that isn't there or miss one that is.
 *
 * An index written by an older schema is not merged with: the range delete clears the cache it
 * describes along with the index itself, and this write starts the new one.
 */
function writeEntry(key, data) {
  const bytes = estimateBytes(data);
  const at = Date.now();
  return runTransaction("readwrite", (store) => {
    const req = store.get(INDEX_KEY);
    req.onsuccess = () => {
      const index = usable(req.result);
      if (!index) store.delete(allKeys());
      const entries = index ? index.entries : {};
      entries[key] = {bytes, at};
      store.put({schema: SCHEMA_VERSION, data, bytes, at}, key);
      for (const stale of overflowing(entries)) {
        delete entries[stale];
        store.delete(stale);
      }
      store.put({schema: SCHEMA_VERSION, entries}, INDEX_KEY);
    };
    return req;
  });
}

/** What the cache is holding: `{n, bytes}`, zeroed when it holds nothing this build can read. */
async function summary() {
  const index = usable(await runTransaction("readonly", (store) => store.get(INDEX_KEY)));
  const entries = Object.values(index?.entries ?? {});
  return {n: entries.length, bytes: entries.reduce((sum, e) => sum + e.bytes, 0)};
}

/**
 * Empty the cache — every `ts:` key at once, the index among them, rather than the keys the index
 * happens to list. An entry the index lost track of is still bytes on the device, and "clear" that
 * leaves some behind is not one.
 */
const clear = () => runTransaction("readwrite", (store) => store.delete(allKeys()));

export {clear, readEntry, summary, writeEntry};
