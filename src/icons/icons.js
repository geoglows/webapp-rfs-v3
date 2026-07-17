import { layers24 } from "@esri/calcite-ui-icons/js/layers24.js";
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  layers: { size: 24, path: layers24 }
};
function calciteIcon(name) {
  const { size, path } = ICONS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
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
