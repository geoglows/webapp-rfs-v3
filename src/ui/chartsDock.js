import {dataProgress, getLanguage, t} from "../i18n/i18n";
import {SAMPLE_DATA_RIVER_INDEX} from "../constants";
import {resolve} from "../data/riverIndex";
import {getSetting} from "../settings";
import {setInspectHighlight} from "../map/inspectHighlight";
import {closeDock, onDockClosed, openDock} from "./dock";

const $ = (id) => document.getElementById(id);
const CHARTS_TABS = ["forecast", "retro", "details"];

function renderAttrTable(props) {
  const keys = Object.keys(props).sort((a, b) => a === "riverId" ? -1 : b === "riverId" ? 1 : a.localeCompare(b));
  if (!keys.length) return '<div class="attr-empty">This feature carries no attributes.</div>';
  return `<table class="attr-table">${keys.map((k) => `<tr><td class="k">${k}</td><td class="v">${props[k]}</td></tr>`).join("")}</table>`;
}

// Shown by every tab when there's no reach to describe — e.g. the dock was opened from the header
// button rather than by clicking a river.
const chartsEmpty = () => `<div class="charts-empty"><p>${t("charts.empty.title")}</p><p class="hint">${t("charts.empty.hint")}</p></div>`;
const chartsLoading = (blockId, label) =>
  `<div id="${blockId}" class="ts-loading"><span class="spinner"></span><span class="ts-loading-label">${label}</span></div>`;

/**
 * The charts dock: a tabbed panel (forecast / retrospective / attributes) that widens the left
 * panel over the map. Owns which reach is being inspected and which tabs have been rendered.
 *
 * getForecastDate() is read at fetch time rather than captured, so switching the forecast date
 * is picked up by the next render without having to re-wire anything.
 */
