/**
 * RFS v3 — scripted feature demos, recorded with Playwright.
 *
 * Drives the real app in a real browser and records the session to video, with captions and a
 * synthetic cursor drawn over the page so a viewer can follow what is being clicked. Every feature
 * beat is a genuine interaction: real map clicks on real reaches, real selections, a real
 * GeoParquet export. Only the camera moves are cinematography — those call the map directly so a
 * pan lands where the next caption says it will.
 *
 *   Prerequisites
 *     • `npm run dev` in the repo root (the app and its ./data mount on 127.0.0.1:5173)
 *     • a reachable account service, so the header shows "Sign in" rather than the error icon
 *       (a local Supabase is what .env.local points at)
 *     • ffmpeg on PATH, for the webm → mp4 pass
 *
 *   Usage
 *     node record.mjs                      the whole first cut
 *     node record.mjs --only=search,export  just those scenes
 *     node record.mjs --list                scene names, then exit
 *     DEMO_PACE=1.4 node record.mjs         slow every caption and pause down by 40%
 *     DEMO_EMAIL=… DEMO_PASSWORD=… node record.mjs   sign in for real in the account scene
 *
 * The notes for the latter, fuller capture are at the bottom of this file.
 */

import {chromium} from "playwright";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, renameSync} from "node:fs";
import {join} from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════════════

const CFG = {
  app: process.env.DEMO_URL ?? "http://127.0.0.1:5173/",
  width: 1600,
  height: 900,
  outDir: "recordings",
  // One still per beat, for the stills. Cleared and rewritten on a full run; a partial run
  // (--only=…) leaves the frames it did not retake alone.
  stillsDir: "stills",
  // Everything that is a pause rather than a wait-for-work scales by this, so the whole cut can be
  // slowed for a narrated version without re-timing a single scene.
  pace: Number(process.env.DEMO_PACE ?? 1),
  // Supplied → the account scene signs in for real. Absent → it opens the sign-in sheet, says what
  // signing in buys you, and closes it again.
  email: process.env.DEMO_EMAIL ?? "",
  password: process.env.DEMO_PASSWORD ?? ""
};

// The view the cut opens on: wide enough that the title card sits over the global network rather
// than over one country.
const HOME = "#map=2.4/18/-40";

// Where the demos does its selection work: the Missouri headwaters above Three Forks, Montana.
// Zoom 9.3 is the floor for this basin — the tiles publish by Strahler order, and any further out
// a selected watershed highlights reaches that are not drawn. Big enough to be a real subset
// (~1,400 reaches), small enough that the export finishes while the caption is still up.
const WORK = {center: [-111.55, 45.75], zoom: 9.3};

// ═══════════════════════════════════════════════════════════════════════════
// The overlay · captions and a cursor, drawn into the page so they land in the video
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Installed with addInitScript so it survives a reload, and mounted on DOM ready rather than at
 * once — this runs before the app's own scripts.
 *
 * The cursor rides the page's real mousemove events instead of being positioned by the script:
 * whatever Playwright's mouse actually does is what the viewer sees, so the two can never drift.
 */
function overlay() {
  const mount = () => {
    const css = document.createElement("style");
    css.textContent = `
      #demo-caption {
        position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%);
        z-index: 2147483000; pointer-events: none;
        max-width: 1080px; padding: 18px 30px;
        background: rgba(9, 15, 25, .93); border: 1px solid rgba(120, 190, 255, .28);
        border-radius: 14px; box-shadow: 0 18px 50px rgba(0, 0, 0, .55);
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        text-align: center; opacity: 0; transition: opacity .45s ease;
      }
      #demo-caption.show { opacity: 1; }
      #demo-caption .t {
        color: #eaf4ff; font-size: 27px; line-height: 1.28; font-weight: 620; letter-spacing: .1px;
      }
      #demo-caption .s {
        color: #8fb6d8; font-size: 18px; line-height: 1.42; margin-top: 8px; font-weight: 440;
      }
      #demo-caption .s:empty { display: none; }

      /* The title/outro card: same layer, centred, and larger. */
      #demo-caption.card {
        bottom: auto; top: 50%; transform: translate(-50%, -50%);
        padding: 40px 62px; background: rgba(9, 15, 25, .95);
      }
      #demo-caption.card .t { font-size: 44px; }
      #demo-caption.card .s { font-size: 21px; margin-top: 14px; }

      #demo-cursor {
        position: fixed; left: 0; top: 0; z-index: 2147483100; pointer-events: none;
        width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, .95); background: rgba(90, 170, 255, .30);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, .45), 0 2px 10px rgba(0, 0, 0, .5);
        opacity: 0; transition: opacity .3s ease;
      }
      #demo-cursor.on { opacity: 1; }
      #demo-pulse {
        position: fixed; left: 0; top: 0; z-index: 2147483099; pointer-events: none;
        width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        border: 2px solid rgba(120, 200, 255, .95); opacity: 0;
      }
      @keyframes demo-ping {
        from { transform: scale(1); opacity: .95; }
        to   { transform: scale(3.4); opacity: 0; }
      }
      #demo-pulse.ping { animation: demo-ping .55s ease-out; }

      /* What a spotlighted / hovered control looks like when the demo points at it. */
      .demo-ring {
        outline: 3px solid #ffd54a !important;
        outline-offset: 3px !important;
        border-radius: 8px;
      }
    `;
    document.head.appendChild(css);

    const cap = document.createElement("div");
    cap.id = "demos-caption";
    cap.innerHTML = `<div class="t"></div><div class="s"></div>`;
    const cur = document.createElement("div");
    cur.id = "demos-cursor";
    const pulse = document.createElement("div");
    pulse.id = "demos-pulse";
    document.body.append(cap, cur, pulse);

    let at = {x: -100, y: -100};
    const place = (el, p) => {
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    };
    addEventListener("mousemove", (e) => {
      at = {x: e.clientX, y: e.clientY};
      cur.classList.add("on");
      place(cur, at);
    }, true);
    addEventListener("mousedown", () => {
      place(pulse, at);
      pulse.classList.remove("ping");
      void pulse.offsetWidth;
      pulse.classList.add("ping");
    }, true);

    window.__demo = {
      say(title, sub = "", card = false) {
        cap.querySelector(".t").textContent = title;
        cap.querySelector(".s").textContent = sub;
        cap.classList.toggle("card", card);
        cap.classList.add("show");
      },
      hush() {
        cap.classList.remove("show");
      },
      ring(selector) {
        for (const el of document.querySelectorAll(".demos-ring")) el.classList.remove("demos-ring");
        if (selector) document.querySelector(selector)?.classList.add("demos-ring");
      },
      cursor(on) {
        cur.classList.toggle("on", on);
      }
    };
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount);
  else mount();
}

