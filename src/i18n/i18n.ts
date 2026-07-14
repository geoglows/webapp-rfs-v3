/**
 * i18n.ts — tiny translation layer for the static UI copy.
 *
 * The HTML carries only lookup keys (see the `data-i18n*` attributes in index.html); the human
 * text lives here in per-language dictionaries. `applyTranslations` walks the DOM and fills text /
 * attributes from the active dictionary, and `t()` lets runtime code (main.ts, plots, …) translate
 * strings it builds dynamically. English is the fallback for any key a language is missing.
 *
 * Attribute conventions the DOM understands:
 *   data-i18n            → element.textContent
 *   data-i18n-html       → element.innerHTML   (value may contain markup, e.g. links / <em>)
 *   data-i18n-title      → element.title
 *   data-i18n-aria-label → element aria-label
 */
type Dict = Record<string, string>

const en: Dict = {
  'app.title': 'River Forecast System v3',
  'common.close': 'Close',

  // header
  'settings.label': 'Settings',
  'theme.toggle': 'Toggle light / dark theme',
  'about.label': 'About',
  'lang.title': 'Language',
  'lang.aria': 'Change language',

  // hydrology predictions
  'hydro.heading': 'Hydrology predictions',
  'hydro.forecastDate': 'Forecast Initialization Date',
  'hydro.charts': 'View discharge charts',
  'hydro.bookmarks.title': 'Bookmarked rivers',
  'hydro.bookmarks.aria': 'Browse bookmarked rivers',
  'hydro.reports': 'Generate reports',
  'hydro.searchRiver': 'Search River ID',

  // flood mapping
  'flood.heading': 'Flood Mapping',
  'flood.enable': '🌊 Enable flood mapping mode',
  'flood.disable': '🌊 Flood mapping mode: ON',
  'flood.hintOff': 'Off — click a river to inspect its attributes. Turn this on to mark inlets & outlets for a flood map.',
  'flood.hintOn': 'On — click reaches to mark inlets & outlets. Click away from a river for flood depth.',
  'flood.testSite': 'Zoom to test flood site in <a href="/#map=11.83/40.26207/-103.78294">Fort Morgan Colorado</a>',
  'flood.inlet': '＋ Inlet',
  'flood.outlet': '✦ Outlet',
  'flood.corridorHint': 'Click reaches on the map to mark them. The corridor = every segment downstream of an inlet <em>and</em> upstream of an outlet.',
  'flood.noReaches': 'No reaches selected.',
  'flood.create': 'Create flood map',
  'flood.saveGeotiff': '⬇ Save GeoTIFF',
  'flood.clear': 'Clear selection',
  'flood.qLadder': 'Flow ladder',
  'flood.qUniform': 'Uniform Q',
  'flood.dischargeLevel': 'Discharge level',
  'flood.ladderHint': 'Per-reach ladder from the rating curves (demo stand-in for return periods).',
  'flood.uniformLabel': 'Discharge for every corridor reach (m³/s)',
  'flood.status': 'Flood updates live as you move the slider.',

  // depth legend
  'legend.floodDepth': 'flood depth',
  'legend.readout': 'click a flooded pixel for depth',

  // player + map overlays
  'player.play': 'Play / pause (space)',
  'player.speed': 'Speed',
  'layers.label': 'Basemap layers',
  'legend.returnPeriod': 'Forecast return period',

  // about modal
  'about.intro': 'Global GEOGLOWS forecast animation · pick inlets & outlets · FLDPLN flood extent for the segments between them.',
  'about.coverageHeading': 'Coverage & model notes',
  'about.coverage': '<strong>Flood library coverage is the small N40W104 demo tile only</strong> (3 reaches in Colorado, highlighted). Corridors elsewhere animate and subset, but produce no flood extent until a library tile exists there.',
  'about.model': "FLDPLN is a steady-state, DEM-only screening model driven by synthetic rating curves; extents saturate at the library's maximum stage. <strong>Not for emergency use.</strong> Terrain: FABDEM (© DLR / Airbus, CC BY-NC-SA 4.0). Hydrography & forecast: GEOGLOWS.",
  'about.ossHeading': 'Open source software & data',
  'about.ossIntro': 'This app is built on open source packages and data:',
  'about.credit.maplibre': '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre GL JS</a>',
  'about.credit.calcite': '<a href="https://github.com/Esri/calcite-ui-icons" target="_blank" rel="noopener">Calcite UI Icons</a>',
  'about.credit.heroicons': '<a href="https://github.com/tailwindlabs/heroicons" target="_blank" rel="noopener">Heroicons</a>',
  'about.credit.chartjs': '<a href="https://www.chartjs.org/" target="_blank" rel="noopener">Chart.js</a> and plugins (date-fns adapter, matrix, zoom)',
  'about.credit.zarrita': '<a href="https://github.com/manzt/zarrita.js" target="_blank" rel="noopener">zarrita.js</a> and <a href="https://github.com/manzt/numcodecs.js" target="_blank" rel="noopener">numcodecs</a> (Zarr access)',
  'about.credit.hyparquet': '<a href="https://github.com/hyparam/hyparquet" target="_blank" rel="noopener">hyparquet</a> (Parquet tile reading)',
  'about.credit.pmtiles': '<a href="https://github.com/protomaps/PMTiles" target="_blank" rel="noopener">PMTiles</a>',
  'about.credit.basemaps': 'Basemaps from <a href="https://livingatlas.arcgis.com/" target="_blank" rel="noopener">ArcGIS Living Atlas</a>',
  'about.credit.geoglows': 'Streams hydrographs and FIM from the <a href="https://geoglows.org/" target="_blank" rel="noopener">GEOGLOWS River Forecast System</a> v2 and v3',

  // settings modal
  'settings.display': 'Display',
  'settings.showLegend': 'Show forecast return-period legend',

  // river + charts modals
  'river.heading': 'River',
  'charts.heading': 'Discharge charts',
  'charts.empty.title': 'No river selected yet.',
  'charts.empty.hint': 'Click a river on the map to inspect it, or manually enter a river ID, then reopen this panel to see its retrospective discharge charts.',
  'charts.tab.forecast': 'Forecast',
  'charts.tab.retro': 'Retrospective',
  'charts.tab.details': 'Details',
  'charts.axis.datetime': 'Datetime (UTC+00:00)',
}

