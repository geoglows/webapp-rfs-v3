import {getLanguage, t} from "../i18n/i18n";
import {DEV_RIVER_ID, DEV_RIVER_INDEX} from "../constants";
import {setInspectHighlight} from "../map/inspectHighlight";

const $ = (id) => document.getElementById(id);
const CHARTS_TABS = ["forecast", "retro", "details"];

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);

function renderAttrTable(props) {
  const keys = Object.keys(props).sort((a, b) => a === "riverId" ? -1 : b === "riverId" ? 1 : a.localeCompare(b));
  if (!keys.length) return '<div class="attr-empty">This feature carries no attributes.</div>';
  return `<table class="attr-table">${keys.map((k) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(String(props[k]))}</td></tr>`).join("")}</table>`;
}

// Shown by every tab when there's no reach to describe — e.g. the dock was opened from the header
// button rather than by clicking a river.
const chartsEmpty = () => `<div class="charts-empty"><p>${t("charts.empty.title")}</p><p class="hint">${t("charts.empty.hint")}</p></div>`;
const chartsLoading = (blockId, label) => `<div id="${blockId}" class="ts-loading"><span class="spinner"></span>${label}</div>`;

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
  const rendered = {forecast: false, retro: false, details: false};
  // Whether the (large) chart bundle has ever been pulled in. Closing the dock without having
  // rendered anything must not fetch it purely to call clearPlots().
  let plotsLoaded = false;

  // Both chart tabs load the same way: pull in the chart bundle, fetch the series, bail out if
  // the user navigated away mid-flight, then render a hint line above the charts. Only the fetch,
  // the hint text, the renderer, and the error prefix differ.
  async function loadChartBlock(blockId, {fetchData, hint, render, errorLabel}) {
    const block = $(blockId);
    if (!block) return;
    try {
      const plots = await import("rfsjs/plots");
      plotsLoaded = true;
      const data = await fetchData();
      // The dock may have closed, or moved to another reach, while the download was in flight.
      if (!$(blockId)) {
        plots.clearPlots();
        return;
      }
      block.className = "";
      block.innerHTML = `<p class="hint">${hint(data)}</p><div class="ts-charts"></div>`;
      await render(plots, block.querySelector(".ts-charts"), data);
    } catch (e) {
      block.className = "ts-error";
      block.textContent = `${errorLabel}: ${e.message}`;
    }
  }

  const loadRetro = (blockId) => loadChartBlock(blockId, {
    // The library only echoes back a riverId when you query by id; we query by index during model
    // development, so stamp the dev id on so chart titles can name the reach.
    fetchData: async () => ({
      ...await (await import("rfsjs")).v3.discharge.retrospective({riverIndex: DEV_RIVER_INDEX}),
      riverId: DEV_RIVER_ID
    }),
    hint: (ts) => `Dev river ${DEV_RIVER_ID} · ${ts.discharge.length.toLocaleString()} daily steps (clicked reach ignored during model development).`,
    render: (plots, host, ts) => plots.plotAllRetro(host, ts, {lang: getLanguage()}),
    errorLabel: "Failed to load time series"
  });

  const loadForecast = (blockId) => loadChartBlock(blockId, {
    fetchData: async () => ({
      ...await (await import("rfsjs")).v3.discharge.forecast({date: getForecastDate(), riverIndex: DEV_RIVER_INDEX}),
      riverId: DEV_RIVER_ID
    }),
    // The reader echoes back neither the init date nor the member ids — the date is the one we
    // asked for, and the member count comes off the stats it does return.
    hint: (fc) => `Dev river ${DEV_RIVER_ID} · forecast initialized ${getForecastDate()} · ${fc.stats.memberCount} members · ${fc.time.length} steps (clicked reach ignored during model development).`,
    render: (plots, host, fc) => plots.plotAllForecast(host, fc, {lang: getLanguage()}),
    errorLabel: "Failed to load forecast"
  });

  function renderTab(tab) {
    if (tab === "details") {
      $("charts-panel-details").innerHTML = selectedRiverProps ? renderAttrTable(selectedRiverProps) : chartsEmpty();
      return;
    }
    const panel = $(`charts-panel-${tab}`);
    // Don't fetch anything until a river is actually selected.
    if (selectedRiverId == null) {
      panel.innerHTML = chartsEmpty();
      return;
    }
    if (tab === "forecast") {
      panel.innerHTML = chartsLoading("charts-fc-block", "Loading forecast…");
      loadForecast("charts-fc-block");
    } else {
      panel.innerHTML = chartsLoading("charts-ts-block", "Loading time series…");
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

  // The dock widens the left panel to half the viewport (see style.css), keeping the map visible
  // and interactive on the right. The MapLibre canvas doesn't track sibling layout changes, so it
  // needs a resize once the panel settles. Resizing every frame of the transition instead would
  // force ~20 full GL viewport resets and a layout read apiece; the canvas is stretched by CSS in
  // the meantime, so one resize at the end is all that's needed. The timeout is a fallback for
  // when transitionend doesn't fire (panel already at its target width, reduced motion, …).
  function reflowMap(durationMs = 340) {
    const panel = $("left-panel");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      panel?.removeEventListener("transitionend", onEnd);
      map.resize();
    };
    const onEnd = (e) => {
      if (e.propertyName === "flex-basis") finish();
    };
    panel?.addEventListener("transitionend", onEnd);
    setTimeout(finish, durationMs);
  }

  function open() {
    document.body.classList.add("charts-open");
    reflowMap();
  }

  function close() {
    if (!document.body.classList.contains("charts-open")) return;
    document.body.classList.remove("charts-open");
    reflowMap();
    if (plotsLoaded) void import("rfsjs/plots").then((m) => m.clearPlots());
  }

  /** Open the dock for a clicked reach, or with no argument to reuse the last one. */
  function openForRiver(props) {
    if (props) {
      selectedRiverProps = props;
      if (props.riverId != null) selectedRiverId = Number(props.riverId);
    }
    setInspectHighlight(map, selectedRiverId);
    $("charts-modal-title").textContent =
      selectedRiverId != null ? `${t("river.heading")} ${selectedRiverId}` : t("charts.heading");
    for (const name of CHARTS_TABS) rendered[name] = false;
    activateTab("forecast");
    open();
  }

  /** Repaint live charts after a theme change; no-op if the chart bundle was never loaded. */
  function restyleCharts() {
    if (plotsLoaded) void import("rfsjs/plots").then((m) => m.restyleCharts());
  }

  /**
   * Re-render the open chart tab in the newly picked language. Chart text is drawn into a canvas,
   * so unlike the rest of the UI it cannot be retranslated in place by walking [data-i18n] — the
   * charts have to be built again. Cheap: the language chunk is cached after first use, and the
   * series comes back from the reader's own cache rather than the network.
   */
  function relocalizeCharts() {
    if (!plotsLoaded) return;
    const active = CHARTS_TABS.find((name) => $(`charts-tab-${name}`)?.classList.contains("active"));
    if (!active || active === "details") return;
    renderTab(active);
  }

  for (const name of CHARTS_TABS) $(`charts-tab-${name}`).addEventListener("click", () => activateTab(name));
  $("btn-charts").addEventListener("click", () => openForRiver());
  $("charts-close").addEventListener("click", close);

  return {openForRiver, close, restyleCharts, relocalizeCharts};
}

export {createChartsDock};
