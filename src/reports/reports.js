/**
 * The Reports dialog: pick a list of rivers and a forecast date, and get a printable document.
 *
 * A modal rather than a dock. Everything in the left column is something you keep open while you
 * work the map; a report is the opposite — it takes the whole screen for as long as you are reading
 * it and then goes away, and the preview needs a page's width to be a preview of a page at all.
 *
 * Nothing here reads data or derives anything from it. The reaches come from the app's own lists,
 * and everything after that is the package's: `forecastsForRivers` downloads them in list order
 * behind a bounded pool, and `dailyExceedance`/`worstExceedance` turn each ensemble into the numbers
 * a page shows. What is left in this file is the part that is genuinely this app's — which list, in
 * which language, laid out as which pages.
 *
 * The two meters are the two things that take time and they are deliberately different numbers:
 * `onProgress` counts downloads finishing, the loop counts pages built. Pages are appended to the
 * frame as they are made, so the preview fills in under the reader rather than appearing all at
 * once at the end — and so the report never holds more than a few raw ensembles at a time.
 */
import {$, el} from "../dom.js";
import {getLanguage, t, tf} from "../i18n/i18n.js";
import {listSavedRivers} from "../account/savedRivers.js";
import {defaultBookmarks} from "../docks/bookmarks.js";
import {bulletinPage, coverPage, createReportFrame, resetDocument, riverPage, summaryPage} from "./reportDocument.js";
import {createChartRenderer} from "./reportCharts.js";
import {storeRow} from "../data/demoIndex.js";
import {forecastWithLevels, retrospective} from "../data/timeseries.js";

const LISTS = {
  saved: {label: "report.list.saved", rivers: () => listSavedRivers()},
  notable: {label: "report.list.notable", rivers: () => defaultBookmarks.map((b) => ({...b}))}
};

/**
 * What a report contains.
 *
 * Two reports, not four. Every report is already a summary page followed by the pages that support
 * it, so "just the summary" is not a second report — it is the first page of the one you asked for,
 * and offering it separately would be two entries for one thing in both directions: a daily report
 * with and without its hydrographs, a flood report with and without its bulletins.
 *
 * Both start from the same reaches and the same reads; they differ in which of them earn a page and
 * what goes on it — which is also what they cost, since the figures are the slow part of a run.
 *
 * Every reach in the chosen list gets a page in both. A flood bulletin is not only a list of the
 * rivers that are in trouble — "nothing is forecast to exceed a warning level here" is a finding,
 * and it is one somebody has to be able to point at a page and show. Dropping the quiet reaches
 * would also make the report's own length the alarm, so a run with nothing to report would be a
 * blank where a reader expects a record.
 *
 *   page   what a reach's own sheet is
 *   retro  the bulletin reads each reach against its own record, which is the largest read here and
 *          is asked for by nothing else
 */
const TYPES = {
  full: {label: "report.type.full", page: "forecast"},
  flood: {label: "report.type.flood", page: "bulletin", retro: true}
};

/**
 * The logo, fetched once and kept as a blob for the life of the session.
 *
 * Fetched rather than referenced by URL because the report's CSP admits `blob:` and `data:` images
 * and nothing else — the document is not allowed to reach the network at all, which is the point.
 * The content type is checked before it is used: what goes into the report is an image this side
 * has looked at, not whatever a URL happened to answer with.
 */
