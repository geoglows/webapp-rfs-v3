/**
 * icons.ts — Esri Calcite UI icons, imported modularly so the bundler ships only the icon
 * paths we actually reference (each icon is its own ES module in the package). This keeps the
 * icons' provenance in code — a named import from `@esri/calcite-ui-icons` — rather than SVG
 * path data hand-copied into markup.
 *
 * Package: @esri/calcite-ui-icons  ·  https://github.com/Esri/calcite-ui-icons
 * To add an icon: import its `<name><size>` module below and register it in ICONS. The module
 * name encodes the icon and pixel size, e.g. the "layers" icon at 24px is `js/layers24.js`.
 */
import { layers24 } from '@esri/calcite-ui-icons/js/layers24.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

// friendly name -> the imported path data + the size it was authored at (its viewBox)
const ICONS = {
  layers: { size: 24, path: layers24 },
} as const

export type IconName = keyof typeof ICONS

/** Build an <svg> element for a registered Calcite icon. Fill inherits `currentColor` via CSS. */
export function calciteIcon(name: IconName): SVGSVGElement {
  const { size, path } = ICONS[name]
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const p = document.createElementNS(SVG_NS, 'path')
  p.setAttribute('d', path)
  svg.appendChild(p)
  return svg
}
