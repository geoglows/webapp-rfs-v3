import {buildIdLookup, fetchMetadataArray, verifyIdLookup} from "riverforecastsystem/v3/hydrography";
import {configure, urls} from "riverforecastsystem/v3";
import {isUsableMeta, readMeta, SCHEMA_VERSION, writeRecord} from "./riverIndexDb.js";

/**
 * Builds the riverId -> riverIndex lookup and caches it, off the main thread.
 *
 * The arithmetic — the radix sort that turns the topologically-ordered riverId axis into
 * `{sortedIds, positions}`, and the check that refuses a bad download — is the package's
 * (riverforecastsystem/v3/hydrography); this worker owns the download, the progress reporting and
 * the IndexedDB record.
 *
 * Messages in:
 *   init    {v3Base}    point the package at the data (its config is per-thread)
 *   build   {}          reuse a valid cache, else download -> sort -> verify -> store
 *   cancel  {}          abort an in-flight build
 * Messages out: ready {n, cached} · progress {phase, done, total} · cancelled · error {message}
 */
function createRiverIndexWorker(post) {
  let controller = null;

  // ── build ──────────────────────────────────────────────────────────────────
  async function build() {
    const source = urls.hydrographyMetadataZarr();
    // The meta record, not the arrays: deciding whether to skip the download must not cost more
    // than reading the thing it would skip to.
    const existing = await readMeta().catch(() => null);
    if (isUsableMeta(existing, source)) {
      post({type: "ready", n: existing.n, cached: true});
      return;
    }

    controller = new AbortController();
    const {signal} = controller;

    const ids = await fetchMetadataArray({
      variable: "riverId",
      signal,
      onProgress: ({done, total}) => post({type: "progress", phase: "download", done, total})
    });

    const n = ids.length;
    post({type: "progress", phase: "sort", done: 0, total: 4});
    const {sortedIds, positions} = buildIdLookup(ids, (pass) =>
      post({type: "progress", phase: "sort", done: pass, total: 4}));

    post({type: "progress", phase: "verify", done: 0, total: 1});
    verifyIdLookup(sortedIds, n);
    post({type: "progress", phase: "verify", done: 1, total: 1});

    post({type: "progress", phase: "store", done: 0, total: 1});
    await writeRecord({
      schema: SCHEMA_VERSION,
      source,
      n,
      builtAt: Date.now(),
      sortedIds: sortedIds.buffer,
      positions: positions.buffer
    });
    post({type: "progress", phase: "store", done: 1, total: 1});
    post({type: "ready", n, cached: false});
  }

  return (ev) => {
    const msg = ev.data;
    if (msg.type === "init") {
      configure({v3Base: msg.v3Base});
      return;
    }
    if (msg.type === "cancel") {
      controller?.abort();
      return;
    }
    if (msg.type === "build") {
      build().catch((e) => {
        if (e?.name === "AbortError") post({type: "cancelled"});
        else post({type: "error", message: e.message});
      }).finally(() => {
        controller = null;
      });
    }
  };
}

const handle = createRiverIndexWorker((message) => self.postMessage(message));
self.onmessage = handle;

export {createRiverIndexWorker};
