/**
 * Captures the stills frames the recorded cut does not produce.
 *
 * Two kinds: the scenes pruned out of the cut but kept in the stills (layers, basemaps,
 * accounts), and the held material that has no scene at all — the forecast stylesets, the charts,
 * the flood mapping and the styling dock. Both are illustrated in stills.pdf, so both need a
 * frame; neither is worth a recorded scene while the data behind it is still moving.
 *
 * Writes straight into stills/ alongside the recorder's own frames, and takes nothing else
 * away — run it whenever the app's look changes.
 *
 *   node capture-extras.mjs                    every frame below
 *   node capture-extras.mjs --only=fim,styling just those groups
 */

import {chromium} from "playwright";
import {mkdirSync} from "node:fs";

const APP = process.env.DEMO_URL ?? "http://127.0.0.1:5173/";
const STILLS = "stills";

// The FIM library covers Colorado and eastern Utah; this is the Colorado above Grand Junction,
// where a corridor selection floods visibly at the zoom flood mapping needs.
const FIM_VIEW = "#map=10/39.07/-108.55";
// The Colorado, the demos's test river. The names table labels a river by its outlet, and this
// one ends in the delta — so the row to take says Mexico.
const COLORADO = {query: "Colorado", row: "Mexico"};

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean);
const wanted = (group) => !only || only.includes(group);

mkdirSync(STILLS, {recursive: true});

const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 1600, height: 900}, acceptDownloads: true});
const page = await ctx.newPage();

const shot = async (name) => {
  await page.screenshot({path: `${STILLS}/${name}.png`});
  console.log(`  ${name}`);
};
const wait = (n) => page.waitForTimeout(n);

const settle = (limit = 5000) => page.evaluate(async (ms) => {
  const {map} = await import("/src/map/map.js");
  if (map.loaded() && map.areTilesLoaded()) return;
  await Promise.race([new Promise((r) => map.once("idle", r)), new Promise((r) => setTimeout(r, ms))]);
}, limit);

/**
 * Load the app at a view. Via about:blank on purpose: the groups below differ only in the URL
 * hash, and a hash-only goto is not a navigation — the document stays up, and so does whatever the
 * last group left open. A sign-in dialog carried into the next group swallows every click in it.
 */
const go = async (hash) => {
  await page.goto("about:blank");
  await page.goto(APP + hash, {waitUntil: "load"});
  await page.waitForSelector("canvas.maplibregl-canvas", {timeout: 60_000});
  await wait(11_000);
};

/** Standard stream style with the forecast legend off — how the cut is dressed. */
const plain = async () => {
  await page.selectOption("#stream-style", "standard").catch(() => {});
  await wait(2500);
  if (await page.locator("#legend-overlay").isVisible().catch(() => false)) {
    await page.click("#btn-legend").catch(() => {});
  }
  await wait(600);
};

/** Screen points on real reaches. map.project() is container-relative; the panel offsets it. */
const reaches = (lo, hi, n) => page.evaluate(async ([lo, hi, n]) => {
  const {map} = await import("/src/map/map.js");
  const {streamLayers} = await import("/src/map/layers.js");
  const box = document.getElementById("map").getBoundingClientRect();
  const out = [];
  const seen = new Set();
  for (const f of map.queryRenderedFeatures({layers: streamLayers()})) {
    if (f.geometry.type !== "LineString") continue;
    const p = f.properties;
    if (p.strahlerOrder < lo || p.strahlerOrder > hi || seen.has(p.riverIndex)) continue;
    seen.add(p.riverIndex);
    const mid = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
    const at = map.project(mid);
    const x = at.x + box.x;
    const y = at.y + box.y;
    if (x < box.x + 70 || x > box.x + box.width - 70 || y < 70 || y > box.height - 120) continue;
    out.push({x: Math.round(x), y: Math.round(y)});
    if (out.length >= n) break;
  }
  return out;
}, [lo, hi, n]);

const findRiver = async ({query, row}) => {
  await page.click("#btn-search-river");
  await wait(700);
  await page.fill("#search-river-name", "");
  await wait(250);
  await page.fill("#search-river-name", query);
  await wait(2600);
  for (const r of await page.$$("#search-results > *")) {
    if ((await r.innerText()).includes(row)) {
      await r.click();
      return;
    }
  }
  throw new Error(`no result matching ${row}`);
};

