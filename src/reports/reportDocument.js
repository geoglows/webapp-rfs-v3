/**
 * The printed document itself: the frame it lives in, its stylesheet, and the pages.
 *
 * ── Why an iframe, and why this one ──
 * A report is a *separate document*: letter-sized pages, its own typography, and a print that must
 * carry the report and nothing of the app around it. The app's own window cannot be that document
 * without a print stylesheet that hides the whole UI, so the report gets a frame of its own.
 *
 * The frame is built to be inert. Its `sandbox` grants exactly two things — `allow-same-origin`, so
 * this side can reach in and append nodes and call print(), and `allow-modals`, without which a
 * sandboxed frame is not allowed to open the print dialog. Everything else is withheld, and the one
 * that matters is `allow-scripts`: no script of any kind runs inside the report, whoever wrote it.
 * The CSP in the skeleton says the same thing a second way and closes the network besides —
 * `default-src 'none'` means the document cannot fetch, connect, frame, or load a font or a script,
 * and `img-src blob: data:` lets through exactly the chart images this module hands it.
 *
 * That is the second half of the design: **no untrusted text ever becomes markup**. The skeleton
 * below is a constant with nothing interpolated into it, the stylesheet is set as `textContent`, and
 * every page is built as DOM — `el()` writes text through `textContent` and colors through CSSOM, so
 * a river a user named `<img onerror=…>` is a river with a peculiar name and not a script. There is
 * no `document.write` and no HTML string anywhere in the pipeline.
 *
 * ── Efficiency ──
 * The frame is created once and its document is *reset* per report rather than reloaded, so a second
 * report costs no reparse of the skeleton and no re-evaluation of the stylesheet. Chart images
 * arrive as blob URLs (see reportCharts.js) rather than base64 data URIs: a `blob:` URL is a
 * reference, so the PNG is stored once by the browser instead of being inflated by a third into a
 * string, held in a page array, and copied again into the document.
 */
import {el} from "../dom.js";
import {t, tf} from "../i18n/i18n.js";

// Static, and it has to stay that way: a <meta> CSP is only honoured when the parser sees it, so
// this cannot be added afterwards through the DOM the way the stylesheet is.
const SKELETON = `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; ` +
  `style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">` +
  `</head><body><main id="report"></main></body></html>`;

/**
 * The report's stylesheet. Print sizes are in points and page geometry in inches, because that is
 * what they are — a page is 8.5×11in with 0.6in margins whatever the display it is previewed on.
 *
 * Two media, one layout. On screen each `.page` is drawn as a sheet on a grey ground so the preview
 * is the printout; in print the `@page` box supplies the margins, so the sheet loses its padding and
 * takes the exact height that is left (11in − 2 × 0.6in). Fixed height is what lets a page put its
 * notes and its footer at the bottom of the sheet rather than under the last thing on it; `.flow`
 * opts out for the one page — the summary — that is allowed to run over.
 */
const REPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #16202e;
  background: #fff;
  font-size: 10.5pt;
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1, h2, h3 { margin: 0; }
p { margin: 0; }

@page { size: letter portrait; margin: 0.6in; }

.page { break-after: page; page-break-after: always; display: flex; flex-direction: column; }
.page:last-child { break-after: auto; page-break-after: auto; }

