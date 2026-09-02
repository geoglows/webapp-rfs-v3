/**
 * The filter expressions and the line-layer skeleton every stream selector shares.
 *
 * Reaches are addressed two ways in this app — by `riverId` (the charts dock, saved rivers, the
 * explorer's records) and by `riverIndex` (flood mapping, named spans, watershed runs) — and the
 * two are not interchangeable. Every builder therefore takes the property name; what used to keep
 * these helpers apart was only which name they had baked in.
 */

/** A filter that matches no reach — how a highlight layer is switched off. */
export const noMatch = (prop) => ["in", ["get", prop], ["literal", []]];

/** Match the reaches whose `prop` is in `ids`; an empty list matches nothing, not everything. */
export const inFilter = (prop, ids) =>
  ids?.length ? ["in", ["get", prop], ["literal", ids]] : noMatch(prop);

const spanExpr = (prop, {lo, hi}) =>
  ["all", ["has", prop], [">=", ["get", prop], lo], ["<=", ["get", prop], hi]];

/** Match one contiguous run of `prop`, `{lo, hi}`. Null clears — a missing span matches nothing. */
export const spanFilter = (prop, span) => (span ? spanExpr(prop, span) : noMatch(prop));

/** Match a list of disjoint runs — a watershed is one, an AOI is what its inlets left. The empty
 * list must not read as "everything" if one ever arrives, so it matches nothing. */
export const spansFilter = (prop, spans) => {
  if (!spans?.length) return noMatch(prop);
  return spans.length === 1 ? spanExpr(prop, spans[0]) : ["any", ...spans.map(s => spanExpr(prop, s))];
};

/**
 * The layer every stream highlight is a variation of: a line over the `streams` source with round
 * caps, off until a filter turns it on. `width` is a full expression — each caller owns its ramp,
 * which is the one thing the highlights genuinely differ in.
 *
 * Returns the spec; the caller adds it, because insertion order (above or below `streams`) is the
 * caller's statement about what may cover what.
 */
export function streamLine({id, color, width, opacity, dash, minzoom, filter, visibility = "visible"}) {
  return {
    id,
    type: "line",
    source: "streams",
    "source-layer": "streams",
    filter: filter ?? noMatch("riverId"),
    ...(minzoom != null ? {minzoom} : {}),
    layout: {"line-cap": "round", "line-join": "round", visibility},
    paint: {
      "line-color": color,
      "line-width": width,
      ...(opacity != null ? {"line-opacity": opacity} : {}),
      ...(dash ? {"line-dasharray": dash} : {})
    }
  };
}

/** A zoom-interpolated width from flat `[zoom, value, …]` stops — the shape every ramp here takes. */
export const zoomInterp = (stops) => ["interpolate", ["linear"], ["zoom"], ...stops];

/**
 * Run `fn` now if the style can take a setFilter, otherwise once it can. The style is often
 * mid-update right after a zoom or a style change; every selector used to carry this retry by
 * hand. `fn` should read the latest state when it runs rather than close over a snapshot, so a
 * value that changed while waiting is the one applied.
 */
export function whenStyleReady(map, fn) {
  if (map.isStyleLoaded()) return fn();
  map.once("idle", () => whenStyleReady(map, fn));
}
