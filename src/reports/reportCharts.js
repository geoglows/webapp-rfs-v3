/**
 * The report's figures: the same forecast hydrograph the charts dock draws, rendered off screen at
 * print size and handed back as a PNG.
 *
 * ── One host, reused ──
 * A chart is a canvas, so the only way to get a picture of one is to draw it somewhere. This draws
 * every figure into a single fixed-size host parked off the left edge of the window and takes the
 * image before moving on, rather than building a container per river: the report is a hundred
 * pages, not a hundred charts, and there is no reason for more than one to exist at a time.
 *
 * The host carries the light chart palette regardless of the app's theme, because the palette is
 * read from CSS custom properties on the element the charts render into (see refreshChartTheme in
 * the charting package). A report is printed on white paper; a dark-theme figure on it is a black
 * rectangle that empties a toner cartridge.
 *
 * ── Blobs, not data URIs ──
 * `canvas.toBlob` rather than `toDataURL`: the PNG stays a binary blob the browser owns and the
 * document holds a reference to it, instead of a base64 string a third larger than the image that
 * has to be held in an array, copied into the document, and parsed back out again. Every URL handed
 * out is the caller's to revoke — see `revoke` below and the generator's reset.
 *
 * ── One caveat, handled by the caller ──
 * The charting package keeps its live charts in module state, and rendering a forecast destroys the
 * previous one — including the charts dock's, if it is open behind the modal. That is why the
 * generator takes an `onFinished` and main.js points it at the dock's repaint.
 */
import {getLanguage} from "../i18n/i18n.js";
import {getSetting} from "../settings/settings.js";

// The figure is printed about 7in wide. At 1200 CSS px that is ~170 dpi on a plain display and
// twice that where the device pixel ratio is 2 — sharp in print without a canvas so large that
// encoding it becomes the slow part of the report.
const WIDTH = 1200;
const HEIGHT = 660;


/**
 * The three things a figure on a page wants that a figure in a dock does not.
 *
 * The chart is reached through Chart.js's own registry rather than returned by the charting package,
 * which renders into an element and keeps its instances to itself. chart.js is this app's dependency
 * as much as the package's and resolves to one module either way, so the registry is the same one;
 * if it ever is not, `getChart` answers undefined and the figure is simply left as drawn.
 *
 *  · No title. The page already carries the river's name in its heading and again in the caption,
 *    and a third copy inside the frame is the kind of repetition a printed report is judged on.
 *  · No struck-through legend entries. A warning level the forecast does not approach comes up
 *    hidden, which on screen is an invitation to click it and on paper is a crossed-out line with
 *    no explanation anywhere near it.
 *  · Legend underneath. On screen it sits to the right, where it costs a quarter of the width; a
 *    figure that is 7in wide and 4in tall would rather spend that on the hydrograph.
 */
async function forPrint(canvas) {
  const {Chart} = await import("chart.js");
  const chart = Chart.getChart(canvas);
  if (!chart) return;
  const plugins = chart.options.plugins;
  plugins.title.display = false;
  plugins.legend.position = "bottom";
  plugins.legend.labels.filter = (item) => !item.hidden && !item.text.startsWith("_");
  chart.update("none");
}

function createChartRenderer() {
  const host = document.createElement("div");
  host.className = "report-chart-host";
  host.setAttribute("aria-hidden", "true");
  host.style.width = `${WIDTH}px`;
  host.style.height = `${HEIGHT}px`;
  // The inner .chart-canvas is sized by the app stylesheet for the dock; report.css reads
  // this back so the figure fills the host instead.
  host.style.setProperty("--report-chart-height", `${HEIGHT}px`);
  document.body.appendChild(host);

  let plots = null;
  const issued = [];

  /** The hydrograph for one reach as a `blob:` URL. */
  async function render({forecast, returnPeriods}) {
    plots ??= await import("riverforecastsystem/v3/plots");
    await plots.plotAllForecast(host, forecast, {
      lang: getLanguage(),
      returnPeriods,
      levelsAs: getSetting("shadedWarningLevels") ? "boxes" : "lines"
    });
    return capture();
  }

  /** Whatever was last drawn into the host, tuned for print and encoded. */
  async function capture() {
    const canvas = host.querySelector("canvas");
    if (!canvas) throw new Error("the chart did not render");
    await forPrint(canvas);
    const url = await new Promise((ok, fail) => canvas.toBlob(
      (blob) => (blob ? ok(URL.createObjectURL(blob)) : fail(new Error("the figure could not be encoded"))),
      "image/png"
    ));
    issued.push(url);
    return url;
  }

  /** The share of the ensemble over each threshold through the forecast, as a `blob:` URL. */
  async function renderExceedance(series) {
    plots ??= await import("riverforecastsystem/v3/plots");
    await plots.plotExceedanceProbabilities(host, series, {lang: getLanguage()});
    return capture();
  }

  /** The forecast's departure from the reach's own normal for the time of year, as a `blob:` URL. */
  async function renderAnomaly(anomaly) {
    plots ??= await import("riverforecastsystem/v3/plots");
    await plots.plotFlowAnomaly(host, anomaly, {lang: getLanguage()});
    return capture();
  }

  /** Hand back every URL this renderer created. Safe to call once the document no longer shows them. */
  function revoke() {
    for (const url of issued.splice(0)) URL.revokeObjectURL(url);
  }

  /** Drop the live chart and the host. The URLs already handed out stay valid until `revoke`. */
  function destroy() {
    plots?.clearPlots();
    host.remove();
  }

  return {render, renderExceedance, renderAnomaly, revoke, destroy};
}

export {createChartRenderer};
