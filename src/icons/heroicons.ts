/**
 * heroicons.ts — Heroicons (MIT), imported modularly as raw SVG strings via Vite's `?raw` so the
 * bundle carries only the icons we actually reference, and the graphics' provenance stays in code
 * (named imports from the `heroicons` package) rather than SVG markup pasted into HTML.
 *
 * Package: heroicons  ·  https://github.com/tailwindlabs/heroicons
 * We use the 24px outline set (each icon is `stroke="currentColor"`, so color comes from CSS).
 * To add an icon: import its `24/outline/<name>.svg?raw` module below and register it in ICONS.
 */
import informationCircle from 'heroicons/24/outline/information-circle.svg?raw'
import cog6Tooth from 'heroicons/24/outline/cog-6-tooth.svg?raw'
import language from 'heroicons/24/outline/language.svg?raw'
import sun from 'heroicons/24/outline/sun.svg?raw'
import moon from 'heroicons/24/outline/moon.svg?raw'
// Solid set (each icon is `fill="currentColor"`) for the hydrology-prediction action buttons.
import chartBarSolid from 'heroicons/24/solid/chart-bar.svg?raw'
import bookmarkSolid from 'heroicons/24/solid/bookmark.svg?raw'
import clipboardDocumentListSolid from 'heroicons/24/solid/clipboard-document-list.svg?raw'
import magnifyingGlassSolid from 'heroicons/24/solid/magnifying-glass.svg?raw'

// friendly name -> raw SVG markup string for that heroicon
const ICONS = {
  'information-circle': informationCircle,
  'cog-6-tooth': cog6Tooth,
  language,
  sun,
  moon,
  'chart-bar-solid': chartBarSolid,
  'bookmark-solid': bookmarkSolid,
  'clipboard-document-list-solid': clipboardDocumentListSolid,
  'magnifying-glass-solid': magnifyingGlassSolid,
} as const

export type HeroIconName = keyof typeof ICONS

/** Parse a Heroicon's raw SVG markup into an <svg> element. Stroke inherits `currentColor`. */
export function heroIcon(name: HeroIconName): SVGElement {
  // a <template> parses the markup in foreign-content mode, yielding a properly namespaced <svg>
  const tpl = document.createElement('template')
  tpl.innerHTML = ICONS[name].trim()
  return tpl.content.firstElementChild as SVGElement
}