// ═══════════════════════════════════════════════════════════════════════════
// Driving helpers
// ═══════════════════════════════════════════════════════════════════════════

const ms = (n) => Math.round(n * CFG.pace);

function makeDriver(page) {
  // Where the synthetic mouse is, so a move can be interpolated from it.
  let at = {x: CFG.width / 2, y: CFG.height / 2};

  const pause = (n) => page.waitForTimeout(ms(n));

  /**
   * A stills frame, named for its beat and nothing else. Deliberately unnumbered: a partial
   * run (--only=…) would otherwise start counting from one again and write over frames belonging
   * to other scenes. The stills' running order comes from the PAGES array in build-pdf.mjs,
   * so the filenames never had to carry it.
   */
  const still = async (label) => {
    const name = `${label}.png`;
    await page.screenshot({path: join(CFG.stillsDir, name)});
    return name;
  };

  /** Show a caption and hold it long enough to be read before the action it introduces. */
  const say = async (title, sub = "", hold = 1500) => {
    await page.evaluate(([t, s]) => window.__demo?.say(t, s), [title, sub]);
    await pause(hold);
  };

  const card = async (title, sub = "", hold = 3400, shotLabel = null) => {
    await page.evaluate(([t, s]) => window.__demo?.say(t, s, true), [title, sub]);
    await pause(hold / 2);
    if (shotLabel) await still(shotLabel);
    await pause(hold / 2);
    await page.evaluate(() => window.__demo?.hush());
    await pause(600);
  };

  const hush = async () => {
    await page.evaluate(() => window.__demo?.hush());
    await pause(400);
  };

  /**
   * Glide the pointer, so a viewer can see where the next click is going. Stepped with real waits
   * rather than Playwright's instant `steps`, because the cursor in the video is drawn by the
   * page's own mousemove handler — it can only be as smooth as the events actually are.
   */
  const moveTo = async (x, y, {duration = 620} = {}) => {
    const steps = Math.max(8, Math.round(ms(duration) / 26));
    const from = at;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      // Ease-in-out, so the pointer sets off and arrives the way a hand does.
      const e = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await page.waitForTimeout(20);
    }
    at = {x, y};
  };

  /** Move to a point on the page and click it. */
  const clickAt = async (x, y, {settle = 500} = {}) => {
    await moveTo(x, y);
    await pause(180);
    await page.mouse.click(x, y);
    await pause(settle);
  };

  const boxOf = async (selector) => {
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const b = await el.boundingBox();
    if (!b) throw new Error(`no box for ${selector}`);
    return b;
  };

  /** Click a control the way a person would: pointer to it, then down. */
  const click = async (selector, {settle = 700} = {}) => {
    const b = await boxOf(selector);
    await clickAt(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), {settle});
  };

  const hover = async (selector, {hold = 1200} = {}) => {
    const b = await boxOf(selector);
    await moveTo(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
    await pause(hold);
  };

  /** Type into a field at a readable speed, so the typeahead is seen answering. */
  const type = async (selector, text, {delay = 105} = {}) => {
    await click(selector, {settle: 200});
    await page.locator(selector).type(text, {delay: ms(delay)});
  };

  // ── the map ────────────────────────────────────────────────────────────────

  /**
   * Hold until the map has finished drawing, so a caption never lands over half-loaded tiles.
   * Raced against a ceiling: at continental zooms there is always another tile, and waiting for
   * a genuine idle would stall the cut rather than tidy it.
   */
  const settleMap = async (ceiling = 4000) => {
    await page.evaluate(async (limit) => {
      const {map} = await import("/src/map/map.js");
      if (map.loaded() && map.areTilesLoaded()) return;
      await Promise.race([
        new Promise((r) => map.once("idle", r)),
        new Promise((r) => setTimeout(r, limit))
      ]);
    }, ms(ceiling));
  };

  /**
   * Camera only. The map is reached through its own module — in dev the page and this script share
   * one module graph, so this is the same instance the app is drawing with.
   */
  const flyTo = async (center, zoom, {duration = 2600, wait = 700} = {}) => {
    await page.evaluate(async ([c, z, d]) => {
      const {map} = await import("/src/map/map.js");
      map.flyTo({center: c, zoom: z, duration: d, essential: true});
    }, [center, zoom, ms(duration)]);
    await page.waitForTimeout(ms(duration) + 200);
    await settleMap();
    await page.waitForTimeout(ms(wait));
  };

  /**
   * Move to a view unless the camera is already on it. Lets a scene state the ground it needs
   * without paying for a redundant flight in a full run, where the scene before it has usually
   * left the camera in the right place — and makes a single-scene run land somewhere sensible
   * instead of wherever the boot happened to stop.
   */
  const ensureView = async (center, zoom, opts = {}) => {
    const off = await page.evaluate(async ([c, z]) => {
      const {map} = await import("/src/map/map.js");
      const at = map.getCenter();
      return Math.abs(at.lng - c[0]) > 0.6 || Math.abs(at.lat - c[1]) > 0.6 || Math.abs(map.getZoom() - z) > 0.4;
    }, [center, zoom]);
    if (off) await flyTo(center, zoom, opts);
  };


  /**
   * Screen points that sit on real river reaches, so a click lands on hydrography rather than on
   * whatever pixel a hard-coded coordinate happens to be over once a tile has moved.
   *
   * `map.project()` is relative to the map container, and the container starts where the panel
   * ends — so every point is offset by the container's own box before it is handed back. Getting
   * that wrong is a click into empty space, which is exactly what it looks like on video.
   */
  const reaches = async ({minOrder = 5, maxOrder = 9, count = 4, within = null,
                          smallestFirst = false, disjoint = false, apart = 0} = {}) =>
    page.evaluate(async ([lo, hi, n, range, smallest, disjoint, apart]) => {
      const {map} = await import("/src/map/map.js");
      const {streamLayers} = await import("/src/map/layers.js");
      const box = document.getElementById("map").getBoundingClientRect();
      const found = [];
      const seen = new Set();
      for (const f of map.queryRenderedFeatures({layers: streamLayers()})) {
        if (f.geometry.type !== "LineString") continue;
        const p = f.properties;
        if (p.strahlerOrder < lo || p.strahlerOrder > hi) continue;
        // Restricted to a riverIndex run when the caller is after reaches inside a selection —
        // an AOI inlet has to be a reach the outlet actually drains, or the click is refused.
        if (range && (p.riverIndex < range.lo || p.riverIndex > range.hi)) continue;
        if (range && p.riverId === range.outlet) continue;
        if (seen.has(p.riverIndex)) continue;
        seen.add(p.riverIndex);
        const mid = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
        const at = map.project(mid);
        const x = at.x + box.x;
        const y = at.y + box.y;
        // Keep clear of the panel edge, the map controls and the legend.
        if (x < box.x + 70 || x > box.x + box.width - 70) continue;
        if (y < 70 || y > box.height - 120) continue;
        found.push({
          x: Math.round(x), y: Math.round(y),
          riverId: p.riverId, riverIndex: p.riverIndex,
          order: p.strahlerOrder, upstream: p.upstreamCount ?? 0
        });
        // Ordering needs the whole field, so the cap is applied after the sort below.
        if (!smallest && !disjoint && found.length >= n) break;
      }

      // An AOI inlet wants the smallest tributaries it can find: an inlet takes its whole upstream
      // with it, so cutting at the main stem leaves nothing and makes the feature look pointless.
      if (smallest) found.sort((a, b) => a.upstream - b.upstream);

      // Multi-select is meant to show separate watersheds, not several reaches of one. Everything
      // upstream of a reach is the contiguous riverIndex run [riverIndex - upstreamCount,
      // riverIndex], so two picks are the same watershed exactly when their runs overlap — and a
      // pick inside another's run is the nesting that makes the collection look like one selection
      // clicked four times. Biggest first, then take only what is disjoint from everything already
      // taken, and keep them apart on screen so the four read as four.
      if (disjoint) {
        const runs = [];
        const kept = [];
        for (const f of [...found].sort((a, b) => b.upstream - a.upstream)) {
          const run = [f.riverIndex - f.upstream, f.riverIndex];
          if (runs.some(([a, b]) => run[0] <= b && a <= run[1])) continue;
          if (kept.some((k) => Math.hypot(k.x - f.x, k.y - f.y) < apart)) continue;
          runs.push(run);
          kept.push(f);
          if (kept.length >= n) break;
        }
        return kept;
      }
      return found.slice(0, n);
    }, [minOrder, maxOrder, count, within, smallestFirst, disjoint, apart]);

  /** The riverIndex run the current selection covers, for picking reaches inside it. */
  const selectionRange = async () =>
    page.evaluate(async () => {
      const {currentSelection} = await import("/src/explorer/map.js");
      const s = currentSelection();
      return s ? {lo: s.lo, hi: s.hi, outlet: s.outlet} : null;
    });

  /** Click a reach the query found, and say so if the map had none to offer. */
  const clickReach = async (opts = {}) => {
    const [hit] = await reaches({...opts, count: 1});
    if (!hit) throw new Error(`no reach on screen matching ${JSON.stringify(opts)}`);
    await clickAt(hit.x, hit.y, {settle: opts.settle ?? 1200});
    return hit;
  };

  const ring = (selector) => page.evaluate((s) => window.__demo?.ring(s), selector);

  /**
   * Switch selection method, answering the dialog if one is raised.
   *
   * Leaving Multi Select with a collection, or the AOI with inlets, asks before clearing it — and
   * an unanswered dialog is a backdrop over the whole page, so the next map click lands on nothing
   * and the scene fails somewhere that looks unrelated. Every mode change goes through here.
   */
  const switchMode = async (head, {narrate = null} = {}) => {
    await click(head, {settle: 800});
    const dialog = page.locator(".backdrop .card.confirm");
    if (!await dialog.isVisible().catch(() => false)) return false;
    if (narrate) {
      await say(narrate, "", 1500);
      await still("select-confirm");
      await pause(700);
    }
    await click(".backdrop .card.confirm .confirm-actions .btn.danger", {settle: 1200});
    return true;
  };

  /**
   * Click the search result whose row carries `match`. By text rather than by position, because
   * the order the names table returns is not the demo's to assume — "Colorado" comes back as
   * Mexico, Argentina, United States and a tributary, and which one is wanted is a content
   * decision, not the first row.
   */
  const pickSearchResult = async (match) => {
    const rows = page.locator("#search-results > *");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      if (!(await row.innerText()).includes(match)) continue;
      const b = await row.boundingBox();
      if (!b) continue;
      await clickAt(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), {settle: 2600});
      return true;
    }
    throw new Error(`no search result matching "${match}"`);
  };

  /**
   * Put the panel back to bare controls. A dock — charts, bookmarks, help, styling — takes the
   * column over while it is open, so the explorer's own rows and buttons are not merely covered,
   * they are out of the layout: a scene that opens with one still up cannot click anything in it.
   * Escape is the app's own way to shut whatever is open, so this is the user's gesture, not a
   * reach into the internals.
   */
  const clearStage = async () => {
    for (let i = 0; i < 3; i++) {
      if (await page.locator("#explorer-section").isVisible().catch(() => false)) break;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(250);
  };

  return {
    page, pause, say, card, hush, moveTo, clickAt, click, hover, type,
    flyTo, ensureView, settleMap, reaches, selectionRange, clickReach, ring, boxOf,
    clearStage, still, pickSearchResult, switchMode
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenes · each one is a feature, in the order the cut plays them
// ═══════════════════════════════════════════════════════════════════════════

const SCENES = [];
/**
 * `inCut: false` keeps a scene runnable by name but out of the default run — pruned from the cut
 * without being deleted, so a change of mind costs a flag rather than a rewrite.
 */
const scene = (name, run, {inCut = true} = {}) => SCENES.push({name, run, inCut});

// ── 1 · the network, and how much of it there is ────────────────────────────
scene("open", async (d) => {
  await d.card(
    "GEOGLOWS River Forecast System",
    "A global river network, explored and subset entirely in the browser",
    3400,
    "title"
  );

  await d.say(
    "4.7 million river reaches",
    "The whole global network, served as vector tiles straight to the page",
    2600
  );

  await d.flyTo([-63.5, -6.0], 4.2, {duration: 3200});
  await d.still("network-continental");
  await d.say(
    "Detail arrives as you go in",
    "Reaches are published by Strahler order — zoom, and the smaller streams appear",
    2000
  );
  await d.flyTo([-72.4, -11.6], 7.6, {duration: 3200});
  await d.pause(1400);
  await d.flyTo([-72.15, -11.75], 9.8, {duration: 2600});
  await d.pause(1600);
  await d.still("network-headwaters");
  await d.hush();
});

// ── 2 · the help dock, and its spotlight ────────────────────────────────────
scene("help", async (d) => {
  await d.clearStage();
  await d.flyTo([-111.55, 45.9], 8.2, {duration: 2200});
  await d.say("Every control explains itself", "The help panel docks beside the map, not over it", 1600);
  await d.click("#btn-help", {settle: 1400});
  await d.pause(1200);
  await d.still("help-open");

  await d.say(
    "Hover a passage and it lights up the control",
    "The text points at the real button, wherever it lives on the page",
    1500
  );

  for (const target of ["#btn-language", "#layer-btn", "#legend-overlay"]) {
    const passage = `#help-dock [data-spotlight="${target}"]`;
    if (!await d.page.locator(passage).count()) continue;
    await d.hover(passage, {hold: 1900});
    if (target === "#layer-btn") await d.still("help-spotlight");
  }

  await d.say("Keyboard shortcuts for every selection method", "", 1200);
  await d.page.locator("#help-dock .help-keys").first().scrollIntoViewIfNeeded().catch(() => {});
  await d.pause(2200);
  await d.still("help-shortcuts");

  await d.click("#help-close", {settle: 900});
  await d.hush();
});

// ── 3 · what else is on the map ─────────────────────────────────────────────
scene("layers", async (d) => {
  await d.clearStage();
  await d.say("Reference geography, on demand", "Catchments, basins and publication groups ride along with the network", 1600);
  await d.click("#layer-btn", {settle: 800});
  await d.pause(700);

  const opts = d.page.locator("#layer-menu .opt");
  const n = await opts.count();
  // catchments · groups · basins sit after streams and flood extents in the menu.
  for (const i of [2, 4]) {
    if (i >= n) continue;
    const b = await opts.nth(i).boundingBox();
    if (!b) continue;
    await d.clickAt(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), {settle: 1500});
  }
  await d.pause(900);
  await d.click("#layer-btn", {settle: 700});

  await d.say("Hover a basin and it draws itself", "", 900);
  await d.moveTo(1000, 400);
  await d.pause(900);
  await d.moveTo(1180, 560);
  await d.pause(1300);
  await d.still("layers-reference");

  await d.say("Nine basemaps under it", "", 1000);
  await d.click("#basemap-btn", {settle: 800});
  await d.pause(600);
  const bms = d.page.locator("#basemap-menu .opt");
  if (await bms.count() > 3) {
    const b = await bms.nth(3).boundingBox();
    if (b) await d.clickAt(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), {settle: 2600});
  }
  await d.pause(1200);
  await d.still("layers-basemap");

  // Put the map back the way the scene found it. Imagery and the basin outlines are the point of
  // this scene and in every scene after it they are noise — a selection highlight has to read
  // against the ground, and orange over satellite does not.
  const home = bms.nth(0);
  const hb = await home.boundingBox();
  if (hb) await d.clickAt(Math.round(hb.x + hb.width / 2), Math.round(hb.y + hb.height / 2), {settle: 2400});
  await d.click("#basemap-btn", {settle: 600});
  await d.click("#layer-btn", {settle: 700});
  for (const i of [2, 4]) {
    if (i >= n) continue;
    const b = await opts.nth(i).boundingBox();
    if (!b) continue;
    await d.clickAt(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), {settle: 900});
  }
  await d.click("#layer-btn", {settle: 600});
  await d.hush();
}, {inCut: false});