const es: Dict = {
  'app.title': 'Sistema de Pronóstico de Ríos v3',
  'common.close': 'Cerrar',

  'settings.label': 'Configuración',
  'theme.toggle': 'Cambiar tema claro / oscuro',
  'about.label': 'Acerca de',
  'lang.title': 'Idioma',
  'lang.aria': 'Cambiar idioma',

  'hydro.heading': 'Predicciones hidrológicas',
  'hydro.forecastDate': 'Fecha de inicialización del pronóstico',
  'hydro.charts': 'Ver gráficos de caudal',
  'hydro.bookmarks.title': 'Ríos guardados',
  'hydro.bookmarks.aria': 'Explorar ríos guardados',
  'hydro.reports': 'Generar informes',
  'hydro.searchRiver': 'Buscar ID de río',

  'flood.heading': 'Mapeo de inundaciones',
  'flood.enable': '🌊 Activar modo de mapeo de inundaciones',
  'flood.disable': '🌊 Modo de mapeo de inundaciones: ACTIVADO',
  'flood.hintOff': 'Desactivado — haz clic en un río para inspeccionar sus atributos. Actívalo para marcar entradas y salidas de un mapa de inundación.',
  'flood.hintOn': 'Activado — haz clic en los tramos para marcar entradas y salidas. Haz clic fuera de un río para ver la profundidad de inundación.',
  'flood.testSite': 'Acércate al sitio de prueba de inundación en <a href="/#map=11.83/40.26207/-103.78294">Fort Morgan, Colorado</a>',
  'flood.inlet': '＋ Entrada',
  'flood.outlet': '✦ Salida',
  'flood.corridorHint': 'Haz clic en los tramos del mapa para marcarlos. El corredor = cada tramo aguas abajo de una entrada <em>y</em> aguas arriba de una salida.',
  'flood.noReaches': 'Ningún tramo seleccionado.',
  'flood.create': 'Crear mapa de inundación',
  'flood.saveGeotiff': '⬇ Guardar GeoTIFF',
  'flood.clear': 'Borrar selección',
  'flood.qLadder': 'Escala de caudal',
  'flood.qUniform': 'Caudal uniforme',
  'flood.dischargeLevel': 'Nivel de caudal',
  'flood.ladderHint': 'Escala por tramo a partir de las curvas de gasto (sustituto de demostración para los períodos de retorno).',
  'flood.uniformLabel': 'Caudal para cada tramo del corredor (m³/s)',
  'flood.status': 'La inundación se actualiza en vivo mientras mueves el control deslizante.',

  'legend.floodDepth': 'profundidad de inundación',
  'legend.readout': 'haz clic en un píxel inundado para ver la profundidad',

  'player.play': 'Reproducir / pausar (espacio)',
  'player.speed': 'Velocidad',
  'layers.label': 'Capas de mapa base',
  'legend.returnPeriod': 'Período de retorno del pronóstico',

  'about.intro': 'Animación del pronóstico global GEOGLOWS · elige entradas y salidas · extensión de inundación FLDPLN para los tramos entre ellas.',
  'about.coverageHeading': 'Cobertura y notas del modelo',
  'about.coverage': '<strong>La cobertura de la biblioteca de inundaciones es solo el pequeño mosaico de demostración N40W104</strong> (3 tramos en Colorado, resaltados). Los corredores en otros lugares se animan y se subdividen, pero no producen extensión de inundación hasta que exista un mosaico de biblioteca allí.',
  'about.model': 'FLDPLN es un modelo de detección de estado estacionario, basado solo en el MDE, impulsado por curvas de gasto sintéticas; las extensiones se saturan en la etapa máxima de la biblioteca. <strong>No apto para uso en emergencias.</strong> Terreno: FABDEM (© DLR / Airbus, CC BY-NC-SA 4.0). Hidrografía y pronóstico: GEOGLOWS.',
  'about.ossHeading': 'Software y datos de código abierto',
  'about.ossIntro': 'Esta aplicación está construida sobre paquetes y datos de código abierto:',
  'about.credit.maplibre': '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre GL JS</a>',
  'about.credit.calcite': '<a href="https://github.com/Esri/calcite-ui-icons" target="_blank" rel="noopener">Calcite UI Icons</a>',
  'about.credit.heroicons': '<a href="https://github.com/tailwindlabs/heroicons" target="_blank" rel="noopener">Heroicons</a>',
  'about.credit.chartjs': '<a href="https://www.chartjs.org/" target="_blank" rel="noopener">Chart.js</a> y complementos (adaptador date-fns, matrix, zoom)',
  'about.credit.zarrita': '<a href="https://github.com/manzt/zarrita.js" target="_blank" rel="noopener">zarrita.js</a> y <a href="https://github.com/manzt/numcodecs.js" target="_blank" rel="noopener">numcodecs</a> (acceso a Zarr)',
  'about.credit.hyparquet': '<a href="https://github.com/hyparam/hyparquet" target="_blank" rel="noopener">hyparquet</a> (lectura de mosaicos Parquet)',
  'about.credit.pmtiles': '<a href="https://github.com/protomaps/PMTiles" target="_blank" rel="noopener">PMTiles</a>',
  'about.credit.basemaps': 'Mapas base de <a href="https://livingatlas.arcgis.com/" target="_blank" rel="noopener">ArcGIS Living Atlas</a>',
  'about.credit.geoglows': 'Hidrogramas de ríos y FIM del <a href="https://geoglows.org/" target="_blank" rel="noopener">GEOGLOWS River Forecast System</a> v2 y v3',

  'settings.display': 'Visualización',
  'settings.showLegend': 'Mostrar leyenda del período de retorno del pronóstico',

  'river.heading': 'Río',
  'charts.heading': 'Gráficos de caudal',
  'charts.empty.title': 'Aún no se ha seleccionado ningún río.',
  'charts.empty.hint': 'Haz clic en un río del mapa para inspeccionarlo, o introduce manualmente un ID de río, y vuelve a abrir este panel para ver sus gráficos de caudal retrospectivo.',
  'charts.tab.forecast': 'Pronóstico',
  'charts.tab.retro': 'Retrospectivo',
  'charts.tab.details': 'Detalles',
  'charts.axis.datetime': 'Fecha y hora (UTC+00:00)',
}