let logoPromise = null;
const logoUrl = () => (logoPromise ??= (async () => {
  const src = import.meta.env.VITE_LOGO_SRC;
  if (!src) return null;
  try {
    const res = await fetch(src, {credentials: "omit", referrerPolicy: "no-referrer"});
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
})());

const pct = (fraction) => `${Math.round(fraction * 100)}%`;


/**
 * One reach's bulletin: the package takes the readings, this puts them into words and pictures.
 *
 * The split is the same one the rest of this file keeps to. Which band the reach is in, how much of
 * the ensemble crosses which threshold and when, and how far the forecast sits from the river's own
 * normal are all v3/discharge's — nothing here recomputes any of it. What is added is the sentence
 * a reader sees, in their language, and the three figures, drawn by v3/plots.
 *
 * The anomaly figure is conditional on the record having been readable for this reach: a bulletin
 * without it is still a bulletin, and a chart of a river's departure from a normal that could not
 * be loaded would be a chart of nothing.
 */
async function buildBulletin({head, forecast, returnPeriods, retrospective, charts, lang, day}) {
  const {
    classifyByEnsemble, classifyByMedian, dayOfYearMeans, exceedanceOverTime, flowAnomaly,
    formatLevelValue, worstAlert
  } = await import("riverforecastsystem/v3/discharge");

  const series = exceedanceOverTime({forecast, levels: returnPeriods});
  const ensemble = classifyByEnsemble(series);
  const median = classifyByMedian({forecast, levels: returnPeriods});
  const overall = worstAlert(ensemble, median);

  const anomaly = retrospective
    ? flowAnomaly({forecast, climatology: dayOfYearMeans(retrospective)})
    : null;

  const figures = [
    {
      imageUrl: await charts.render({forecast, returnPeriods}),
      caption: tf("report.doc.figure", {n: head.n, id: head.riverId})
    },
    series && {
      imageUrl: await charts.renderExceedance(series),
      caption: t("report.doc.fig.exceedance")
    },
    anomaly && {
      imageUrl: await charts.renderAnomaly(anomaly),
      caption: t("report.doc.fig.anomaly")
    }
  ].filter(Boolean);

  const peak = forecast.stats?.peak;
  const mean = forecast.stats?.average?.length
    ? forecast.stats.average.reduce((a, b) => a + b, 0) / forecast.stats.average.length
    : NaN;
  const lowest = series?.rows?.[0];
  const highest = series?.rows?.[series.rows.length - 1];
  const stats = [
    {label: t("report.doc.stat.peak"), value: Number.isFinite(peak) ? formatLevelValue(peak) : "—"},
    {label: t("report.doc.stat.mean"), value: Number.isFinite(mean) ? formatLevelValue(mean) : "—"},
    lowest && {label: tf("report.doc.years", {n: lowest.key}), value: lowest.valueText},
    highest && highest !== lowest && {label: tf("report.doc.years", {n: highest.key}), value: highest.valueText}
  ].filter(Boolean);

  return bulletinPage({
    ...head,
    alert: {text: `${t("report.doc.alert")}: ${t(`report.alert.${overall.band}`)}`, color: overall.color},
    stats,
    figures
  });
}

/**
 * @param getForecastDate what the app's own date picker is showing, used as the default here
 * @param onFinished called when a run ends, however it ends — the charts dock repaints itself,
 *   because rendering the report's figures destroyed whatever chart it had on screen
 */
function createReportModal({getForecastDate, onFinished} = {}) {
  const modal = $("report-modal");
  if (!modal) return null;

  const typeSelect = $("report-type");
  const listSelect = $("report-list");
  const dateInput = $("report-date");
  const generateBtn = $("report-generate");
  const cancelBtn = $("report-cancel");
  const printBtn = $("report-print");
  const clearBtn = $("report-clear");
  const meters = $("report-progress");
  const status = $("report-status");
  const preview = $("report-preview");

  const {frame, ready} = createReportFrame();
  preview.appendChild(frame);

  let abort = null;
  let running = false;
  // The previous run's blob URLs, revoked only once the document has stopped showing them.
  let revokeLast = null;

  const say = (message) => {
    status.textContent = message ?? "";
    status.hidden = !message;
  };

  const setMeter = (which, fraction) => {
    $(`report-${which}-progress`).value = Math.round(fraction * 100);
    $(`report-${which}-pct`).textContent = pct(fraction);
  };

  function setBusy(busy) {
    running = busy;
    generateBtn.disabled = busy;
    typeSelect.disabled = busy;
    listSelect.disabled = busy;
    dateInput.disabled = busy;
    cancelBtn.disabled = !busy;
  }

  // ── the run ────────────────────────────────────────────────────────────────
  async function generate() {
    const type = TYPES[typeSelect.value] ?? TYPES.full;
    const key = listSelect.value in LISTS ? listSelect.value : "saved";
    // riverIndex is left undefined rather than null where a saved river predates it being captured:
    // the readers take undefined to mean "find it from the id" and null to mean row null.
    const rivers = LISTS[key].rivers()
      .filter((r) => Number.isFinite(Number(r.riverId)))
      .map((r) => ({...r, riverId: Number(r.riverId), riverIndex: storeRow(r.riverIndex ?? undefined)}));
    if (!rivers.length) {
      say(t("report.empty"));
      return;
    }
    const date = dateInput.value || getForecastDate?.() || "";
    if (!date) {
      say(t("report.noDate"));
      return;
    }

    say(null);
    setBusy(true);
    printBtn.disabled = true;
    clearBtn.disabled = true;
    meters.hidden = false;
    setMeter("data", 0);
    setMeter("pages", 0);

    const controller = (abort = new AbortController());
    const {signal} = controller;
    const charts = createChartRenderer();
    const lang = getLanguage();
    const day = (d) => d.toLocaleDateString(lang, {month: "short", day: "numeric", timeZone: "UTC"});

    try {
      const {dailyExceedance, forecastsForRivers, formatLevelValue, worstExceedance} =
        await import("riverforecastsystem/v3/discharge");
      // The alert wording is this app's; the readings behind it are not — see buildBulletin below.

      await ready;
      const root = resetDocument(frame, {lang, title: import.meta.env.VITE_APP_TITLE ?? "Report"});
      // Only now that the document no longer references them.
      revokeLast?.();
      revokeLast = charts.revoke;

      root.append(coverPage({
        logoUrl: await logoUrl(),
        appTitle: import.meta.env.VITE_APP_TITLE ?? "",
        reportType: t(type.label),
        forecastDate: date,
        listName: t(LISTS[key].label),
        riverCount: rivers.length,
        generatedAt: new Date().toLocaleString(lang)
      }));
      // The summary is a digest of the pages after it, so it is written last and dropped in here.
      const summarySlot = el("div");
      root.append(summarySlot);

      const summaryRows = [];
      // The pool, the ordering and the per-reach failure rule stay the package's; only the two
      // reads it makes are this app's, so a river already on the device is not downloaded again —
      // for a report re-run, or for one the charts dock has already been pointed at.
      for await (const {index, river, forecast, returnPeriods, retrospective: retro, error} of forecastsForRivers({
        date,
        rivers,
        withRetrospective: Boolean(type.retro),
        signal,
        onProgress: ({done, total}) => setMeter("data", done / total),
        read: {forecastWithLevels, retrospective}
      })) {
        if (signal.aborted) return;
        const n = index + 1;
        const name = river.name?.trim() || tf("report.doc.unnamed", {id: river.riverId});
        const coords = Number.isFinite(river.lat) && Number.isFinite(river.lon)
          ? tf("report.doc.coords", {lat: river.lat.toFixed(4), lon: river.lon.toFixed(4)})
          : null;
        const step = () => setMeter("pages", n / rivers.length);

        if (error || !forecast) {
          summaryRows.push({n, name, riverId: river.riverId, peak: "—", worst: null});
          root.append((type.page === "bulletin" ? bulletinPage : riverPage)(
            {n, total: rivers.length, name, riverId: river.riverId, coords, error: error?.message ?? ""}));
          step();
          continue;
        }

        const table = dailyExceedance({forecast, levels: returnPeriods});
        const worst = worstExceedance(table);
        const peak = forecast.stats?.peak;
        const row = {
          n,
          name,
          riverId: river.riverId,
          peak: Number.isFinite(peak) ? formatLevelValue(peak) : "—",
          worst: worst && {
            label: tf("report.doc.years", {n: worst.level.key}),
            chance: pct(worst.chance),
            tint: worst.level.color
          }
        };
        summaryRows.push(row);

        row.href = `#river-${n}`;
        const head = {n, total: rivers.length, name, riverId: river.riverId, coords};

        if (type.page === "bulletin") {
          root.append(await buildBulletin({head, forecast, returnPeriods, retrospective: retro, charts, lang, day}));
        } else {
          const imageUrl = await charts.render({forecast, returnPeriods});
          if (signal.aborted) return;
          root.append(riverPage({...head, figureNumber: n, imageUrl, table, days: (table?.days ?? []).map(day)}));
        }
        if (signal.aborted) return;
        step();
      }

      summarySlot.replaceWith(summaryPage(summaryRows));
      printBtn.disabled = false;
      clearBtn.disabled = false;
    } catch (e) {
      if (!signal.aborted) say(tf("report.failed", {message: e.message}));
    } finally {
      charts.destroy();
      if (!signal.aborted) setBusy(false);
      onFinished?.();
    }
  }

  function cancel() {
    abort?.abort();
    setBusy(false);
    meters.hidden = true;
  }

  /**
   * Empty the preview.
   *
   * For a report that is finished with, and for one that failed part way and left a half-built
   * document on screen — a stack of pages that stops in the middle is worse than an empty frame,
   * because it looks like a report. The blobs go with it, since nothing is showing them any more.
   */
  function clear() {
    if (running) cancel();
    resetDocument(frame, {lang: getLanguage(), title: import.meta.env.VITE_APP_TITLE ?? "Report"});
    revokeLast?.();
    revokeLast = null;
    printBtn.disabled = true;
    clearBtn.disabled = true;
    meters.hidden = true;
    say(null);
  }

  /** Focus first: a sandboxed frame that has never been focused prints the page around it. */
  function print() {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  }

  function open() {
    modal.classList.remove("hidden");
    if (!dateInput.value) dateInput.value = getForecastDate?.() ?? "";
  }

  $("btn-reports")?.addEventListener("click", open);
  // The ✕ is closed by wireModals; a run behind it still has to be told to stop.
  modal.querySelector("[data-close]")?.addEventListener("click", () => running && cancel());
  generateBtn.addEventListener("click", () => void generate());
  cancelBtn.addEventListener("click", cancel);
  printBtn.addEventListener("click", print);
  clearBtn.addEventListener("click", clear);
  // Closing mid-run would leave the pool writing pages into a document nobody is looking at.
  modal.addEventListener("click", (e) => {
    if (e.target === modal && running) cancel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && running) cancel();
  });

  return {open};
}

export {createReportModal};
