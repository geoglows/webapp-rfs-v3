/**
 * IndexedDB storage for the riverId -> riverIndex lookup. Shared by the worker that builds it and
 * the main thread that reads it.
 *
 * The keys and SCHEMA_VERSION below are what let this build read the 17 MB a device already has —
 * see db.js — so they are a contract, not a private detail.
 *
 * The whole lookup is ONE record holding two ArrayBuffers. Storing a row per river instead would
 * mean millions of keyed writes — minutes of work, and a read that costs more than refetching the
 * network. As one record it is a single structured clone in each direction.
 *
 * That clone is ~55 MB, so a second, tiny record shadows it: the same descriptive fields without
 * the buffers. Anything that only needs to know whether a lookup exists and how big it is — the
 * Settings rows, the search box on open — reads that one instead of deserializing the arrays.
 *
 * The connection belongs to data/db.js; this file owns only the two records it keeps in the shared
 * store and what makes one of them usable.
 */
import {recordStore} from "./recordStore.js";

const RECORD_KEY = "riverId-to-riverIndex";
const META_KEY = "riverId-to-riverIndex:meta";

// The version of the cached lookup, as the date it was last invalidated: yyyymmdd, with .0, .1, .2
// appended when more than one revision lands in a day. Bump it when the record layout changes, or
// when the store's riverId axis is republished in a new order — either way a cache from before is
// discarded rather than misread, since a lookup built from an earlier axis answers with the wrong
// position for every id. Earlier caches carried the integers 1 and 2 here and are discarded too.
const SCHEMA_VERSION = "20260828.0";

// The two buffers are the bulk: ~55 MB to deserialize, and what the shadow meta record leaves out
// so a status line never pays for them.
const {deleteRecord, isUsableMeta, readMeta, readRecord, writeRecord} = recordStore({
  recordKey: RECORD_KEY,
  metaKey: META_KEY,
  schema: SCHEMA_VERSION,
  bulkFields: ["sortedIds", "positions"],
});

/**
 * isUsableMeta() plus the buffers being the length the record claims. Only the path that is about to
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
  deleteRecord,
  isUsable,
  isUsableMeta,
  readMeta,
  readRecord,
  writeRecord
};
