import {FloodMapsIndex} from "rfsjs/v3/floodmaps";
import {configure} from "rfsjs/v3";
import {FloodMapper} from "./mapper.js";

/**
 * The flood worker: its message protocol and its binding to the worker global, which is bound at
 * the bottom of this file.
 *
 * post(message, transfer) is the worker's own postMessage. Messages in:
 *   init      {v3Base}                   point the package at the data, open the manifest -> ready
 *   viewport  {tiles}                    fold those tiles into coverage      -> coverage
 *   select    {id, riverIds}             fetch slices, build the canvas      -> selected
 *   frame     {id, flows}                render one discharge state          -> frame
 *   query     {id, row, col}             depth at one arc-second cell        -> query
 *   export    {id}                       the last frame's wet/dry mask       -> export
 * Anything that throws comes back as {type: "error", message}.
 */
function createFloodWorker(post) {
  let index = null;
  let mapper = null;
  // Highest "select" id seen so far. Selections resolve out of order (slicesFor() fetches over the
  // network), so without this a slow earlier selection could land after a faster later one and
  // overwrite `mapper` with the stale session. The consumer already drops stale *responses*, but
  // this state has to be guarded too or the next "frame" renders against the wrong selection.
  let latestSelectId = -1;

  return async (msg) => {
    try {
      if (msg.type === "init") {
        // A Worker is its own module instance, so it has its own blank copy of the package's
        // config and cannot see the configure() the page ran at startup — init carries the v3 root
        // across so the flood library resolves under it here too.
        configure({v3Base: msg.v3Base});
        index = await FloodMapsIndex.open();
        post({type: "ready", nTiles: index.tilePath.size});
      } else if (msg.type === "viewport") {
        if (!index) throw new Error("worker not initialized");
        const coverage = await index.setActiveTiles(msg.tiles);
        post(
          {
            type: "coverage",
            coverage: coverage.buffer,
            nActiveTiles: index.activeTiles.size,
            nRivers: index.riverTiles.size
          },
          [coverage.buffer]
        );
      } else if (msg.type === "select") {
        if (!index) throw new Error("worker not initialized");
        if (msg.id < latestSelectId) return;
        latestSelectId = msg.id;
        const slices = await index.slicesFor(msg.riverIds);
        // A newer selection arrived while we were fetching — that one owns `mapper` now.
        if (msg.id < latestSelectId) return;
        mapper = FloodMapper.forSlices(slices);
        if (!mapper) {
          post({type: "selected", id: msg.id, empty: true});
          return;
        }
        post({
          type: "selected",
          id: msg.id,
          empty: false,
          bounds: mapper.bounds,
          width: mapper.width,
          height: mapper.height,
          flows: mapper.synthesizeFlows(),
          stats: mapper.stats()
        });
      } else if (msg.type === "frame") {
        if (!mapper) throw new Error("no selection");
        const frame = mapper.frame(new Map(msg.flows));
        post({type: "frame", id: msg.id, ...frame}, [frame.rgba]);
      } else if (msg.type === "query") {
        post({type: "query", id: msg.id, depth: mapper ? mapper.query(msg.row, msg.col) : null});
      } else if (msg.type === "export") {
        if (!mapper) {
          post({type: "export", id: msg.id, extent: null});
          return;
        }
        const out = mapper.extent();
        post({type: "export", id: msg.id, tile: "corridor", ...out}, [out.extent]);
      }
    } catch (err) {
      post({type: "error", message: err.message ?? String(err)});
    }
  };
}

const handle = createFloodWorker((msg, transfer) => self.postMessage(msg, transfer));
self.onmessage = (ev) => handle(ev.data);
