// maplibre-gl 6 is ESM-only and doesn't have a default export. @esri/maplibre-arcgis 1.x imports maplibregl from "maplibre-gl
import * as maplibregl from "maplibre-gl";
export * from "maplibre-gl";
export default maplibregl;
