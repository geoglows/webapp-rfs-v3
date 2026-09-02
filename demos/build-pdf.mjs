/**
 * Builds the stills PDF: one page per shot — the still, the on-screen caption, and a few
 * points about the feature.
 *
 *   node build-pdf.mjs        → stills.pdf
 *
 * Pages whose still has not been captured yet render a marked placeholder rather than being
 * dropped, so the running order stays readable while the gaps are obvious.
 */

import {chromium} from "playwright";
import {existsSync, writeFileSync} from "node:fs";

const STILLS = "stills";

// section · a divider page. shot · a still, its caption and its points.
const PAGES = [
  {
    title: "Title", scene: "open", still: "title.png",
    caption: ["GEOGLOWS River Forecast System",
      "A global river network, explored and subset entirely in the browser"],
    points: [
      "Opens over the whole global network at zoom 2.4",
      "Dark theme, Standard stream style, forecast legend off",
      "Card holds about three and a half seconds"
    ]
  },
  {
    title: "The global network", scene: "open", still: "network-continental.png",
    caption: ["4.7 million river reaches",
      "The whole global network, served as vector tiles straight to the page"],
    points: [
      "PMTiles read directly by the browser — nothing rendered server-side",
      "Flies from the globe into the Amazon basin at zoom 4.2",
      "The network is the product; this is the shot that says how much of it there is"
    ]
  },
  {
    title: "Detail by Strahler order", scene: "open", still: "network-headwaters.png",
    caption: ["Detail arrives as you go in",
      "Reaches are published by Strahler order — zoom, and the smaller streams appear"],
    points: [
      "Order ladder: zoom 0 shows order 7+, zoom 5 → 6+, zoom 7 → 4+, zoom 9 → 2+",
      "Two further zooms, to 7.6 and then 9.8, in the Peruvian headwaters",
      "The same ladder is why later selection scenes have to sit at zoom 9.3"
    ]
  },
  {
    title: "The help dock", scene: "help", still: "help-open.png",
    caption: ["Every control explains itself",
      "The help panel docks beside the map, not over it"],
    points: [
      "The panel's own sections step aside for it; the map stays on screen",
      "You can try what the text describes while the text is still up",
      "A ? beside each section heading opens the dock at that topic"
    ]
  },
  {
    title: "Help spotlight", scene: "help", still: "help-spotlight.png",
    caption: ["Hover a passage and it lights up the control",
      "The text points at the real button, wherever it lives on the page"],
    points: [
      "Each passage carries the selector of the control it describes",
      "Panel sections are cloned live into the dock, so a control it displaced still highlights",
      "Three hovers in the cut: language, layer picker, map legend"
    ]
  },
  {
    title: "Keyboard shortcuts", scene: "help", still: "help-shortcuts.png",
    caption: ["Keyboard shortcuts for every selection method"],
    points: [
      "Alt + 1 to 5 switch between the five selection methods",
      "Shift + click collects a watershed without leaving the method you are in",
      "Space and the arrow keys drive the forecast timeseries player"
    ]
  },
  {
    title: "Reference layers", status: "dropped", scene: "layers", still: "layers-reference.png",
    caption: ["Reference geography, on demand",
      "Catchments, basins and publication groups ride along with the network"],
    points: [
      "Catchments, HydroBASINS level 2, and the v3 publication groups",
      "Move the pointer over the map and the region under it draws itself",
      "Satellite flood products (RIVER-FLD, GOES, VIIRS) are in the same menu"
    ]
  },
  {
    title: "Basemaps", status: "dropped", scene: "layers", still: "layers-basemap.png",
    caption: ["Nine basemaps under it"],
    points: [
      "Esri Living Atlas, USGS National Map, OpenStreetMap, OpenTopo",
      "Scene switches to imagery, then puts the default back before it ends",
      "Imagery is the point of this scene and noise in every scene after it"
    ]
  },
  {
    title: "Search by name", scene: "search", still: "search-typeahead.png",
    caption: ["Find a river by name",
      "The names table is searched on the device, as you type"],
    points: [
      "Three rivers called Colorado, on three continents, told apart by country",
      "A tributary says what it flows into — Little Colorado, flows into the Colorado",
      "No request per keystroke; a second field searches the 4.7 M ID lookup"
    ]
  },
  {
    title: "The Colorado", scene: "search", still: "search-colorado.png",
    caption: ["The whole river lights up, and the camera frames it",
      "Not the reach at the mouth — the published extent of the named river"],
    points: [
      "31,726 upstream reaches lit across Utah, Arizona, Nevada and Colorado",
      "Listed as \u201cColorado \u00b7 Mexico\u201d — the names table labels a river by its outlet",
      "Camera fits the river's published bounding box rather than flying to a point"
    ]
  },
  {
    title: "The Amazon", scene: "search", still: "search-amazon.png",
    caption: ["Amazon \u00b7 Brazil"],
    points: [
      "Same gesture, a continent's worth of river",
      "The highlight spans every reach the names table gives that river"
    ]
  },
  {
    title: "The Nile", scene: "search", still: "search-nile.png",
    caption: ["Nile \u00b7 Egypt"],
    points: [
      "The search also offers the White Nile and Blue Nile, each marked as flowing into it",
      "Framed from the delta to the headwaters in one move"
    ]
  },
  {
    title: "The Mekong", scene: "search", still: "search-mekong.png",
    caption: ["Mekong \u00b7 Vietnam"],
    points: [
      "Fourth in the run, and the one that closes the sequence",
      "Four rivers, four continents, about eight seconds each"
    ]
  },
  {
    title: "Reach attributes", scene: "attributes", still: "attributes.png",
    caption: ["River Select: one click, one reach",
      "Every reach carries its own attributes, read straight out of the tile"],
    points: [
      "Strahler order, Shreve order, upstream reach count",
      "Own catchment area, downstream contributing area, TDX-Hydro region",
      "River Select rather than Data Browser, so no charts open over it"
    ]
  },
  {
    title: "Watershed Select", scene: "selection", still: "select-watershed.png",
    caption: ["Watershed Select: the reach and everything above it",
      "1,373 streams selected upstream"],
    points: [
      "Reports the outlet, the riverIndex run it covers, and its catchment area",
      "Everything upstream of a reach is one contiguous run of riverIndex — hence the speed",
      "Copy sends the outlet IDs to the clipboard, one per line"
    ]
  },
  {
    title: "The whole upstream area", scene: "selection", still: null,
    caption: ["Pull back and the whole upstream area is lit",
      "Every reach that drains to the one reach that was clicked"],
    points: [
      "The scene zooms out after the click — at the working zoom the selection runs off every edge",
      "Bounded by the publication ladder, not the camera: past zoom 7 the tiles stop drawing order 4",
      "Zoom 7.6 is about the limit for this basin; a larger watershed could go further out"
    ]
  },
  {
    title: "Multi Select", scene: "selection", still: "select-multi.png",
    caption: ["Multi Select: collect watersheds as you go",
      "Each one keeps its own outlet, reach count and colour"],
    points: [
      "Shift + click collects one without leaving the method you are in",
      "Every pick gets a zoom-to and a remove control on its row",
      "The collection is the one selection that survives a reload"
    ]
  },
  {
    title: "Confirm before clearing", scene: "selection", still: "select-confirm.png",
    caption: ["A collection is real work, so it asks before clearing it"],
    points: [
      "Only Multi Select asks — the other methods hold nothing of their own",
      "Small beat, but it is what says the collection is not scratch"
    ]
  },
  {
    title: "AOI Subsetter", scene: "selection", still: "select-aoi.png",
    caption: ["AOI Subsetter: a watershed, minus what drains in from above",
      "Click the outlet, then click each inlet to cut it and its upstream away"],
    points: [
      "Adopts a watershed already selected as its outlet",
      "Each inlet removes itself and everything draining to it",
      "For when the ground above an inlet is a reservoir, a gauge, or somebody else's model"
    ]
  },
  {
    title: "GeoParquet export", status: "dropped", scene: "export", still: "export-progress.png",
    caption: ["Download the selection as GeoParquet",
      "Streams and catchments, cut out of the global archives in the browser"],
    points: [
      "Two files per run — the stream lines, then their catchment polygons",
      "No server-side clip: the subsetting happens on the device, in a worker",
      "Named for the group and outlet, e.g. rfs_v3_group704_720215601_streams.parquet"
    ]
  },
  {
    title: "What the export actually does", status: "dropped", scene: "export", still: "export-stages.png",
    caption: ["Only the row groups that hold the selection are fetched",
      "Index read, geometry pruned, decoded, re-encoded and written — client side"],
    points: [
      "Reads the file index, then fetches 3 of 90 row groups — 0.7 MB, not the archive",
      "Seven reported phases per dataset: index, geometry, prepare, prune, decode, encode, write",
      "About twenty seconds for a 933-reach selection"
    ]
  },
  {
    title: "Notable rivers", scene: "bookmarks", still: "bookmarks-notable.png",
    caption: ["A reference list of notable rivers",
      "Sixteen of the world's major rivers, ready to jump to"],
    points: [
      "River ID, name, and outlet coordinate on every row",
      "Each row can open the charts or locate the river on the map",
      "The same table renders your own saved list, so the two read alike"
    ]
  },
  {
    title: "Locate", scene: "bookmarks", still: "bookmarks-locate.png",
    caption: ["Jump the map straight to one"],
    points: [
      "Flies to the river's outlet without changing how far in you were",
      "The still is the Nile at its delta",
      "The camera position lives in the URL hash, so the view is a shareable link"
    ]
  },
  {
    title: "Save a river", scene: "bookmarks", still: "save-river.png",
    caption: ["Save any reach of your own"],
    points: [
      "The heart sits in the charts dock header; you give the river your own name",
      "Scene stays on the Details tab — attributes, not the forecast charts",
      "Saved whole: id, position on the data axis, and where it is"
    ]
  },
  {
    title: "Saved rivers", scene: "bookmarks", still: "bookmarks-saved.png",
    caption: ["Saved rivers get their own list, and an outline on the map"],
    points: [
      "Up to a hundred, sortable by ID or name",
      "Outlined on the map wherever they appear — a display setting you can turn off",
      "Kept on the device until you sign in"
    ]
  },
  {
    title: "Accounts", status: "dropped", scene: "account", still: "account-signin.png",
    caption: ["Sign in and your saved rivers follow you",
      "Bookmarks and preferences sync to the account, not to the browser"],
    points: [
      "Google, GitHub, or an email address",
      "Every device signed into the account sees the same saved rivers",
      "Signing in replaces the device's anonymous list rather than merging into it"
    ]
  },
  {
    title: "Theme", scene: "appearance", still: "appearance-light.png",
    caption: ["Light and dark"],
    points: [
      "Toggles the whole interface, including the chart palettes",
      "Rides the profile, so it follows the account across devices"
    ]
  },
  {
    title: "Language", scene: "appearance", still: "appearance-language.png",
    caption: ["English, Spanish and French",
      "Down to the chart axis titles"],
    points: [
      "Every label, tooltip and readout, not just the menus",
      "Charts are re-rendered on the switch because their text is drawn into a canvas"
    ]
  },
  {
    title: "Outro", scene: "close", still: "outro.png",
    caption: ["River Forecast System v3",
      "Forecasts, retrospective records and flood inundation mapping are next"],
    points: [
      "Flies back out to the globe before the card",
      "Names what is coming, so the absence of the forecast half reads as deliberate"
    ]
  },


  {
    title: "Forecast maps", scene: "held", status: "held", still: "held-01-forecast-maxflow.png",
    caption: ["Forecasted Max Flows"],
    points: [
      "Every reach coloured by the return period its forecast peak reaches",
      "The single most striking frame in the product: a whole basin going orange to red",
      "Three more stylesets behind the same picker: Time to Peak, Below Q95, and the animation"
    ]
  },
  {
    title: "15-day timeseries player", scene: "held", status: "held", still: "held-02-forecast-player.png",
    caption: ["15 Day Forecast Timeseries"],
    points: [
      "81 timesteps, with play/pause, a speed control, and Space / arrow shortcuts",
      "Over a basin in flood the wave visibly moves downstream — build the segment around this",
      "Verified: the styleset builds in 0.7 s and animates cleanly; only the data is waiting"
    ]
  },
  {
    title: "Any past forecast", scene: "held", status: "held", still: null,
    caption: ["Forecast Initialization Date"],
    points: [
      "Re-points every styleset, chart and flood extent at a different day's run",
      "Shoot it as: a date before a known flood, then step forward and watch the event build",
      "Blocker: the date is pinned to 2026-07-10 in src/main.js"
    ]
  },
  {
    title: "Forecast charts", scene: "held", status: "held", still: "held-08-forecast-chart.png",
    caption: ["15-day ensemble forecast"],
    points: [
      "Min–max range, 25–75 % IQR and ensemble median",
      "Drawn against shaded return-period bands, so a forecast is read against the reach's history",
      "Blocker: both chart tabs read riverIndex 0 regardless of the reach (src/docks/charts.js) \u2014 the curve in this still is that placeholder, not the Colorado"
    ]
  },
  {
    title: "Retrospective charts", scene: "held", status: "held", still: "held-03-retrospective.png",
    caption: ["Retrospective daily discharge \u00b7 Colorado"],
    points: [
      "Same test river as the forecast tab, so the two read as one reach",
      "Seven charts: the full daily record, monthly flow status, annual and seasonal summaries",
      "1y / 5y / 10y / 30y / All range buttons, drag-to-zoom, shift-drag to pan",
      "Scrolling this tab slowly is a scene in itself"
    ]
  },
  {
    title: "Flood mapping — selection", scene: "held", status: "held", still: "held-04-fim-mode.png",
    caption: ["FIM Mode"],
    points: [
      "The network re-colours to show what the flood library holds; red is no coverage",
      "Click two reaches on one river and the whole corridor between them comes with them",
      "Coverage is Colorado and eastern Utah — 31 tiles, 13,382 reaches; needs zoom 7 or closer"
    ]
  },
  {
    title: "Flood mapping — extent", scene: "held", status: "held", still: "held-05-fim-extent.png",
    caption: ["Synthetic Rating Curve Slider"],
    points: [
      "Five ways to drive the extent: rating curve ladder, manual flow, forecast, forecast max, return period",
      "Frames compute in under a millisecond — the slider is live, so film it moving",
      "Click a flooded pixel for depth; export the whole extent as GeoTIFF. Stage at Fort Morgan, CO"
    ]
  },
  {
    title: "Styling — river names", scene: "held", status: "held", still: "held-06-styling-names.png",
    caption: ["River names"],
    points: [
      "Each of 544 named rivers takes its own colour; everything unnamed goes grey",
      "The Missouri, Yellowstone and Clark Fork separating out of one blue network",
      "Held back by running time, not by data — this one is ready to film"
    ]
  },
  {
    title: "Styling — rule editor", scene: "held", status: "held", still: "held-07-styling-rules.png",
    caption: ["Stream styling"],
    points: [
      "Builds itself from the 11 attributes actually present in the tiles",
      "Per-zoom colour and width stops, visibility filters, first-match-wins rules",
      "Only draws under the Standard stream style, so it pairs with the forecast segment"
    ]
  }
];