function createChartsDock({map, getForecastDate}) {
  let selectedRiverId = null;
  let selectedRiverProps = null;
  let selectedRiverIndex = null;
  const rendered = {forecast: false, retro: false, details: false};
  let plotsLoaded = false;
  // Bumped every time the dock is pointed at a reach, so a fetch that lands late can tell that what
  // it went to get is no longer what's on screen. Finding the block element can't tell it that: a
  // re-render puts the same id back on a fresh element whichever reach it is for.
  let selectionId = 0;

  // Both chart tabs load the same way: pull in the chart bundle, fetch the series, bail out if the
  // user navigated away mid-flight, then hand the host element to the renderer. Only the fetch and
  // the renderer differ — a failure reads the same either way, since which reader was asked is not
  // something the user chose.
  async function loadChartBlock(blockId, {fetchData, render}) {
    const block = $(blockId);
    if (!block) return;
    // The loading line is all that is on screen while the fetch runs, and resolving an id can put a
    // 17 MB download in front of it — so the fetch gets to say what it is doing.
    const setStatus = (text) => {
      const label = $(blockId)?.querySelector(".ts-loading-label");
      if (label) label.textContent = text;
    };
    const forSelection = selectionId;
    try {
      const plots = await import("rfsjs/v3/plots");
      plotsLoaded = true;
      const data = await fetchData(setStatus);
      // The dock may have closed while the download was in flight.
      if (!$(blockId)) {
        plots.clearPlots();
        return;
      }
      // Or moved to another reach: what is on screen belongs to the newer selection, so this result
      // is dropped rather than cleared — clearing would take the newer charts with it.
      if (forSelection !== selectionId) return;
      block.className = "";
      block.innerHTML = `<div class="ts-charts"></div>`;
      await render(plots, block.querySelector(".ts-charts"), data);
    } catch (e) {
      block.className = "ts-error";
      block.textContent = `${t("charts.failed")}: ${e.message}`;
    }
  }

  /**
   * The index of the reach on screen — what the readers are actually asked for.
   *
   * Every way into a reach but one already carries an index: map clicks read it off the tile, saved
   * rivers store it, the search box resolves it before it calls in. The exception is a reach known
   * only by its id, and it is not a dead end — the lookup that translates it is a download away, so
   * take the download. Remembered on the selection, so the second tab doesn't resolve it again.
   */
  async function targetIndex(setStatus) {
    if (selectedRiverIndex != null) return selectedRiverIndex;
    const forSelection = selectionId;
    const riverId = selectedRiverId;
    const index = await resolve(riverId, {onProgress: (p) => setStatus?.(dataProgress(p))});
    if (index < 0) throw new Error(t("search.notFound").replace("{id}", riverId));
    // Remembered for the other tab — but only if it is still this reach the dock is showing.
    if (forSelection === selectionId) selectedRiverIndex = index;
    return index;
  }

  // The readers only echo back a riverId when you query by id, so stamp on the selected one — the
  // chart titles name the reach from it.
  const loadRetro = (blockId) => loadChartBlock(blockId, {
    fetchData: async (setStatus) => {
      const riverIndex = await targetIndex(setStatus);
      setStatus(t("charts.loading"));
      const {retrospective} = await import("rfsjs/v3/discharge");
      // TODO(sample-data): send `riverIndex`. It is the reach the user actually asked for and every
      // layer above this line already works in it — only the store is the placeholder, so the call
      // is pinned to a reach the synthetic sample holds. One line to delete, here and below.
      return {...await retrospective({riverIndex: SAMPLE_DATA_RIVER_INDEX}), riverId: selectedRiverId};
    },
    render: (plots, host, ts) => plots.plotAllRetro(host, ts, {lang: getLanguage()})
  });

  // The hydrograph and the warning levels it is read against live in different stores, so they are
  // two reads issued together rather than one. The chart is drawn from whichever arrive: return
  // periods are context for the forecast, so a reach the fit has no values for — or a store that
  // fails — costs the bands, not the forecast.
  const loadForecast = (blockId) => loadChartBlock(blockId, {
    fetchData: async (setStatus) => {
      const riverIndex = await targetIndex(setStatus);
      setStatus(t("charts.loading"));
      const {forecast, returnPeriods} = await import("rfsjs/v3/discharge");
      // TODO(sample-data): send `riverIndex` to both — see the note in loadRetro.
      const [fc, rp] = await Promise.all([
        forecast({date: getForecastDate(), riverIndex: SAMPLE_DATA_RIVER_INDEX}),
        // hourly: the forecast is an instantaneous series, so the hourly fit is the like-for-like
        // exceedance — the daily fit answers a question about daily means, which this is not.
        returnPeriods({riverIndex: SAMPLE_DATA_RIVER_INDEX, resolution: "hourly"}).catch(() => null)
      ]);
      return {forecast: {...fc, riverId: selectedRiverId}, returnPeriods: rp};
    },
    render: (plots, host, {forecast, returnPeriods}) => plots.plotAllForecast(host, forecast, {
      lang: getLanguage(),
      returnPeriods,
      // Shaded boxes or plain lines is the user's standing preference, not a per-chart control —
      // read at render time, which is why changing it re-renders (see rerenderCharts).
      levelsAs: getSetting("shadedWarningLevels") ? "boxes" : "lines"
    })
  });

  function renderTab(tab) {
    if (tab === "details") {
      $("charts-panel-details").innerHTML = selectedRiverProps ? renderAttrTable(selectedRiverProps) : chartsEmpty();
      return;
    }
    const panel = $(`charts-panel-${tab}`);
    // Don't fetch anything until a river is actually selected.
    if (selectedRiverId == null && selectedRiverIndex == null) {
      panel.innerHTML = chartsEmpty();
      return;
    }
    if (tab === "forecast") {
      panel.innerHTML = chartsLoading("charts-fc-block", t("charts.loading"));
      loadForecast("charts-fc-block");
    } else {
      panel.innerHTML = chartsLoading("charts-ts-block", t("charts.loading"));
      loadRetro("charts-ts-block");
    }
  }

  function activateTab(tab) {
    for (const name of CHARTS_TABS) {
      const on = name === tab;
      $(`charts-tab-${name}`).classList.toggle("active", on);
      $(`charts-tab-${name}`).setAttribute("aria-selected", String(on));
      $(`charts-panel-${name}`).hidden = !on;
    }
    if (!rendered[tab]) {
      renderTab(tab);
      rendered[tab] = true;
    }
  }

  // Tear down the live charts whenever the dock leaves the screen — whether it was closed outright
  // or displaced by another dock (see ui/dock.js). Never pulls the chart bundle in just to do it.
  onDockClosed("charts", () => {
    if (plotsLoaded) void import("rfsjs/v3/plots").then((m) => m.clearPlots());
  });

  const close = () => closeDock(map, "charts");

  /**
   * Open the dock for a reach — a clicked feature, a saved river, a search result — or with no
   * argument to reuse the last one. Whatever index the caller carries is the index of that reach on
   * the axis the readers hit; a caller with only an id leaves it null and targetIndex() looks it up.
   */
  function openForRiver(props) {
    selectionId++;
    if (props) {
      selectedRiverProps = props;
      if (props.riverId != null) selectedRiverId = Number(props.riverId);
      selectedRiverIndex = props.riverIndex != null ? Number(props.riverIndex) : null;
    }
    setInspectHighlight(map, selectedRiverId);
    // Reaches opened from the saved-rivers dock carry a name; ones clicked on the map don't.
    const named = selectedRiverProps?.name ? ` · ${selectedRiverProps.name}` : "";
    $("charts-modal-title").textContent =
      selectedRiverId != null ? `${t("river.heading")} ${selectedRiverId}${named}` : t("charts.heading");
    for (const name of CHARTS_TABS) rendered[name] = false;
    activateTab("forecast");
    openDock(map, "charts");
  }

  /** Repaint live charts after a theme change; no-op if the chart bundle was never loaded. */
  function restyleCharts() {
    if (plotsLoaded) void import("rfsjs/v3/plots").then((m) => m.restyleCharts());
  }

  /**
   * Build the open chart tab again — for a language change, or for a display preference the charts
   * read when they render.
   *
   * Language is the reason this can't be done in place: chart text is drawn into a canvas, so unlike
   * the rest of the UI it cannot be retranslated by walking [data-i18n]. Cheap either way — the
   * language chunk is cached after first use, and the series comes back from the reader's own cache
   * rather than the network.
   */
  function rerenderCharts() {
    if (!plotsLoaded) return;
    const active = CHARTS_TABS.find((name) => $(`charts-tab-${name}`)?.classList.contains("active"));
    if (!active || active === "details") return;
    renderTab(active);
  }

  for (const name of CHARTS_TABS) $(`charts-tab-${name}`).addEventListener("click", () => activateTab(name));
  $("btn-charts").addEventListener("click", () => openForRiver());
  $("charts-close").addEventListener("click", close);

  return {openForRiver, close, restyleCharts, rerenderCharts};
}

export {createChartsDock};