const fr: Dict = {
  'app.title': 'Système de Prévision des Rivières v3',
  'common.close': 'Fermer',

  'settings.label': 'Paramètres',
  'theme.toggle': 'Basculer le thème clair / sombre',
  'about.label': 'À propos',
  'lang.title': 'Langue',
  'lang.aria': 'Changer de langue',

  'hydro.heading': 'Prévisions hydrologiques',
  'hydro.forecastDate': "Date d'initialisation de la prévision",
  'hydro.charts': 'Voir les graphiques de débit',
  'hydro.bookmarks.title': 'Rivières enregistrées',
  'hydro.bookmarks.aria': 'Parcourir les rivières enregistrées',
  'hydro.reports': 'Générer des rapports',
  'hydro.searchRiver': 'Rechercher un ID de rivière',

  'flood.heading': 'Cartographie des inondations',
  'flood.enable': "🌊 Activer le mode de cartographie des inondations",
  'flood.disable': '🌊 Mode de cartographie des inondations : ACTIVÉ',
  'flood.hintOff': "Désactivé — cliquez sur une rivière pour inspecter ses attributs. Activez-le pour marquer les entrées et sorties d'une carte d'inondation.",
  'flood.hintOn': "Activé — cliquez sur les tronçons pour marquer les entrées et sorties. Cliquez à l'écart d'une rivière pour la profondeur d'inondation.",
  'flood.testSite': 'Zoomez sur le site de test d\'inondation à <a href="/#map=11.83/40.26207/-103.78294">Fort Morgan, Colorado</a>',
  'flood.inlet': '＋ Entrée',
  'flood.outlet': '✦ Sortie',
  'flood.corridorHint': "Cliquez sur les tronçons de la carte pour les marquer. Le corridor = chaque tronçon en aval d'une entrée <em>et</em> en amont d'une sortie.",
  'flood.noReaches': 'Aucun tronçon sélectionné.',
  'flood.create': "Créer une carte d'inondation",
  'flood.saveGeotiff': '⬇ Enregistrer le GeoTIFF',
  'flood.clear': 'Effacer la sélection',
  'flood.qLadder': 'Échelle de débit',
  'flood.qUniform': 'Débit uniforme',
  'flood.dischargeLevel': 'Niveau de débit',
  'flood.ladderHint': 'Échelle par tronçon à partir des courbes de tarage (substitut de démonstration pour les périodes de retour).',
  'flood.uniformLabel': 'Débit pour chaque tronçon du corridor (m³/s)',
  'flood.status': 'L\'inondation se met à jour en direct lorsque vous déplacez le curseur.',

  'legend.floodDepth': "profondeur d'inondation",
  'legend.readout': "cliquez sur un pixel inondé pour la profondeur",

  'player.play': 'Lecture / pause (espace)',
  'player.speed': 'Vitesse',
  'layers.label': 'Couches de fond de carte',
  'legend.returnPeriod': 'Période de retour de la prévision',

  'about.intro': "Animation de la prévision mondiale GEOGLOWS · choisissez les entrées et sorties · étendue d'inondation FLDPLN pour les tronçons entre elles.",
  'about.coverageHeading': 'Couverture et notes sur le modèle',
  'about.coverage': "<strong>La couverture de la bibliothèque d'inondations se limite à la petite tuile de démonstration N40W104</strong> (3 tronçons au Colorado, surlignés). Les corridors ailleurs s'animent et se subdivisent, mais ne produisent aucune étendue d'inondation tant qu'une tuile de bibliothèque n'existe pas à cet endroit.",
  'about.model': "FLDPLN est un modèle de dépistage en régime permanent, basé uniquement sur le MNT, alimenté par des courbes de tarage synthétiques ; les étendues saturent au stade maximal de la bibliothèque. <strong>Ne pas utiliser en cas d'urgence.</strong> Terrain : FABDEM (© DLR / Airbus, CC BY-NC-SA 4.0). Hydrographie et prévision : GEOGLOWS.",
  'about.ossHeading': 'Logiciels et données open source',
  'about.ossIntro': 'Cette application repose sur des paquets et des données open source :',
  'about.credit.maplibre': '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre GL JS</a>',
  'about.credit.calcite': '<a href="https://github.com/Esri/calcite-ui-icons" target="_blank" rel="noopener">Calcite UI Icons</a>',
  'about.credit.heroicons': '<a href="https://github.com/tailwindlabs/heroicons" target="_blank" rel="noopener">Heroicons</a>',
  'about.credit.chartjs': '<a href="https://www.chartjs.org/" target="_blank" rel="noopener">Chart.js</a> et extensions (adaptateur date-fns, matrix, zoom)',
  'about.credit.zarrita': '<a href="https://github.com/manzt/zarrita.js" target="_blank" rel="noopener">zarrita.js</a> et <a href="https://github.com/manzt/numcodecs.js" target="_blank" rel="noopener">numcodecs</a> (accès Zarr)',
  'about.credit.hyparquet': '<a href="https://github.com/hyparam/hyparquet" target="_blank" rel="noopener">hyparquet</a> (lecture de tuiles Parquet)',
  'about.credit.pmtiles': '<a href="https://github.com/protomaps/PMTiles" target="_blank" rel="noopener">PMTiles</a>',
  'about.credit.basemaps': 'Fonds de carte de <a href="https://livingatlas.arcgis.com/" target="_blank" rel="noopener">ArcGIS Living Atlas</a>',
  'about.credit.geoglows': 'Hydrogrammes de rivières et FIM du <a href="https://geoglows.org/" target="_blank" rel="noopener">GEOGLOWS River Forecast System</a> v2 et v3',

  'settings.display': 'Affichage',
  'settings.showLegend': 'Afficher la légende de la période de retour de la prévision',

  'river.heading': 'Rivière',
  'charts.heading': 'Graphiques de débit',
  'charts.empty.title': "Aucune rivière sélectionnée pour l'instant.",
  'charts.empty.hint': "Cliquez sur une rivière de la carte pour l'inspecter, ou saisissez manuellement un ID de rivière, puis rouvrez ce panneau pour voir ses graphiques de débit rétrospectif.",
  'charts.tab.forecast': 'Prévision',
  'charts.tab.retro': 'Rétrospectif',
  'charts.tab.details': 'Détails',
  'charts.axis.datetime': 'Date et heure (UTC+00:00)',
}

const DICTS: Record<string, Dict> = { en, es, fr }

let currentLang = 'en'

/** Look a key up in `lang` (defaults to the active language), falling back to English then the key. */
export function t(key: string, lang: string = currentLang): string {
  return DICTS[lang]?.[key] ?? en[key] ?? key
}

/** The language code currently applied to the UI. */
export function getLanguage(): string {
  return currentLang
}

/** Fill every `data-i18n*` element under `root` from the `lang` dictionary. */
export function applyTranslations(lang: string, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!, lang)
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml!, lang)
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle!, lang))
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel!, lang))
  })
}

/** Make `lang` the active language: records it, sets <html lang>, and re-renders the static UI. */
export function setLanguage(lang: string): void {
  currentLang = DICTS[lang] ? lang : 'en'
  document.documentElement.lang = currentLang
  applyTranslations(currentLang)
}
