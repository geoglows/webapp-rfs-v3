import {inFilter, NO_MATCH} from "./flood-maps/selection";

/**
 * The single-reach highlight used when inspecting a river (clicking one outside flood mode).
 * Distinct from the flood selection highlights in flood-maps/selection.js, which can hold many reaches —
 * this one tracks whatever the charts dock is currently showing.
 */
const LAYER_ID = "inspect-highlight";

function addInspectHighlightLayer(map) {
  if (map.getLayer(LAYER_ID)) return;
  map.addLayer({
    id: LAYER_ID,
    type: "line",
    source: "geoglows",
    "source-layer": "streams",
    filter: NO_MATCH,
    layout: {"line-cap": "round", "line-join": "round"},
    paint: {
      // Bright green, to clash with the blue stream network rather than blend into it.
      "line-color": "#33FF57",
      // Runs noticeably wider than the base streams line at every zoom so the inspected reach
      // reads as a distinct trace on top rather than a slightly recoloured stream.
      "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 8, 5, 13, 9, 16, 14],
      "line-opacity": 0.95
    }
  });
}

/** Pass null to clear the highlight. */
function setInspectHighlight(map, riverId) {
  if (!map.getLayer(LAYER_ID)) return;
  map.setFilter(LAYER_ID, riverId == null ? NO_MATCH : inFilter([riverId]));
}

export {addInspectHighlightLayer, setInspectHighlight};