// ── grouping ────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    key: "cut", title: "First cut",
    note: "What the demos talks about"
  },
  {
    key: "dropped", title: "Not in this cut",
    note: "Deliberately not discussed — kept here so nothing is lost"
  },
  {
    key: "held", title: "Held for later",
    note: "Waiting on source data, except the styling pair, which is waiting on running time"
  }
];

// Numbered by position inside a section, so pruning a shot renumbers the rest for free.
const grouped = SECTIONS.map((sec) => ({
  ...sec,
  shots: PAGES.filter((p) => (p.status ?? "cut") === sec.key).map((p, i) => ({...p, n: i + 1}))
}));

// ── markup ──────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));

const stillPath = (p) => (p.still && existsSync(`${STILLS}/${p.still}`) ? `${STILLS}/${p.still}` : null);

const frame = (p) => {
  const path = stillPath(p);
  return path
    ? `<img class="shot" src="${path}" alt=""/>`
    : `<div class="shot missing"><span>frame still to capture</span></div>`;
};

const shotPage = (p, sec) => `
  <section class="page">
    <header>
      <span class="num ${sec.key}">${sec.key === "cut" ? "" : sec.key.charAt(0).toUpperCase()}${p.n}</span>
      <h2>${esc(p.title)}</h2>
      <span class="scene">${esc(p.scene)}</span>
    </header>
    ${frame(p)}
    <div class="below">
      <div class="cap">
        <div class="cap-t">${esc(p.caption[0])}</div>
        ${p.caption[1] ? `<div class="cap-s">${esc(p.caption[1])}</div>` : ""}
      </div>
      <ul class="pts">${p.points.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </div>
  </section>`;