// ── 4 · finding a river by name ─────────────────────────────────────────────
scene("search", async (d) => {
  await d.clearStage();
  // River Select, not Data Browser. A search made from the Data Browser opens the charts for the
  // river it lands on, and the forecast charts are the half of the data this cut is holding back —
  // so the search is asked as "where is this river", and the answer stays on the map.
  await d.switchMode("#river-select-head");
  await d.say("Find a river by name", "The names table is searched on the device, as you type", 1400);
  await d.click("#btn-search-river", {settle: 900});
  await d.type("#search-river-name", "Colorado");
  await d.pause(2400);

  // Colorado first because it is the ambiguous one: three rivers of that name on three
  // continents, plus a tributary that says what it flows into.
  await d.say(
    "Three rivers called Colorado, told apart by country",
    "A tributary says what it flows into",
    2600
  );
  await d.still("search-typeahead");

  // The western Colorado. The names table labels a river by its outlet, and this one ends in the
  // delta — so the row to take is "Colorado · Mexico", not the one marked United States.
  await d.pickSearchResult("Mexico");
  await d.settleMap();
  await d.say(
    "The whole river lights up, and the camera frames it",
    "Not the reach at the mouth — the published extent of the named river",
    3400
  );
  await d.still("search-colorado");
  await d.hush();

  // Three more, same gesture, one continent each.
  for (const [name, country] of [["Amazon", "Brazil"], ["Nile", "Egypt"], ["Mekong", "Vietnam"]]) {
    await d.clearStage();
    await d.click("#btn-search-river", {settle: 800});
    await d.page.fill("#search-river-name", "");
    await d.pause(250);
    await d.type("#search-river-name", name, {delay: 85});
    await d.pause(2100);
    await d.pickSearchResult(country);
    await d.settleMap();
    await d.say(`${name} · ${country}`, "", 2600);
    await d.still(`search-${name.toLowerCase()}`);
    await d.hush();
  }
});

