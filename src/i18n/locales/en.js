/**
 * English — the fallback for every other language and the language the HTML in index.html is
 * written in, so this one is bundled rather than fetched: t() reads it synchronously for any key a
 * translation is missing, and it is what the app shows before a chosen translation lands.
 *
 * Every other language is a JSON file beside this one, loaded only if it is chosen. Adding one
 * means a <locale>.json here and a button in #lang-menu (index.html) — nothing imports them by
 * name. Keys are this file: a translation that lacks one falls back here rather than breaking.
 */
export default {
  "app.title": "River Forecast System v3",
  "common.close": "Close",
  // header
  "settings.label": "Settings",
  "theme.toggle": "Toggle light / dark theme",
  "about.label": "About",
  "instructions.label": "How to use this site",
  "lang.title": "Language",
  "lang.aria": "Change language",
  // hydrology predictions
  "hydro.heading": "Hydrology predictions",
  "hydro.forecastDate": "Forecast Initialization Date",
  "hydro.charts": "View discharge charts",
  "hydro.bookmarks.title": "Notable global rivers",
  "hydro.bookmarks.aria": "Browse notable global rivers",
  "hydro.saved.title": "My saved rivers",
  "hydro.saved.aria": "Browse my saved rivers",
  "hydro.searchRiver": "Search River ID",
  "hydro.clearRiver": "Clear the selected river",
  // stream style picker
  "stream.style": "Stream style",
  "stream.style.standard": "Standard",
  "stream.style.timeseries": "15 Day Timeseries",
  "stream.style.max-flow": "Forecasted Max Flows",
  "stream.style.time-to-peak": "Time to Peak",
  "stream.style.below-q95": "Below Q95 flow",
  "stream.hideSlider": "Hide timeseries slider",
  "stream.showSlider": "Show timeseries slider",
  // flood mapping
  "flood.heading": "Flood Mapping",
  "flood.enable": "Enable flood mapping mode",
  "flood.disable": "Flood mapping mode: ON",
  "flood.inlet": "＋ Inlet",
  "flood.outlet": "✦ Outlet",
  "flood.saveGeotiff": "Save GeoTIFF",
  "flood.clear": "Clear selection",
  "flood.style": "Flood style",
  "flood.style.manual": "Manually Specified Flow",
  "flood.style.ratingcurve": "Synthetic Rating Curve Slider",
  "flood.style.returnperiod": "Return Period Indexed",
  // Shown in place of the usual status line while the return-period style is selected: it is in the
  // picker but not built yet, and an option that silently draws nothing reads as a broken one.
  "flood.style.returnperiod.pending": "Return period indexed flooding is not available yet. Pick another flood style.",
  "flood.style.forecast": "Forecast Timeseries",
  "flood.style.forecastmax": "Forecast Maximum",
  "flood.fcPlay": "Play / pause the forecast animation",
  "flood.dischargeLevel": "Discharge level",
  "flood.uniformLabel": "Discharge for every selected reach (m³/s)",
  "flood.status": "Flood updates live as you move the slider.",
  // depth legend
  "legend.floodDepth": "flood depth",
  "legend.readout": "click a flooded pixel for depth",
  // player + map overlays
  "player.play": "Play / pause (space)",
  "player.speed": "Speed",
  "basemap.label": "Basemap",
  "layers.label": "Map layers",
  "layers.streams": "Streams",
  "layers.floodExtents": "Flood extents",
  "layers.riverfld": "River flooding (SSEC)",
  "layers.goes": "Satellite IR (GOES)",
  "layers.viirs": "True color (VIIRS)",
  "legend.returnPeriod": "Forecast return period",
  // settings modal
  "settings.display": "Display",
  "settings.showLegend": "Show forecast return-period legend",
  "settings.shadedWarningLevels": "Shade warning levels on the forecast chart",
  "settings.savedHighlight": "Outline my saved rivers on the map",
  "settings.data": "Downloaded Data",
  "settings.data.hint": "This site keeps local copies of some datasets for better performance. These can be redownloaded at any time and are safe to delete.",
  "settings.data.riverIds": "River IDs",
  "settings.data.riverIds.hint": "The river network's ID list, which lets rivers be found by ID. Fetched on its own shortly after the app loads, so searching by ID is ready before anyone asks for it.",
  "settings.data.download": "Download",
  "settings.data.remove": "Delete",
  "settings.data.downloadAll": "Download everything",
  "settings.data.deleteAll": "Delete everything",
  "settings.data.deleteAllConfirm": "Click again to delete everything",
  "settings.data.empty": "Nothing downloaded.",
  "settings.data.starting": "Starting\u2026",
  "settings.data.downloading": "Downloading",
  "settings.data.sorting": "Building lookup",
  "settings.data.verifying": "Verifying",
  "settings.data.storing": "Saving",
  "settings.data.cancelled": "Cancelled.",
  "settings.data.failed": "Failed",
  // river ID search
  "search.heading": "Find a river by ID",
  "search.label": "River ID",
  "search.placeholder": "e.g. 760021611",
  "search.submit": "Search",
  "search.invalid": "Enter a river ID — digits only.",
  "search.searching": "Searching…",
  "search.notFound": "No river with ID {id} is in the network.",
  "search.failed": "Search failed",
  "common.cancel": "Cancel",
  // river + charts modals
  "river.heading": "River",
  "charts.heading": "Discharge charts",
  "charts.empty.title": "No river selected yet.",
  "charts.empty.hint": "Click a river on the map to inspect it, or manually enter a river ID, then reopen this panel to see hydrographs.",
  "charts.tab.forecast": "Forecast",
  "charts.tab.retro": "Retrospective",
  "charts.tab.details": "Details",
  "charts.loading": "Loading model results…",
  "charts.failed": "Failed to load model results",
  // saved rivers dock
  "bookmarks.heading": "Notable Global Rivers Reference",
  "bookmarks.hint": "Pick a river to fly the map to it and load its charts.",
  "bookmarks.col.id": "River ID",
  "bookmarks.col.name": "River Name",
  "bookmarks.col.lat": "Lat",
  "bookmarks.col.lon": "Lon",
  "bookmarks.col.actions": "Actions",
  "bookmarks.select": "View charts",
  // rivers the user saved themselves
  "saved.heading": "My Saved Rivers",
  "saved.empty": "No saved rivers yet. Open a river and click the heart to save it.",
  "saved.remove": "Remove",
  "river.save": "Save this river",
  "river.unsave": "Remove from my saved rivers",
  "saveRiver.heading": "Save river",
  "saveRiver.label": "Name for this river",
  "saveRiver.placeholder": "e.g. Gauge upstream of town",
  "saveRiver.submit": "Save",
  // The prose modals — About and how-to-use — keep only their chrome here. Their text is a document
  // per language under src/modals/about/ and src/modals/instructions/, fetched on demand
  // (src/modals/docModal.js).
  // The loading and failure lines are shared by both, so they name neither.
  "instructions.heading": "How to use this site",
  "doc.loading": "Loading…",
  "doc.failed": "This could not be loaded. Check your connection and try again.",
};
