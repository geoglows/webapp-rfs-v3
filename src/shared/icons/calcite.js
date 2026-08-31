import {layers24} from "@esri/calcite-ui-icons/js/layers24.js";
import {basemap24} from "@esri/calcite-ui-icons/js/basemap24.js";
import {legend24} from "@esri/calcite-ui-icons/js/legend24.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  layers: {size: 24, path: layers24},
  basemap: {size: 24, path: basemap24},
  legend: {size: 24, path: legend24}
};

function calciteIcon(name) {
  const {size, path} = ICONS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

export {
  calciteIcon
};