// ── 5 · what a reach actually carries ───────────────────────────────────────
scene("attributes", async (d) => {
  await d.clearStage();
  // Close in far enough that the whole of a watershed is drawn: the tiles publish by Strahler
  // order, so a selection zoomed out past order 6 highlights reaches that are not on screen.
  await d.flyTo(WORK.center, WORK.zoom, {duration: 2800});
  await d.say("River Select: one click, one reach", "", 1300);
  await d.switchMode("#river-select-head");
  await d.clickReach({minOrder: 5, maxOrder: 9, settle: 1800});

  await d.say(
    "Every reach carries its own attributes",
    "Read straight out of the tile — order, contributing area, the reach below it",
    3600
  );
  await d.still("attributes");
  await d.hush();
});

// ── 6 · the five ways to select ─────────────────────────────────────────────
scene("selection", async (d) => {
  await d.clearStage();
  await d.ensureView(WORK.center, WORK.zoom, {duration: 2600});
  await d.say(
    "Five answers to “what did that click select?”",
    "Each method reads the same click a different way",
    2200
  );

  // Watershed
  await d.say("Watershed Select: the reach and everything above it", "", 1300);
  await d.switchMode("#watershed-head");
  const outlet = await d.clickReach({minOrder: 6, maxOrder: 9, settle: 3600});
  const count = await d.page.locator("#watershed-count").innerText().catch(() => "");
  await d.say(
    `${count.trim() || "Every"} streams selected upstream`,
    "With the outlet, the riverIndex run it covers, and its catchment area",
    2400
  );
  await d.still("select-watershed");

  // Pull back so the selection is seen whole. At the working zoom the upstream area runs off every
  // edge, which reads as "some reaches went orange" rather than "everything that drains to here".
  //
  // The limit is the publication ladder, not the camera: reaches appear by Strahler order, so going
  // out past zoom 7 drops order 4 and below and the highlight starts thinning from the headwaters
  // down. Zoom 7.6 is about as far as this basin goes while still drawing what is selected — a
  // bigger watershed can afford to go further out, a smaller one cannot go as far.
  await d.flyTo(WORK.center, 7.6, {duration: 2600});
  await d.say(
    "Pull back and the whole upstream area is lit",
    "Every reach that drains to the one reach that was clicked",
    3000
  );
  await d.still("select-watershed-extent");
  await d.hush();
  await d.flyTo(WORK.center, WORK.zoom, {duration: 2400});

  // Multi-select
  await d.say("Multi Select: collect watersheds as you go", "", 1500);
  await d.switchMode("#picks-head");
  const picks = await d.reaches({minOrder: 4, maxOrder: 6, count: 4, disjoint: true, apart: 150});
  for (const p of picks) await d.clickAt(p.x, p.y, {settle: 1700});
  // How many actually landed, not how many were aimed at: the disjoint filter can come up short,
  // and a caption that says four over a map showing three is worse than no caption.
  const collected = (await d.page.locator("#picks-count").innerText().catch(() => "")).trim();
  await d.say(
    `${collected || "Several"} separate watersheds, not several reaches of one`,
    "Each keeps its own outlet, reach count and colour",
    2400
  );
  await d.still("select-multi");

  // Copy the ids out
  await d.say("Copy the outlet IDs straight to the clipboard", "", 1200);
  await d.click("#btn-copy", {settle: 1600});

  // AOI — a watershed with the ground above its inlets cut out
  await d.say(
    "AOI Subsetter: a watershed, minus what drains in from above",
    "Click the outlet, then click each inlet to cut it and its upstream away",
    2000
  );
  // Leaving multi-select with a collection in hand asks before it throws the collection away —
  // which is a beat worth showing, so this one is narrated.
  await d.switchMode("#watershed-head", {narrate: "A collection is real work, so it asks before clearing it"});
  await d.clickAt(outlet.x, outlet.y, {settle: 3200});
  await d.switchMode("#aoi-head");

  const range = await d.selectionRange();
  const inlets = await d.reaches({minOrder: 3, maxOrder: 4, count: 3, within: range, smallestFirst: true});
  for (const p of inlets) await d.clickAt(p.x, p.y, {settle: 1900});
  const kept = await d.page.locator("#aoi-body").innerText().catch(() => "");
  await d.say(
    "The area of interest is what is left",
    kept.split("\n").find((l) => /kept/i.test(l))?.trim() ?? "",
    3000
  );
  await d.still("select-aoi");
  await d.hush();
});

