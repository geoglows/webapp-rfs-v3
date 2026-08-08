import {dataProgress, getLanguage, t} from "../i18n/i18n.js";
import {resolve} from "../data/riverIndex.js";
import {locate} from "../data/riverLocation.js";
import {getSavedRiver, onSavedRiversChange, removeSavedRiver, saveRiver} from "../data/savedRivers.js";
import {heroIcon} from "../icons/icons.js";
import {askRiverName} from "../ui/saveRiverName.js";
import {getSetting} from "../settings/settings.js";
import {closeDock, isDockOpen, onDockClosed, openDock} from "./dock.js";

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
const chartsLoading = (blockId, label) => `<div id="${blockId}" class="ts-loading"><span class="spinner"></span><span class="ts-loading-label">${label}</span></div>`;

/**
 * The charts dock: a tabbed panel (forecast / retrospective / attributes) that widens the left
 * panel over the map. Owns which reach is being inspected and which tabs have been rendered.
 *
 * getForecastDate() is read at fetch time rather than captured, so switching the forecast date
 * is picked up by the next render without having to re-wire anything.
 */
function createChartsDock({map, streams, getForecastDate}) {
  let selectedRiverId = null;
  let selectedRiverProps = null;
  let selectedRiverIndex = null;
  // Where the reach is, kept apart from its tile properties: for a map click this is the click
  // point, which belongs to the save and not in the attributes table.
  let selectedLocation = null;
  // The name the reach arrived with — the Notable Global Rivers list gives one, a map click does
  // not. Held apart from the props so un-saving can drop it: a river that is no longer saved shows
  // no name, and the one it came in with would otherwise take the saved name's place in the title.
  let selectedName = "";
  // Whether the reach on screen was saved as of the last render, which is the only way to tell an
  // un-save apart from a reach that was simply never saved.
  let wasSaved = false;
  const rendered = {forecast: false, retro: false, details: false};
  let plotsLoaded = false;
  // Bumped every time the dock is pointed at a reach, so a fetch that lands late can tell that what
  // it went to get is no longer what's on screen. Finding the block element can't tell it that: a
  // re-render puts the same id back on a fresh element whichever reach it is for.
  let selectionId = 0;

  async function loadChartBlock(blockId, {fetchData, render}) {
    const block = $(blockId);
    if (!block) return;
    const setStatus = (text) => {
      const label = $(blockId)?.querySelector(".ts-loading-label");
      if (label) label.textContent = text;
    };
    const forSelection = selectionId;
    try {
      const plots = await import("riverforecastsystem/v3/plots");
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
      let riverIndex = await targetIndex(setStatus);
      riverIndex = 0 // todo override for demo phase
      setStatus(t("charts.loading"));
      const {retrospective} = await import("riverforecastsystem/v3/discharge");
      return {...await retrospective({riverIndex: riverIndex}), riverId: selectedRiverId};
    },
    render: (plots, host, ts) => plots.plotAllRetro(host, ts, {lang: getLanguage()})
  });

  // The hydrograph and the warning levels it is read against live in different stores, so they are
  // two reads issued together rather than one. The chart is drawn from whichever arrive: return
  // periods are context for the forecast, so a reach the fit has no values for — or a store that
  // fails — costs the bands, not the forecast.
  const loadForecast = (blockId) => loadChartBlock(blockId, {
    fetchData: async (setStatus) => {
      let riverIndex = await targetIndex(setStatus);
      riverIndex = 0 // todo override for demo phase
      setStatus(t("charts.loading"));
      const {forecast, returnPeriods} = await import("riverforecastsystem/v3/discharge");
      const [fc, rp] = await Promise.all([
        forecast({date: getForecastDate(), riverIndex: riverIndex}),
        returnPeriods({riverIndex: riverIndex, resolution: "hourly"}).catch(() => null)
      ]);
      return {forecast: {...fc, riverId: selectedRiverId}, returnPeriods: rp};
    },
    render: (plots, host, {forecast, returnPeriods}) => plots.plotAllForecast(host, forecast, {
      lang: getLanguage(),
      returnPeriods,
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
    if (plotsLoaded) void import("riverforecastsystem/v3/plots").then((m) => m.clearPlots());
  });

  const close = () => closeDock(map, "charts");

  // ── the save-this-river heart ───────────────────────────────────────────────
  const savedEntry = () => (selectedRiverId == null ? null : getSavedRiver(selectedRiverId));

  /**
   * The dock's heading and the heart beside it, both of which say whether this reach is saved.
   *
   * The name shown is the user's own if they gave one, and the reach's built-in name otherwise —
   * naming a saved river is how you make the charts title read as something other than a number, so
   * what they typed has to win over what it arrived with.
   */
  function renderHead() {
    const saved = savedEntry();
    // Un-saved just now: the name goes with the bookmark. Reverting to whichever name the reach
    // walked in with would leave the title looking untouched by the un-save, and this is the one
    // place both ways of un-saving pass through — the heart here, and Remove in the saved dock.
    if (wasSaved && !saved) selectedName = "";
    wasSaved = !!saved;
    // The heading is the reach's identity and nothing else; the name is its own element on the far
    // side of the heart, so the row reads "River 12345 ♥ what you called it".
    $("charts-modal-title").textContent = selectedRiverId != null
      ? `${t("river.heading")} ${selectedRiverId}`
      : t("charts.heading");
    const nameEl = $("charts-river-name");
    if (nameEl) nameEl.textContent = saved?.name || selectedName;

    const btn = $("charts-save");
    if (!btn) return;
    // Nothing to save when the dock was opened from the header button with no reach behind it.
    btn.hidden = selectedRiverId == null;
    btn.replaceChildren(heroIcon(saved ? "heart-solid" : "heart"));
    btn.classList.toggle("saved", !!saved);
    btn.setAttribute("aria-pressed", String(!!saved));
    // Set as data-i18n-* as well as directly, so a language change retranslates a label whose key
    // depends on state — applyTranslations() walks these attributes and can't know the state.
    const key = saved ? "river.unsave" : "river.save";
    btn.dataset.i18nTitle = key;
    btn.dataset.i18nAriaLabel = key;
    btn.title = t(key);
    btn.setAttribute("aria-label", t(key));
    // Nothing to clear with no reach selected — the panel's button is the state readout for that.
    const clear = $("btn-clear-river");
    if (clear) clear.disabled = selectedRiverId == null && selectedRiverIndex == null;
  }

  /**
   * Drop the reach the app is pointed at: the green highlight on the map, the charts drawn for it,
   * and everything remembered about it.
   *
   * Leaves the dock open. It goes back to the placeholder it shows before anything has been
   * clicked, which is the honest state — there is no reach, rather than a reach whose charts have
   * been hidden. The selection bump matters as much as the fields: a fetch still in flight for the
   * cleared reach would otherwise land and draw itself into the empty panel.
   */
  function clearSelection() {
    selectionId++;
    selectedRiverId = null;
    selectedRiverProps = null;
    selectedRiverIndex = null;
    selectedLocation = null;
    selectedName = "";
    wasSaved = false;
    streams.setInspectHighlight(null);
    // Chart.js instances outlive their container, so dropping the markup is not enough — the same
    // teardown the dock does when it closes (see onDockClosed above).
    if (plotsLoaded) void import("riverforecastsystem/v3/plots").then((m) => m.clearPlots());
    renderHead();
    for (const name of CHARTS_TABS) rendered[name] = false;
    // Only the tab on screen is repainted; the others render on the way in, as they always do.
    const active = CHARTS_TABS.find((name) => $(`charts-tab-${name}`)?.classList.contains("active"));
    if (!active) return;
    renderTab(active);
    rendered[active] = true;
  }

  /**
   * Heart clicked: drop the river if it was saved, otherwise capture it whole and ask for a name.
   *
   * Whole means id, index and coordinate — the three things a saved river is read back by, none of
   * which the list should ever have to go and find later. Two of them are usually already in hand
   * (the tile carried the index, the click carried the point); the fallbacks are for the reach that
   * arrived as a bare id, and they run before the prompt so the name is the last thing asked for
   * rather than the thing left waiting on a download.
   */
  async function toggleSaved() {
    if (selectedRiverId == null) return;
    const riverId = selectedRiverId;
    if (savedEntry()) {
      // The re-render this triggers is what clears the name — see renderHead().
      removeSavedRiver(riverId);
      return;
    }
    const forSelection = selectionId;
    let riverIndex = selectedRiverIndex;
    // Already resolved by the forecast tab in every ordinary case, so this is a read of what it
    // remembered. A reach whose index can't be found is still worth saving under its id.
    if (riverIndex == null) riverIndex = await targetIndex().catch(() => null);
    let {lat, lon} = selectedLocation ?? {};
    if ((lat == null || lon == null) && riverIndex != null) {
      const at = await locate(riverIndex).catch((e) => {
        console.warn(`could not locate river ${riverId}: ${e.message}`);
        return null;
      });
      lat = at?.lat;
      lon = at?.lon;
    }
    // The dock moved on to another reach while that was in flight — saving now would save the wrong
    // river under the heart the user is looking at.
    if (forSelection !== selectionId) return;
    const name = await askRiverName({riverId, name: selectedName});
    // Dismissed. The heart is a two-step action and backing out of the second step saves nothing.
    if (name == null) return;
    saveRiver({riverId, riverIndex, lat, lon, name});
  }

  /**
   * Open the dock for a reach — a clicked feature, a saved river, a search result — or with no
   * argument to reuse the last one. Whatever index the caller carries is the index of that reach on
   * the axis the readers hit; a caller with only an id leaves it null and targetIndex() looks it up.
   *
   * `location` is where the reach is, if the caller knows: the click point for a map click, the
   * stored outlet for a saved river. Passed separately from `props` because a map click's point is
   * not one of the tile's attributes and has no business in the details table.
   */
  function openForRiver(props, location = null) {
    selectionId++;
    if (props) {
      selectedRiverProps = props;
      if (props.riverId != null) selectedRiverId = Number(props.riverId);
      selectedRiverIndex = props.riverIndex != null ? Number(props.riverIndex) : null;
      selectedLocation = location?.lat != null && location?.lon != null
        ? {lat: Number(location.lat), lon: Number(location.lon)}
        : null;
      selectedName = typeof props.name === "string" ? props.name : "";
      // This reach's own saved state, not the last one's — otherwise moving from a saved river to
      // an unsaved one reads to renderHead() as an un-save and drops the new reach's name.
      wasSaved = savedEntry() != null;
    }
    streams.setInspectHighlight(selectedRiverId);
    renderHead();
    for (const name of CHARTS_TABS) rendered[name] = false;
    activateTab("forecast");
    openDock(map, "charts");
  }

  /** Repaint live charts after a theme change; no-op if the chart bundle was never loaded. */
  function restyleCharts() {
    if (plotsLoaded) void import("riverforecastsystem/v3/plots").then((m) => m.restyleCharts());
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
    // The heading carries a reach's id and name, so applyTranslations() — which runs first on a
    // language change and only knows the element's data-i18n default — has just replaced it with
    // "Discharge charts". Put the reach back before anything else.
    renderHead();
    if (!plotsLoaded) return;
    const active = CHARTS_TABS.find((name) => $(`charts-tab-${name}`)?.classList.contains("active"));
    if (!active || active === "details") return;
    renderTab(active);
  }

  for (const name of CHARTS_TABS) $(`charts-tab-${name}`).addEventListener("click", () => activateTab(name));
  $("btn-charts").addEventListener("click", () => (isDockOpen("charts") ? close() : openForRiver()));
  $("charts-close").addEventListener("click", close);
  $("charts-save")?.addEventListener("click", () => void toggleSaved());
  $("btn-clear-river")?.addEventListener("click", clearSelection);
  // Follows the list rather than the click, so removing this reach from the saved-rivers dock fills
  // the heart back in here too.
  onSavedRiversChange(renderHead);

  return {openForRiver, clearSelection, close, restyleCharts, rerenderCharts};
}

export {createChartsDock};