@media screen {
  body { background: #59616e; padding: 28px 0; }
  .page {
    width: 8.5in; min-height: 11in; padding: 0.6in; margin: 0 auto 28px;
    background: #fff; box-shadow: 0 6px 22px rgba(0,0,0,.38);
  }
}
@media print {
  .page { width: auto; height: 9.8in; min-height: 0; padding: 0; margin: 0; }
  .page.flow { height: auto; }
}

/* ── cover ── */
.cover { justify-content: center; text-align: center; }
.cover-logo { display: block; width: 2.6in; margin: 0 auto 0.45in; }
.cover h1 { font-size: 28pt; letter-spacing: -0.4pt; color: #0b3d66; }
.cover .lede { margin-top: 8pt; font-size: 15pt; font-weight: 600; color: #4b5c6f; }
.meta-grid {
  display: grid; grid-template-columns: max-content 1fr; gap: 5pt 16pt;
  width: 4.4in; margin: 0.5in auto 0; text-align: left; font-size: 10pt;
  border-top: 1px solid #d5dee8; border-bottom: 1px solid #d5dee8; padding: 10pt 0;
}
.meta-grid dt { color: #5b6b7d; }
.meta-grid dd { margin: 0; font-weight: 600; }
/* The disclaimer is body text, not fine print: it is the one thing on the cover a reader is meant
   to have read before they turn the page, so it is set at reading size in the main column rather
   than shrunk into the footer with the addresses. */
.cover-disclaimer {
  margin: 0.45in auto 0; max-width: 5.6in;
  font-size: 11.5pt; line-height: 1.5; color: #33475c;
}
.cover-foot { margin-top: auto; font-size: 9pt; color: #5b6b7d; }
.cover-foot p { margin: 3pt 0; }
.cover-foot a.url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #0b3d66; text-decoration: underline; }

/* ── page furniture ── */
.page-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 14pt;
  border-bottom: 2pt solid #0b3d66; padding-bottom: 5pt; margin-bottom: 4pt;
}
.page-head h2 { font-size: 15pt; color: #0b3d66; }
.page-head .tag { font-size: 9pt; color: #5b6b7d; white-space: nowrap; }
.sub { font-size: 8.5pt; color: #5b6b7d; margin-bottom: 10pt; }
.page-foot {
  margin-top: 8pt; padding-top: 5pt; border-top: 1px solid #e3e9f0;
  display: flex; justify-content: space-between; font-size: 8pt; color: #7e8b9b;
}

/* ── figures ── */
figure { margin: 0 0 10pt; text-align: center; }
figure img { width: 100%; max-height: 4.3in; object-fit: contain; }
figcaption { margin-top: 4pt; font-size: 8.5pt; font-style: italic; color: #5b6b7d; }

/* ── tables ── */
table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
caption { caption-side: top; text-align: left; margin-bottom: 5pt; font-size: 10pt; font-weight: 700; color: #0b3d66; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #d5dee8; padding: 3pt 5pt; text-align: center; }
thead th { background: #eef3f8; font-weight: 700; }
tbody th { background: #f6f9fc; text-align: left; white-space: nowrap; font-weight: 600; }
td.name, th.name { text-align: left; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* Dark rather than the usual link blue, and unmarked: sixteen underlined names would turn the
   summary into a page of rules. It is a link, but it is a table first. */
.jump { color: #0b3d66; text-decoration: none; }

.chip {
  display: inline-block; padding: 0.5pt 6pt; border-radius: 8pt;
  font-size: 8pt; font-weight: 700; border: 1px solid rgba(0,0,0,.18);
}

/* ── bulletin ──
   A sheet with a verdict at the top. The banner is the one thing on the page that has to survive
   being read from across a desk, so it is set at heading size in the alert's own colour and given
   the full width; everything under it explains how that word was arrived at. */
.alert-banner {
  padding: 8pt 12pt; border-radius: 4px; margin-bottom: 9pt;
  color: #fff; font-size: 15pt; font-weight: 700; letter-spacing: 0.3pt; text-align: center;
}
.bulletin-stats { margin-bottom: 8pt; }
.bulletin-figures { display: flex; flex-direction: column; gap: 6pt; }
.bulletin-figures figure { margin: 0; }
/* Three figures and a verdict on one sheet. The cap is what is left of the page after the
   banner, the two readings and the stats row, so a bulletin is always exactly one page — which is
   what makes "River n of m" in the footer true. */
.bulletin-figures figure img { max-height: 2.15in; }
.bulletin-figures figcaption { margin-top: 2pt; }

/* ── notes ── */
.notes { margin-top: auto; }
.notes h3 { font-size: 10pt; color: #0b3d66; margin-bottom: 4pt; }
.notes textarea {
  display: block; width: 100%; height: 0.85in; padding: 5pt;
  font: inherit; color: inherit; background: #fff;
  border: 1px solid #b9c6d4; border-radius: 3px; resize: vertical;
}
@media print { .notes textarea { resize: none; border-color: #d5dee8; } }

.failed { color: #96201f; font-weight: 600; }
.muted { color: #5b6b7d; font-style: italic; }
`;

/**
 * The frame, and a promise for when its document exists. Nothing may be appended before that
 * resolves — `contentDocument` is the about:blank the frame starts on until the skeleton has parsed.
 */
function createReportFrame() {
  const frame = el("iframe", {
    class: "report-frame",
    title: t("report.previewTitle"),
    // allow-popups + allow-popups-to-escape-sandbox are what make the geoglows.org links on the
    // cover actually open — a popup from a sandboxed frame inherits the sandbox unless it is let
    // out, and an inherited one lands on a page that cannot run its own scripts. It is safe to give
    // here for the reason that matters: the document has no allow-scripts, so nothing inside it can
    // synthesise a navigation, and every href in it is a constant written by this module. No text
    // from the data or from a river's name ever becomes a link.
    sandbox: "allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox",
    referrerpolicy: "no-referrer",
    srcdoc: SKELETON
  });
  const ready = new Promise((resolve) => frame.addEventListener("load", () => {
    wireJumps(frame.contentDocument);
    resolve();
  }, {once: true}));
  return {frame, ready};
}

/**
 * Make the summary's links work on screen as well as on paper.
 *
 * The hrefs are `#river-3` and a browser printing to PDF turns those into internal jumps by itself,
 * which is what they are there for. In the preview they do nothing: the document was written with
 * `srcdoc`, so its URL is `about:srcdoc`, and a sandboxed frame is not allowed to navigate to an
 * `about:` URL even to move within the page it is already showing.
 *
 * So the scroll is done from this side. It is available precisely because of the frame's one
 * concession — `allow-same-origin` lets this document be reached from here — and it needs no script
 * inside the report, which still runs none. Attached once, on load: the document survives every
 * reset, so this must not be re-attached per run.
 */
function wireJumps(doc) {
  doc.addEventListener("click", (e) => {
    const link = e.target?.closest?.("a.jump");
    if (!link) return;
    e.preventDefault();
    doc.querySelector(link.getAttribute("href"))?.scrollIntoView({behavior: "smooth", block: "start"});
  });
}

/**
 * Empty the report and hand back the element pages are appended to. The stylesheet is written on
 * the first reset and left in place afterwards — it is the same stylesheet every time, and
 * re-setting it would have the frame re-parse a few kilobytes of CSS for nothing.
 */
function resetDocument(frame, {lang, title}) {
  const doc = frame.contentDocument;
  doc.documentElement.lang = lang;
  doc.title = title;
  if (!doc.getElementById("report-style")) {
    const style = doc.createElement("style");
    style.id = "report-style";
    style.textContent = REPORT_CSS;
    doc.head.appendChild(style);
  }
  const root = doc.getElementById("report");
  root.replaceChildren();
  return root;
}

// ═════════════════════════════════════════════════════════════════════════════
// Pages
// ═════════════════════════════════════════════════════════════════════════════

const dl = (rows) => el("dl", {class: "meta-grid"},
  rows.flatMap(([term, value]) => [el("dt", {text: term}), el("dd", {text: value})]));

/**
 * `label` then the address, as a real link whose text is the address.
 *
 * The text is the URL rather than a word standing for it, because this has to work in three places
 * at once: clickable in the preview, clickable in the PDF a browser prints (which carries `href`
 * through as a link annotation), and readable on paper, where there is nothing to click and a
 * "click here" would be a dead end.
 */
const source = (label, url) => el("p", {}, [
  document.createTextNode(`${label} `),
  el("a", {class: "url", href: url, target: "_blank", rel: "noopener noreferrer", text: url})
]);

function coverPage({logoUrl, appTitle, reportType, forecastDate, generatedAt, listName, riverCount}) {
  return el("section", {class: "page cover"}, [
    logoUrl && el("img", {class: "cover-logo", src: logoUrl, alt: ""}),
    el("h1", {text: appTitle}),
    el("p", {class: "lede", text: reportType}),
    dl([
      [t("report.doc.forecastDate"), forecastDate],
      [t("report.doc.list"), listName],
      [t("report.doc.rivers"), String(riverCount)],
      [t("report.doc.generated"), generatedAt]
    ]),
    el("p", {class: "cover-disclaimer", text: t("report.doc.disclaimer")}),
    el("div", {class: "cover-foot"}, [
      source(t("report.doc.source.generated"), "https://apps.geoglows.org"),
      source(t("report.doc.source.training"), "https://training.geoglows.org"),
      source(t("report.doc.source.home"), "https://geoglows.org")
    ])
  ]);
}

const pageHead = (heading, tag) => el("div", {class: "page-head"}, [
  el("h2", {text: heading}),
  tag && el("span", {class: "tag", text: tag})
]);

const pageFoot = (right) => el("div", {class: "page-foot"}, [
  el("span", {text: import.meta.env.VITE_APP_TITLE ?? ""}),
  el("span", {text: right})
]);

/**
 * The triage page: every river in the report on one line, worst level it is forecast to exceed and
 * how likely that is. Built last — it is a digest of the pages that follow it — and swapped into the
 * placeholder the generator left for it, so it still prints second.
 *
 * Each name links to that river's own page. Same-document links, which a browser printing to PDF
 * carries through as internal jumps, so the summary is a table of contents in the file and not only
 * on screen. A report with no per-river pages (the summary-only type) passes no href and the names
 * are plain text — a link to a page that was never printed is worse than no link.
 */
function summaryPage(rows) {
  const body = el("tbody", {}, rows.map((r) => {
    const chip = r.worst
      ? el("span", {class: "chip", text: r.worst.label})
      : el("span", {class: "muted", text: t("report.doc.none")});
    if (r.worst) chip.style.backgroundColor = r.worst.tint;
    return el("tr", {}, [
      el("td", {text: String(r.n)}),
      el("td", {class: "name"}, r.href ? el("a", {class: "jump", href: r.href, text: r.name}) : document.createTextNode(r.name)),
      el("td", {class: "id", text: String(r.riverId)}),
      el("td", {class: "num", text: r.peak}),
      el("td", {}, chip),
      el("td", {class: "num", text: r.worst ? r.worst.chance : "—"})
    ]);
  }));
  return el("section", {class: "page flow"}, [
    pageHead(t("report.doc.summary"), null),
    el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", {text: t("report.doc.col.n")}),
        el("th", {class: "name", text: t("report.doc.col.river")}),
        el("th", {text: t("report.doc.col.id")}),
        el("th", {text: t("report.doc.col.peak")}),
        el("th", {text: t("report.doc.col.level")}),
        el("th", {text: t("report.doc.col.chance")})
      ])),
      body
    ]),
    pageFoot(t("report.doc.summary"))
  ]);
}

/**
 * The exceedance table: one column per forecast day, one row per return period, each cell the share
 * of ensemble members whose daily maximum passes that threshold.
 *
 * Every number and every colour in it was computed by v3/discharge/exceedance.js — this lays them
 * out and does nothing else, which is what keeps the table and the figure above it in one palette.
 */
function exceedanceTable(table, {days}) {
  const body = el("tbody", {}, table.rows.map((row) => el("tr", {}, [
    el("th", {scope: "row", text: `${tf("report.doc.years", {n: row.key})} · ${row.valueText}`}),
    ...row.probs.map((p, i) => {
      const cell = el("td", {text: `${Math.round(p * 100)}%`});
      // Through CSSOM rather than as a `style` attribute: a colour computed per cell is data, and
      // this keeps it out of markup.
      if (row.tints[i]) cell.style.backgroundColor = row.tints[i];
      return cell;
    })
  ])));
  return el("table", {}, [
    el("caption", {text: t("report.doc.table.title")}),
    el("thead", {}, el("tr", {}, [
      el("th", {class: "name", text: t("report.doc.table.level")}),
      ...days.map((d) => el("th", {text: d}))
    ])),
    body
  ]);
}

/**
 * One river, one sheet: the hydrograph, the exceedance table under it, and a notes box at the foot
 * of the page for whoever prints this and writes on it.
 */
function riverPage({n, total, name, riverId, coords, figureNumber, imageUrl, table, days, error}) {
  const content = error != null
    ? [el("p", {class: "failed", text: t("report.doc.error")}), el("p", {class: "muted", text: error})]
    : [
      el("figure", {}, [
        el("img", {src: imageUrl, alt: tf("report.doc.figure", {n: figureNumber, id: riverId})}),
        el("figcaption", {text: tf("report.doc.figure", {n: figureNumber, id: riverId})})
      ]),
      table
        ? exceedanceTable(table, {days})
        : el("p", {class: "muted", text: t("report.doc.table.none")})
    ];
  return el("section", {class: "page", id: `river-${n}`}, [
    pageHead(name, tf("report.doc.riverId", {id: riverId})),
    coords && el("p", {class: "sub", text: coords}),
    ...content,
    el("div", {class: "notes"}, [
      el("h3", {text: t("report.doc.notes")}),
      el("textarea", {rows: "4", "aria-label": t("report.doc.notes")})
    ]),
    pageFoot(tf("report.doc.riverN", {n, total}))
  ]);
}


/**
 * The flood bulletin: one reach, one sheet, headed by the alert it earned.
 *
 * The order is the argument. The verdict first, then the numbers behind it, then the figures that
 * show the same thing three ways — the ensemble against its thresholds, how much of the ensemble is
 * over each one through time, and how far the whole forecast sits from what this river normally
 * does at this time of year. A reader who stops after the banner has the answer; a reader who does
 * not can check it.
 *
 * One coloured band, and only one. The verdict is taken from two readings of the forecast (see
 * alerts.js), but printing each of them in its own coloured box put three colours on a page whose
 * whole job is to carry one — a reader scanning a stack of these has to be able to tell a red sheet
 * from a green one at arm's length, and a red banner over two amber boxes is not that.
 *
 * Every value here was computed by v3/discharge/alerts.js and climatology.js. `alert` arrives
 * already worded by the caller, which is the only part that is this app's: the package says which
 * band, and the app says it in the reader's language.
 */
function bulletinPage({n, total, name, riverId, coords, alert, stats, figures, error}) {
  if (error != null) {
    return el("section", {class: "page", id: `river-${n}`}, [
      pageHead(name, tf("report.doc.riverId", {id: riverId})),
      coords && el("p", {class: "sub", text: coords}),
      el("p", {class: "failed", text: t("report.doc.error")}),
      el("p", {class: "muted", text: error}),
      pageFoot(tf("report.doc.riverN", {n, total}))
    ]);
  }

  const banner = el("div", {class: "alert-banner", text: alert.text});
  banner.style.backgroundColor = alert.color;

  return el("section", {class: "page", id: `river-${n}`}, [
    pageHead(name, tf("report.doc.riverId", {id: riverId})),
    coords && el("p", {class: "sub", text: coords}),
    banner,
    el("table", {class: "bulletin-stats"}, [
      el("thead", {}, el("tr", {}, stats.map((c) => el("th", {text: c.label})))),
      el("tbody", {}, el("tr", {}, stats.map((c) => el("td", {class: "num", text: c.value}))))
    ]),
    el("div", {class: "bulletin-figures"}, figures.map((f) => el("figure", {}, [
      el("img", {src: f.imageUrl, alt: f.caption}),
      el("figcaption", {text: f.caption})
    ]))),
    pageFoot(tf("report.doc.riverN", {n, total}))
  ]);
}

export {bulletinPage, coverPage, createReportFrame, resetDocument, riverPage, summaryPage};