// ── 7 · taking the subset away with you ─────────────────────────────────────
scene("export", async (d) => {
  await d.clearStage();
  await d.say("Back to the whole watershed", "", 1100);
  await d.switchMode("#watershed-head");
  const hit = await d.clickReach({minOrder: 6, maxOrder: 9, settle: 3600});
  void hit;

  await d.say(
    "Download the selection as GeoParquet",
    "Streams and catchments, cut out of the global archives in the browser",
    2200
  );

  const streams = d.page.waitForEvent("download", {timeout: 240_000}).catch(() => null);
  await d.click("#btn-geoparquet", {settle: 900});

  await d.say(
    "Only the row groups that hold the selection are fetched",
    "Index read, geometry pruned, decoded, re-encoded and written — client side",
    0
  );
  // Hold on the staged progress list while it actually runs.
  await d.pause(6000);
  await d.still("export-progress");
  await d.pause(5000);
  await d.say("Two files: the streams, then their catchments", "", 0);
  await d.pause(9000);

  await streams;
  await d.pause(2000);
  await d.still("export-stages");
  await d.pause(1400);
  await d.hush();
}, {inCut: false});

// ── 8 · bookmarks ───────────────────────────────────────────────────────────
scene("bookmarks", async (d) => {
  await d.clearStage();
  await d.say("A reference list of notable rivers", "Sixteen of the world's major rivers, ready to jump to", 1800);
  await d.click("#btn-bookmarks", {settle: 1600});
  await d.pause(1400);
  await d.still("bookmarks-notable");

  await d.say("Jump the map straight to one", "", 1200);
  const locate = d.page.locator("#bookmarks-body button[data-action='locate']").nth(1);
  const b = await locate.boundingBox();
  if (b) await d.clickAt(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), {settle: 3400});
  await d.settleMap();
  await d.pause(1000);
  await d.still("bookmarks-locate");
  await d.click("#bookmarks-close", {settle: 900});

  await d.say("Save any reach of your own", "", 1400);
  await d.flyTo(WORK.center, WORK.zoom, {duration: 2400});
  await d.switchMode("#browse-head");

  // Click reaches until one opens the dock. A single click is not a safe bet here: the point comes
  // from a feature query taken a moment earlier, and a reach whose drawn line is thinner than the
  // pointer is one the click can slip past. The dock is the only proof the click was read as a
  // reach, so it is what the loop waits on.
  const tab = d.page.locator("#charts-tab-details");
  const targets = await d.reaches({minOrder: 5, maxOrder: 9, count: 4});
  for (const t of targets) {
    await d.clickAt(t.x, t.y, {settle: 1800});
    if (await tab.isVisible().catch(() => false)) break;
    await d.pause(1200);
    if (await tab.isVisible().catch(() => false)) break;
  }
  await tab.waitFor({state: "visible", timeout: 20_000});
  await d.pause(400);
  // Details rather than the forecast tab: the reach's attributes and the save control, without
  // putting the forecast charts on screen — that data is the part this cut is holding back.
  await d.click("#charts-tab-details", {settle: 1600});
  await d.click("#charts-save", {settle: 1200});

  if (await d.page.locator("#save-river-modal").isVisible()) {
    await d.type("#save-river-name", "Gauge above Three Forks");
    await d.pause(700);
    await d.click("#save-river-form button[type=submit]", {settle: 1600});
  }

  await d.click("#charts-close", {settle: 900});
  await d.say("Saved rivers get their own list, and an outline on the map", "", 1300);
  await d.click("#btn-saved", {settle: 1800});
  await d.pause(2200);
  await d.still("bookmarks-saved");
  await d.pause(1000);
  await d.click("#saved-close", {settle: 800});
  await d.hush();
});

