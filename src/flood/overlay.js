import {applyLayerVisibility} from "../map/layers";

/**
 * The computed flood extent, drawn as a canvas source pinned to the corridor's geographic bounds.
 *
 * The worker returns RGBA for a grid sized to whatever reaches are selected, so the canvas (and
 * therefore the source and layer) is rebuilt whenever that selection changes. MapLibre only samples
 * a canvas source while it's "playing", hence the play/pause-next-frame dance in refresh().
 */
class FloodOverlay {
  constructor(map) {
    this.map = map;
    this.canvas = null;
    this.ctx = null;
  }

  /** Recreate the canvas + source + layer for a corridor view ({ bounds, width, height }). */
  rebuild(view) {
    const map = this.map;
    if (map.getLayer("flood")) map.removeLayer("flood");
    if (map.getSource("flood")) map.removeSource("flood");
    this.canvas = document.createElement("canvas");
    this.canvas.width = view.width;
    this.canvas.height = view.height;
    this.ctx = this.canvas.getContext("2d");
    const b = view.bounds;
    map.addSource("flood", {
      type: "canvas",
      canvas: this.canvas,
      animate: false,
      coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]]
    });
    map.addLayer({
      id: "flood",
      type: "raster",
      source: "flood",
      paint: {"raster-fade-duration": 0, "raster-resampling": "nearest"}
    }, "streams");
    // The layer is recreated on every viewport/selection change, so reapply the picker's toggle state.
    applyLayerVisibility(map, "flood");
  }

  /** Paint a worker frame. Returns false (without drawing) if it doesn't match the current canvas —
   * a frame in flight when the selection changed is stale and must be dropped. */
  paint(rgba, width, height) {
    if (!this.ctx || !this.canvas) return false;
    if (width !== this.canvas.width || height !== this.canvas.height) return false;
    this.ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    this.refresh();
    return true;
  }

  clear() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.refresh();
  }

  /** Nudge MapLibre to re-read the canvas: it only samples a canvas source while playing. */
  refresh() {
    const src = this.map.getSource("flood");
    if (!src) return;
    src.play();
    requestAnimationFrame(() => src.pause());
  }
}

export {FloodOverlay};
