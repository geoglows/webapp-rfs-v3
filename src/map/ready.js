/**
 * Resolve once the style is up and layers can be added.
 *
 * `style.load`, not `load`: `load` waits on the first rendered frame and so on every source in the
 * initial style answering, which a slow or dead tile archive holds forever.
 */
export function mapReady(map) {
  return new Promise((resolve) => map.once("style.load", resolve));
}