const sectionPage = (sec) => `
  <section class="page divider">
    <div>
      <h1>${esc(sec.title)}</h1>
      <p>${esc(sec.note)}</p>
      <p class="tally">${sec.shots.length} ${sec.shots.length === 1 ? "shot" : "shots"}</p>
    </div>
  </section>`;

const body = grouped
  .filter((sec) => sec.shots.length)
  .map((sec) => [sectionPage(sec), ...sec.shots.map((p) => shotPage(p, sec))].join("\n"))
  .join("\n");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>RFS v3 — storyboard</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #0e1a26; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page {
    width: 297mm; height: 210mm; padding: 9mm 11mm 8mm;
    page-break-after: always; break-after: page;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }

  header { display: flex; align-items: baseline; gap: 4mm; border-bottom: 0.5mm solid #d8e2ec; padding-bottom: 2.4mm; }
  .num {
    font-variant-numeric: tabular-nums; font-size: 6mm; font-weight: 700; color: #1d7fd0;
    min-width: 11mm;
  }
  .num.dropped { color: #b0392f; }
  .num.held { color: #a06a10; }
  header h2 { margin: 0; font-size: 6mm; font-weight: 650; letter-spacing: -0.02em; flex: 1; }
  .scene {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 3.2mm;
    color: #5d7080; background: #eef3f8; border: 0.3mm solid #dbe4ed;
    padding: 0.8mm 2mm; border-radius: 1.4mm;
  }

  /* Height-constrained, width auto: the stills are 16:9, so letting the box follow the image
     keeps the frame tight to the picture instead of pillarboxing it. */
  .shot {
    display: block; height: 127mm; width: auto; max-width: 100%; margin: 4mm auto 0;
    border: 0.4mm solid #cfdae6; border-radius: 1.6mm; background: #f3f7fa;
  }
  .shot.missing {
    width: 225.8mm;
    display: flex; align-items: center; justify-content: center;
    border-style: dashed; border-color: #b9c8d6; color: #8397a8;
    font-size: 4.4mm; letter-spacing: .04em; text-transform: uppercase;
  }

  .below { display: flex; gap: 7mm; margin-top: 4.5mm; flex: 1; }
  .cap {
    width: 108mm; flex: none;
    background: #101b28; border-radius: 2mm; padding: 3.4mm 4.2mm; color: #eaf4ff;
  }
  .cap-t { font-size: 4.1mm; font-weight: 650; line-height: 1.25; }
  .cap-s { font-size: 3.3mm; line-height: 1.35; color: #93b7d6; margin-top: 1.4mm; }

  .pts { margin: 0; padding: 0 0 0 4.6mm; flex: 1; align-self: center; }
  .pts li { font-size: 3.6mm; line-height: 1.45; margin-bottom: 1.8mm; color: #22323f; }
  .pts li:last-child { margin-bottom: 0; }

  .divider {
    align-items: center; justify-content: center; text-align: center;
    background: #101b28; color: #eaf4ff;
  }
  .divider h1 { margin: 0; font-size: 13mm; font-weight: 650; letter-spacing: -0.02em; }
  .divider p { margin: 4mm 0 0; font-size: 4.6mm; color: #93b7d6; }
  .divider .tally { font-size: 3.6mm; color: #5d7d9c; margin-top: 2mm; }
</style></head>
<body>
${body}
</body></html>`;

writeFileSync("stills.html", html);

// The markdown twin, off the same data, so the two can never disagree.
const md = [
  "# RFS v3 — demos stills",
  "",
  "Generated by `build-pdf.mjs` — edit the `PAGES` array there, not this file. `stills.pdf` is",
  "the same content, one shot per page.",
  "",
  "Move a shot between sections by changing its `status`: `cut` (default), `dropped`, `held`.",
  "Nothing is ever deleted, so the full list of everything worth saying stays in one place.",
  "",
  ...grouped.filter((sec) => sec.shots.length).flatMap((sec) => [
    `## ${sec.title}`,
    "",
    `*${sec.note} — ${sec.shots.length} shots.*`,
    "",
    ...sec.shots.flatMap((p) => {
      const path = stillPath(p);
      return [
        `### ${sec.key === "cut" ? "" : sec.key.charAt(0).toUpperCase()}${p.n} · ${p.title}  \`${p.scene}\``,
        "",
        path ? `![](${path})` : "*Frame still to capture.*",
        "",
        `> **${p.caption[0]}**${p.caption[1] ? `  \n> ${p.caption[1]}` : ""}`,
        "",
        ...p.points.map((t) => `- ${t}`),
        ""
      ];
    })
  ])
].join("\n");
writeFileSync("STORYBOARD.md", md);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${process.cwd()}/storyboard.html`, {waitUntil: "load"});
await page.pdf({path: "stills.pdf", format: "A4", landscape: true, printBackground: true});
await browser.close();

const gaps = PAGES.filter((p) => !stillPath(p));
for (const sec of grouped) console.log(`${sec.title.padEnd(16)} ${String(sec.shots.length).padStart(2)} shots`);
console.log(`\nstoryboard.pdf + STORYBOARD.md written`);
if (gaps.length) console.log(`frames still to capture: ${gaps.map((p) => p.title).join(", ")}`);