// ── the pruned scenes ───────────────────────────────────────────────────────

if (wanted("layers")) {
  console.log("layers");
  await go("#map=7.4/45.95/-111.6");
  await plain();
  await page.click("#layer-btn");
  await wait(700);
  const opts = page.locator("#layer-menu .opt");
  // streams · flood · catchments · groups · basins · …
  for (const i of [2, 4]) {
    await opts.nth(i).click().catch(() => {});
    await wait(1800);
  }
  await settle();
  await shot("layers-reference");
  await page.click("#layer-btn");
  await wait(600);

  await page.click("#basemap-btn");
  await wait(700);
  await page.locator("#basemap-menu .opt").nth(3).click().catch(() => {});
  await wait(3200);
  await settle();
  await shot("layers-basemap");
}

if (wanted("account")) {
  console.log("account");
  await go("#map=7.4/45.95/-111.6");
  await plain();
  await page.click("#geoglowsSignIn");
  await wait(2600);
  await shot("account-signin");
}

if (wanted("export")) {
  console.log("export");
  await go("#map=9.3/45.75/-111.55");
  await plain();
  await page.click("#watershed-head");
  await wait(700);
  const [hit] = await reaches(6, 9, 1);
  await page.mouse.click(hit.x, hit.y);
  await wait(6000);
  await page.click("#btn-geoparquet");
  await wait(9000);
  await shot("export-progress");
  await wait(11_000);
  await shot("export-stages");
  await wait(6000);
}

// ── held: the forecast half ─────────────────────────────────────────────────

if (wanted("forecast")) {
  console.log("forecast");
  await go("#map=3.6/-8/-62");
  // Left on the forecast styleset on purpose — this frame is the thing being held back.
  await wait(4000);
  await settle();
  await shot("held-01-forecast-maxflow");

  await page.selectOption("#stream-style", "timeseries");
  await wait(7000);
  await settle();
  await page.click("#btn-play").catch(() => {});
  await wait(3500);
  await shot("held-02-forecast-player");
  await page.click("#btn-play").catch(() => {});
}

if (wanted("charts")) {
  console.log("charts");
  await go("#map=2.4/18/-40");
  await plain();
  await findRiver(COLORADO);
  await wait(13_000);
  await shot("held-08-forecast-chart");
  await page.click("#charts-tab-retro");
  await wait(13_000);
  await shot("held-03-retrospective");
}

// ── held: flood mapping ─────────────────────────────────────────────────────

if (wanted("fim")) {
  console.log("fim");
  await go(FIM_VIEW);
  await plain();
  await page.click("#btn-flood-mode");
  await wait(8000);
  await settle();
  await shot("held-04-fim-mode");

  // Two clicks on the same river take the whole corridor between them; the ladder then drives the
  // extent. Several candidates, because a reach the flood library does not hold selects nothing.
  for (const p of await reaches(6, 8, 6)) {
    await page.mouse.click(p.x, p.y);
    await wait(2600);
    if (/flooded cells/.test(await page.locator("#flood-status").innerText().catch(() => ""))) break;
  }
  await page.locator("#ladder").evaluate((el) => {
    el.value = 9;
    el.dispatchEvent(new Event("input", {bubbles: true}));
  });
  await wait(4000);
  await shot("held-05-fim-extent");
}

// ── held: the styling dock ──────────────────────────────────────────────────

if (wanted("styling")) {
  console.log("styling");
  await go("#map=7.4/45.95/-111.6");
  await plain();
  await page.click("#btn-styling");
  await wait(3500);
  await shot("held-07-styling-rules");
  await page.click("#names-mode");
  await wait(7000);
  await settle();
  await shot("held-06-styling-names");
}

// ── the save-a-river frame, which the cut takes mid-dock ────────────────────

if (wanted("save")) {
  console.log("save");
  await go("#map=9.3/45.75/-111.55");
  await plain();
  const [hit] = await reaches(5, 9, 1);
  await page.mouse.click(hit.x, hit.y);
  await page.locator("#charts-tab-details").waitFor({state: "visible", timeout: 20_000});
  await page.click("#charts-tab-details");
  await wait(2600);
  await shot("save-river");
}

await browser.close();
console.log("\ndone");
