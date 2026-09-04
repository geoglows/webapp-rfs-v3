/**
 * The record-plus-meta pattern the one-download datasets share, as one factory.
 *
 * riverIndexDb.js and riverNamesDb.js are both a single record in the shared store from db.js, with
 * a second, tiny record shadowing it: the same descriptive fields without the bulk. Anything that
 * only needs to know what is cached and how big it is — the Settings rows, a freshness check, the
 * search box on open — reads the shadow instead of deserializing tens of megabytes to answer a
 * question about a size. Every one of those five operations was written twice, identically, because
 * the only thing that differs between the two datasets is which fields count as the bulk.
 *
 * That is the one parameter: `bulkFields`. Everything else the two datasets kept in common — the
 * pair of keys, the write that commits both records together, the delete that takes both, and the
 * three-field usability check — is the same code and now exists once.
 *
 * What deliberately stays in the dataset modules is the part that reads the payload: `isUsable()`
 * checks that the bulk is the size the record claims, and only the dataset knows what its bulk is
 * shaped like. Same for anything a dataset alone has, such as the names table's expiry clock.
 */
import {runTransaction} from "./db.js";

/**
 * @param {Object} spec
 * @param {string} spec.recordKey  key for the full record, bulk included
 * @param {string} spec.metaKey    key for the shadow record
 * @param {string} spec.schema     the dataset's SCHEMA_VERSION, checked on every read
 * @param {string[]} spec.bulkFields  the record's heavy fields, which the shadow leaves out
 */
export function recordStore({recordKey, metaKey, schema, bulkFields}) {
  /** The bulk and everything else — for the dataset itself, never for a status line. */
  const readRecord = () => runTransaction("readonly", (store) => store.get(recordKey));

  /** The record's descriptive fields without its bulk: what's cached, from which source, how big. */
  const readMeta = () => runTransaction("readonly", (store) => store.get(metaKey));

  /**
   * Both records in one transaction, with the meta derived from the record rather than passed in
   * beside it — the two cannot describe different things, and cannot half-commit.
   */
  function writeRecord(record) {
    const meta = {...record};
    for (const field of bulkFields) delete meta[field];
    return runTransaction("readwrite", (store) => {
      store.put(meta, metaKey);
      return store.put(record, recordKey);
    });
  }

  const deleteRecord = () => runTransaction("readwrite", (store) => {
    store.delete(metaKey);
    return store.delete(recordKey);
  });

  /**
   * Whether a cached copy can be read at all: written by this version of the code, from the data
   * root this app is pointed at, and not empty. Anything else and the caller rebuilds — a cache that
   * silently answers from the wrong dataset hands back another river's data, and nothing downstream
   * can tell.
   *
   * Takes either record: the meta carries the same three fields, which is the point of it.
   */
  function isUsableMeta(meta, source) {
    return !!meta
      && meta.schema === schema
      && meta.source === source
      && Number.isInteger(meta.n) && meta.n > 0;
  }

  return {deleteRecord, isUsableMeta, readMeta, readRecord, writeRecord};
}