// ── 9 · accounts ────────────────────────────────────────────────────────────
scene("account", async (d) => {
  await d.clearStage();
  await d.say(
    "Sign in and your saved rivers follow you",
    "Bookmarks and preferences sync to the account, not to the browser",
    1800
  );
  await d.click("#geoglowsSignIn", {settle: 1600});
  await d.pause(1600);
  await d.still("account-signin");

  if (CFG.email && CFG.password) {
    await d.type("#geoglowsSignInModal input[type='email']", CFG.email, {delay: 60});
    await d.pause(400);
    await d.type("#geoglowsSignInModal input[type='password']", CFG.password, {delay: 60});
    await d.pause(500);
    await d.click("#geoglowsSignInModal button[type='submit']", {settle: 3600});
    await d.say("Signed in — the device's list is now the account's", "", 2600);
  } else {
    await d.say(
      "Google, GitHub, or an email address",
      "Every device signed into the account sees the same saved rivers",
      3200
    );
    await d.page.keyboard.press("Escape");
    await d.pause(900);
  }
  await d.hush();
}, {inCut: false});

// ── 10 · theme and language ─────────────────────────────────────────────────
scene("appearance", async (d) => {
  await d.clearStage();
  await d.say("Light and dark", "", 1100);
  await d.click("#btn-theme", {settle: 2200});
  await d.pause(900);
  await d.still("appearance-light");
  await d.pause(600);
  await d.click("#btn-theme", {settle: 2000});

  await d.say("English, Spanish and French", "Down to the chart axis titles", 1400);
  await d.click("#btn-language", {settle: 800});
  for (const lang of ["es", "fr", "en"]) {
    await d.click(`#lang-menu [data-lang="${lang}"]`, {settle: 1900});
    if (lang === "es") await d.still("appearance-language");
    if (lang !== "en") await d.click("#btn-language", {settle: 700});
  }
  await d.hush();
});

