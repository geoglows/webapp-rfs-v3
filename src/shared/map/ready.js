/**
 * Resolve once the map's style is up — meaning layers can be added to it and properties set on it.
 *
 * Deliberately `style.load` and not `load`. `load` is the first rendered frame, which waits on
 * every source in the initial style having answered, so it is hostage to the network: a tile
 * archive that is slow, or that never answers at all, holds it forever. Nothing either page does
 * after this point needs pixels — it needs a style it can add layers to — and that is exactly what
 * `style.load` means. Waiting on the weaker signal is what lets the rest of the app come up while
 * the tiles are still arriving, with no deadline to guess at and nothing to cancel.
 */
export function mapReady(map) {
  return new Promise((resolve) => map.once("style.load", resolve));
}