// ── 11 · out ────────────────────────────────────────────────────────────────
scene("close", async (d) => {
  await d.clearStage();
  await d.flyTo([0, 20], 1.6, {duration: 3000});
  await d.pause(600);
  await d.still("global");
  await d.card(
    "River Forecast System v3",
    "Forecasts, retrospective records and flood inundation mapping are next",
    4200,
    "outro"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  console.log(SCENES.map((s) => s.name).join("\n"));
  process.exit(0);
}
const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean);
const plan = only ? SCENES.filter((s) => only.includes(s.name)) : SCENES.filter((s) => s.inCut);
if (!plan.length) {
  console.error(`No scenes matched. Known: ${SCENES.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

// Not wiped, for the same reason the stills directory is not: a partial run would otherwise take
// the full cut with it. A subset writes under its own name instead of over the cut.
mkdirSync(CFG.outDir, {recursive: true});
// Never wiped. The stills also carries frames this run does not take — the scenes pruned out
// of the cut, and the held material that has no scene at all (see capture-extras.mjs) — and
// clearing the directory to keep it tidy deletes exactly those.
mkdirSync(CFG.stillsDir, {recursive: true});

const browser = await chromium.launch({
  args: ["--force-color-profile=srgb", "--font-render-hinting=none"]
});
const context = await browser.newContext({
  viewport: {width: CFG.width, height: CFG.height},
  deviceScaleFactor: 1,
  acceptDownloads: true,
  permissions: ["clipboard-read", "clipboard-write"],
  recordVideo: {dir: CFG.outDir, size: {width: CFG.width, height: CFG.height}}
});
await context.addInitScript(overlay);

// Recording starts the moment the page exists, so everything from here to the first scene — the
// boot, the tile load, the switch to Standard — is on the tape. Timed, and cut off at the end.
const recordingStarted = Date.now();
const page = await context.newPage();
page.on("pageerror", (e) => console.warn(`  page error: ${e.message.slice(0, 140)}`));

console.log(`→ ${CFG.app}${HOME}`);
await page.goto(CFG.app + HOME, {waitUntil: "load"});

// The app has a lot to stand up before it is worth filming: the basemap, the stream tiles, the
// reference archives and the river-name table. Wait on the map's own first paint, then give the
// background work a moment rather than filming a half-drawn network.
await page.waitForSelector("canvas.maplibregl-canvas", {timeout: 60_000});
await page.waitForTimeout(11_000);

// Open on Standard: the forecast stylesets and their legend are the part of the data that is not
// final yet, so this cut does not advertise them.
await page.selectOption("#stream-style", "standard").catch(() => {});
await page.waitForTimeout(2500);
if (await page.locator("#legend-overlay").isVisible().catch(() => false)) {
  await page.click("#btn-legend").catch(() => {});
}
await page.waitForTimeout(800);

const d = makeDriver(page);
await d.settleMap(8000);

// Where the cut actually begins. Everything before it is set up, and is trimmed off below.
const leadIn = (Date.now() - recordingStarted) / 1000;

for (const s of plan) {
  const t0 = Date.now();
  console.log(`  ▸ ${s.name}`);
  try {
    await s.run(d);
  } catch (e) {
    console.warn(`    ${s.name} stopped early: ${e.message.split("\n")[0]}`);
    await d.hush().catch(() => {});
  }
  console.log(`    ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

await page.waitForTimeout(1200);
const video = page.video();
await context.close();
await browser.close();

// ── the file ────────────────────────────────────────────────────────────────
// The full run owns "rfs-v3-demos"; a subset is named for the scenes it holds, so re-recording one
// scene to look at it never costs the cut.
const stem = only ? `rfs-v3-${plan.map((s) => s.name).join("-")}` : "rfs-v3-demos";
const raw = video ? await video.path() : readdirSync(CFG.outDir).map((f) => join(CFG.outDir, f))[0];
const webm = join(CFG.outDir, `${stem}.webm`);
if (raw && raw !== webm) renameSync(raw, webm);

const mp4 = join(CFG.outDir, `${stem}.mp4`);
try {
  execFileSync("ffmpeg", [
    // Trim the boot off the front: seek before the input so the cut is cheap and frame-accurate
    // once re-encoded. A little is left in so the cut does not open mid-motion.
    "-y", "-ss", Math.max(0, leadIn - 0.6).toFixed(2), "-i", webm,
    "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    // Even dimensions, which h264 requires, and a steady frame rate for players that want one.
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
    mp4
  ], {stdio: "pipe"});
  console.log(`\n✓ ${mp4}`);
} catch (e) {
  console.warn(`ffmpeg pass failed (${String(e.message).slice(0, 120)}) — the webm is at ${webm}`);
}
if (existsSync(webm) && existsSync(mp4)) console.log(`  (source webm kept at ${webm})`);

/* ═══════════════════════════════════════════════════════════════════════════
 * NOTES · what this cut leaves out, and what a fuller capture should show
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything below is deliberately absent from the first cut. The bulk of it is on hold because
 * the source data it visualizes is not final yet — filming it now would be advertising numbers
 * that are going to change. The last group is simply features that did not fit this cut.
 *
 * ── A · Forecast maps · the stream stylesets ────────────────────────────────
 *   The stream style picker paints the whole network from the forecast, and each option is a
 *   different question asked of the same 15-day run:
 *     • Forecasted Max Flows — every reach coloured by the return period its peak reaches. This is
 *       the app's default and the most striking single frame in the product: the Amazon or the
 *       Ganges going orange to red across a whole basin.
 *     • 15 Day Forecast Timeseries — the animated one. 81 timesteps, a player at the bottom of the
 *       map with play/pause, a speed control and Space/←/→ shortcuts. Let it run over a basin in
 *       flood and the wave visibly moves downstream. This is the scene to build the whole forecast
 *       segment around.
 *     • Time to Peak — how long until each reach crests.
 *     • Below Q95 — the low-flow counterpart, for drought rather than flood.
 *   Verified working against local data: the timeseries styleset builds in about 0.7s and animates
 *   81 steps cleanly. It is the data behind it, not the rendering, that is waiting.
 *
 * ── B · Any past forecast, by date ──────────────────────────────────────────
 *   The Forecast Initialization Date picker at the top of the panel re-points every one of the
 *   above at a different day's run. Worth showing as: pick a date a few days before a known flood,
 *   watch the max-flow map change, then step the date forward a day at a time and watch the event
 *   build. It also drives the flood mapping styles, so the same date change re-cuts the inundation
 *   extent. Note the app currently pins 2026-07-10 (`currentForecastDate` in src/main.js) rather
 *   than computing the newest expected run — that TODO wants clearing before this is filmed.
 *
 * ── C · Forecast charts ─────────────────────────────────────────────────────
 *   Click any reach in Data Browser mode and the charts dock widens the panel over the map:
 *   the 15-day ensemble hydrograph with the min–max range, the 25–75% IQR and the ensemble median,
 *   drawn against shaded return-period bands (2, 5, 10, 25, 50, 100 year) so a forecast is read
 *   against the reach's own flood history rather than against a bare axis. The shading is a
 *   preference in Settings, which is a nice small beat to show being toggled.
 *
 * ── D · Retrospective charts ────────────────────────────────────────────────
 *   The Retrospective tab of the same dock is the deeper one: seven charts off the retrospective
 *   store — daily discharge over the full record with 1y/5y/10y/30y/All range buttons and
 *   drag-to-zoom, monthly flow status, and the annual/seasonal summaries under it. Scrolling that
 *   tab slowly is its own scene. Both chart tabs currently read riverIndex 0 regardless of the
 *   reach clicked (`riverIndex = 0 // todo override for demos phase` in src/docks/charts.js) —
 *   that override has to come out before this is recorded, or every river shows the same curve.
 *
 * ── E · Flood inundation mapping — Fort Morgan, Colorado ────────────────────
 *   The flagship, and the most involved to stage. FIM Mode turns the map into a reach picker: the
 *   network re-colours to show what the flood library holds (red = no coverage), and clicking two
 *   reaches on the same river selects the whole corridor between them. Then the discharge that
 *   drives the extent is chosen five ways — the per-reach synthetic rating curve ladder (a slider
 *   from q1 to q30, and the inundation grows and shrinks live as it moves), one manually specified
 *   flow for every reach, the forecast hydrograph animated over the 15-day horizon, the forecast
 *   maximum, and return-period indexed (in the picker, not built yet). Depth is queryable by
 *   clicking a flooded pixel, and the whole extent exports as a GeoTIFF.
 *     Staging notes, from testing against the local library: coverage is Colorado and eastern Utah
 *   (lon −110 to −103, lat 36 to 42), 31 tiles and 13,382 reaches. Fort Morgan sits at about
 *   40.25 N, −103.80 W, inside that box on the South Platte. Flood mapping needs zoom ≥ 7 and caps
 *   at 75 reaches per selection. Frames compute in well under a millisecond once a corridor is
 *   picked, so the slider really is live — that is the thing to film, not a still.
 *
 * ── F · Features held back from this cut, not by the data ───────────────────
 *   • Styling Options dock. The strongest omission. Two halves: colour the network by the river
 *     names table, which gives each of 544 named rivers its own colour and greys everything
 *     unnamed — the Missouri, Yellowstone and Clark Fork separating out of one blue network is an
 *     excellent single frame — and a rule editor that builds itself from the 11 attributes
 *     actually present in the tiles, with per-zoom colour and width stops, visibility filters and
 *     first-match-wins rules. It only draws under the Standard stream style, which is why it pairs
 *     naturally with the forecast segment rather than against it.
 *   • The local river ID lookup. 4.7 million rivers indexed into IndexedDB by a background worker
 *     on first load, with a live progress row in Settings and a delete/re-download control beside
 *     it. Once it lands, search-by-ID is instant. A good "this runs on your machine" beat.
 *   • The confirm-on-leave dialog. Switching away from Multi Select with watersheds collected asks
 *     before it clears them. Small, but it is the thing that says the collection is real work.
 *   • Deep links. The camera lives in the URL hash, so any view is a shareable link — worth one
 *     line if the cut ever needs a natural ending.
 */
