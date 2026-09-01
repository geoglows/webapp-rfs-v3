/**
 * The hydrography toolchains: the four selection methods with the river attributes under them, and
 * the styling section that draws the network by the names table and by rules over its attributes.
 *
 * Loaded by src/main.js once there is a map, and only for the toolchains this build
 * ships — the two halves are independent, so a deployment can take the selection tools without the
 * style editor or the other way round.
 *
 * The styling half draws the network only while the stream style is Standard. A forecast styleset
 * is the network coloured by the forecast, which is a different answer to the same question, so it
 * takes the base layer back until it is switched off again — see setStyleset().
 */
import {PMTiles} from 'pmtiles';
import {$, el, fmt} from '../dom.js';
import {URLS} from './config.js';
import {upstreamRange} from './data.js';
import {
  applyHighlight, applyInlets, applyPicks, applyStreamStyle, attachExplorerLayers, clearHighlight,
  clearStreamStyle, currentSelection, fitRiverBounds, flyToPick, map, setSelectionHighlightVisible,
  streamLayerIds,
} from './map.js';
import {protocol} from '../map/map.js';
import {registerStreamLayers} from '../map/layers.js';
import {compileLayers} from './streamStyle.js';
import {activeUnnamed, loadRiverNames, namesStyle, riverNames} from './nameColouring.js';
import {loadStreamAttributes} from './streamAttributes.js';
import {createStylePanel} from './stylePanel.js';
import {renderRiverAttributes} from './riverPanel.js';
import {idsText, picks} from './picks.js';
import {aoi, isDownstreamOf, spanCount} from './aoi.js';
import {renderAoi} from './aoiPanel.js';
import {renderPicks} from './picksPanel.js';
import {downloadGeometry} from './geometry.js';
import {groupOf, loadGroups} from './groups.js';
import {progress, stages} from './ui.js';
import {heroIcon} from '../icons/icons.js';
import {closeDock, isDockOpen, openDock} from '../docks/dock.js';
import {watch as watchRiverNames} from '../data/riverNames.js';
import {askConfirm} from '../ui/confirm.js';
import {t, tf, tn} from '../i18n/i18n.js';

/** Which halves this build asked for; set by initExplorer(). */
let selectionOn = false;
let stylingOn = false;

/** The current selection, whichever method made it. */
let sel = null;
/** The whole watershed record of the reach last clicked, whatever the method made of it. */
let lastRec = null;
/** The raw tile properties behind the river attributes card, so a language change can re-render it. */
let lastProps = null;
let namesOn = false;
let namesError = null;
let stylePanel = null;
/** Whether the style spec is what is drawing the network — see the note at the top. */
let styleActive = false;
/** Repaints the network the way the forecast toolchain wants it, when the spec stops drawing it. */
let repaintForecast = () => {};
/** Asks the forecast toolchain for the styleset that leaves the network to the style spec. */
let wantStyleEditor = () => {};


// ── selection ────────────────────────────────────────────────────────────────
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The reach a click landed on, as the numbers a subset is cut from: its own riverIndex and the
 * contiguous run everything upstream occupies. A watershed selection and an AOI outlet are the same
 * record; they differ only in what is done with it.
 */
function reachRecord(at) {
  const riverId = num(at.riverId);
  const riverIndex = num(at.riverIndex);
  const upstreamCount = num(at.upstreamCount);
  if (riverId == null || riverIndex == null || upstreamCount == null) {
    throw new Error('That reach is missing riverId, riverIndex or upstreamCount — the tiles it ' +
      'came from cannot describe a subset');
  }
  const range = upstreamRange({riverIndex, upstreamCount});
  return {
    outletId: riverId,
    riverIndex: range.hi,
    upstreamCount,
    lo: range.lo,
    hi: range.hi,
    count: range.count,
    groupId: num(at.groupId),
    strahlerOrder: num(at.strahlerOrder),
  };
}

/** Make `spans` the selection under `rec`'s outlet — one run for a watershed, what the inlets left
 * for an AOI. Everything downstream reads `sel`, so both arrive there the same way. */
function setSelection(rec, spans) {
  sel = {...rec, spans, count: spanCount(spans)};
  applyHighlight({lo: rec.lo, hi: rec.hi, spans}, rec.outletId, applyStyle);
  renderSelectionInfo();
  // Which group publishes this reach is not on the tiles, so the readout asks for the table the
  // first time it wants one and repaints when it lands. Once per session, and it is the same table
  // the export needs — see groups.js.
  if (selectionOn && groupOf(sel.riverIndex) == null) {
    void loadGroups().then(() => sel && renderSelectionInfo()).catch(() => {});
  }
  selectionChanged();
  setBusy(false);
  return sel;
}

/** A single reach as a selection: the run of one its own riverIndex makes, so it needs no separate
 * path through the highlight, the shading, the styling scope or the export. */
const reachOnlyRecord = rec => ({
  ...rec, lo: rec.riverIndex, hi: rec.riverIndex, upstreamCount: 0, count: 1, reachOnly: true,
});

/** Select what a click means in the method that is on, and hand back the *watershed* record either
 * way — shift-click collects the network above the reach whatever the method is. */
function selectOutlet(at) {
  try {
    const full = reachRecord(at);
    // Kept whole whichever method read it, so switching between river and watershed can re-read
    // the same click rather than asking for it again.
    lastRec = full;
    const rec = oneReach(mode) ? reachOnlyRecord(full) : full;
    setSelection(rec, [{lo: rec.lo, hi: rec.hi}]);
    return full;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/**
 * A river the search box found, selected as if it had been clicked.
 *
 * A name is a whole river — the table gives its run of riverIndex, so the span is selected outright
 * and the camera frames the published extent. An ID is one reach and goes through selectOutlet like
 * a click, so it means whatever the method that is on says it means.
 *
 * `camera` is false when the forecast toolchain is on the page: it opens the charts for the reach
 * and then moves the camera itself, and two things easing at once is one of them missing.
 *
 * Deliberately touches neither the AOI nor the collection: a search should not place an inlet or add
 * to the picks as a side effect.
 */
function goToRiver(reach, named, {camera = true} = {}) {
  // The three fields a found reach actually has. The panel below renders whatever it is handed as
  // that reach's attributes, and where the camera is going is not one of them.
  showRiverAttributes({
    riverId: reach.riverId, riverIndex: reach.riverIndex, upstreamCount: reach.upstreamCount,
  });
  if (!named) {
    selectOutlet(reach);
    if (camera) flyToPick({lat: reach.lat, lon: reach.lon});
    upgradeFromTiles(reach.riverId);
    return;
  }
  const {lo, hi} = named.span;
  // The mouth reach is the outlet the highlight draws over the span, and the span is the name's own
  // — not the watershed above the mouth, which is usually larger and is a different river.
  const rec = {
    outletId: reach.riverId,
    riverIndex: hi,
    upstreamCount: hi - lo,
    lo,
    hi,
    count: hi - lo + 1,
    // A named river is known by its span, not by which group publishes it, and the names table has
    // no group in it. paintActions() reads this: the GeoParquet export needs one and stays off.
    groupId: null,
    strahlerOrder: null,
  };
  lastRec = rec;
  setSelection(rec, [{lo, hi}]);
  if (camera) fitRiverBounds(named.bbox, {lat: reach.lat, lon: reach.lon});
}

/**
 * Redo the selection from the tiles once the camera has arrived on a reach found by ID.
 *
 * The metadata store answers with the four numbers a selection needs but not the publication group
 * the export wants or the attributes the panel lists — both arrive with the tiles, so this waits for
 * them. A reach too small to be drawn at the zoom the camera stopped at is not there to be found and
 * stays as the store described it; the guard keeps a click made meanwhile from being overwritten.
 */
function upgradeFromTiles(riverId) {
  map.once('idle', () => {
    const hit = map.queryRenderedFeatures({layers: streamLayerIds()})
      .find(f => f.properties?.riverId === riverId);
    if (!hit || sel?.outletId !== riverId) return;
    showRiverAttributes(hit.properties);
    selectOutlet(hit.properties);
  });
}

/** The clicked reach's id, on the row of whichever one-reach method is on. */
function paintReachCount(text) {
  const browse = $('browse-count');
  if (browse) browse.textContent = mode === 'browse' ? text : '';
  $('river-select-count').textContent = mode === 'river' ? text : '';
}

/** The picked reach, in the readout the Data Browser and River Select share — the one line saying
 * which reach the attribute list below belongs to. */
function renderReachInfo() {
  const box = $('reach-info');
  if (!sel?.reachOnly) {
    box.style.display = 'none';
    paintReachCount('');
    return;
  }
  box.style.display = 'block';
  paintReachCount(String(sel.outletId));
  const groupId = sel.groupId ?? groupOf(sel.riverIndex);
  box.innerHTML =
    `<span class="k">${t('explorer.readout.reach')}</span> <span class="outlet">${sel.outletId}</span>` +
    (sel.strahlerOrder != null ? ` <span class="k">ord</span> ${sel.strahlerOrder}` : '') +
    (groupId != null ? ` <span class="k">group</span> <span class="group">${groupId}</span>` : '') +
    `<br><span class="k">riverIndex</span> ${fmt(sel.riverIndex)}`;
}

function renderSelectionInfo() {
  renderReachInfo();
  const box = $('selection-info');
  const n = sel.count;
  const groupId = sel.groupId ?? groupOf(sel.riverIndex);
  box.style.display = 'block';
  $('watershed-count').textContent = fmt(n);
  // The count carries its own span, so the sentence around it is the only part translated: the
  // number stays where the CSS expects it whatever the language does with the words.
  box.innerHTML =
    `<span class="count">${fmt(n)}</span> <span class="k">${tn('explorer.readout.streamsSelected', n)}</span>` +
    `<br><span class="k">${t('explorer.readout.outlet')}</span> <span class="outlet">${sel.outletId}</span>` +
    (sel.strahlerOrder != null ? ` <span class="k">ord</span> ${sel.strahlerOrder}` : '') +
    (groupId != null ? ` <span class="k">group</span> <span class="group">${groupId}</span>` : '') +
    `<br><span class="k">riverIndex</span> ${fmt(sel.lo)}&ndash;${fmt(sel.hi)}` +
    (sel.spans.length > 1
      ? `<br><span class="k">aoi</span> ${tn('explorer.readout.runs', sel.spans.length)} <span class="k">·</span> ` +
        `<span class="trimmed">&minus;${fmt(sel.upstreamCount + 1 - n)}</span> ` +
        `<span class="k">${t('explorer.readout.trimmed')}</span>`
      : '');
}

/** The clicked reach's attributes, printed as the tiles carry them — empty until something has been
 * clicked. */
function showRiverAttributes(props) {
  lastProps = props;
  renderRiverAttributes($('river-body'), props);
}

/** Download, copy and clear belong to whichever method is on: they mean the same thing in all four.
 * Multi-select holds something without a selection behind it, so it is the exception in the test. */
let busy = false;

function paintActions() {
  const held = mode === 'multi' ? picks.count() > 0 : sel !== null;
  // Anything with a riverIndex range behind it can be exported. Which group publishes that range is
  // not the selection's to know — the tiles carry no group — so it is looked up when the export
  // runs; see groups.js.
  $('btn-geoparquet').disabled = busy || sel === null;
  $('btn-copy').disabled = !held;
  $('btn-explorer-clear').disabled = !held;
}

function setBusy(on) {
  busy = on;
  if (selectionOn) paintActions();
}

/** Whatever the method that is on has to hand, one outlet riverId per line. */
async function copyIds() {
  const text = mode === 'multi' ? idsText() : (sel ? String(sel.outletId) : '');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // Clipboard access is denied on an insecure origin and in some embeddings; the ids are on the
    // page either way, so say why rather than just failing.
    console.warn('[explorer] clipboard write refused', err);
  }
}

/** One Clear for all four methods: it empties what the one you are in is holding. */
async function clearCurrent() {
  if (mode !== 'multi') return clearSelection();
  const n = picks.count();
  if (!n) return;
  const ok = await askConfirm({
    title: t('explorer.confirm.clearPicks.title'),
    message: tn('explorer.confirm.clearPicks', n),
    confirmKey: 'explorer.action.clear',
  });
  if (ok) picks.clear();
}

function clearSelection() {
  sel = null;
  lastRec = null;
  clearHighlight(applyStyle);
  if (!selectionOn) return selectionChanged();
  $('selection-info').style.display = 'none';
  $('watershed-count').textContent = '';
  $('reach-info').style.display = 'none';
  paintReachCount('');
  showRiverAttributes(null);
  paintActions();
  progress.hide();
  stages.hide();
  // Quiet when there is no AOI, so this cannot bounce back through the change handler below.
  aoi.clear();
  selectionChanged();
}

// ── styling ──────────────────────────────────────────────────────────────────
/**
 * Draw the network from the style spec. A no-op unless the styling toolchain is on the page *and*
 * the stream style is Standard — a forecast styleset owns the base layer while it is chosen.
 */
function applyStyle() {
  if (!styleActive || !stylePanel || !map) return;
  const spec = stylePanel.getSpec();
  const {highlight} = stylePanel.options();
  const names = namesOn ? namesStyle() : null;
  // `highlight: false`: the selection is drawn by its own layer above the network, so it survives a
  // forecast styleset. What the spec still reads the selection for is the scope, which fades every
  // reach outside it while a style is being tuned on one subset.
  applyStreamStyle(compileLayers(spec, {highlight: false, selection: currentSelection(), names}));
  setSelectionHighlightVisible(highlight);
  // The legend swatch has to be the colour the line on the map actually is. With the names mode on
  // the network no longer has one colour, so the swatch stands for the unnamed reaches — which the
  // mode leaves in the app's own blue precisely so that the network still reads as itself.
  const base = names ? activeUnnamed() : spec.base.color[0]?.value;
  if (base) document.documentElement.style.setProperty('--stream', base);
}

const selectionForStyle = () => (sel
  ? {outletId: sel.outletId, groupId: sel.groupId, count: sel.count}
  : null);

function selectionChanged() {
  stylePanel?.selectionChanged();
  applyStyle();
}

let countCost = 0;

function refreshCounts() {
  if (!stylePanel || countCost > 300) return;
  const layers = streamLayerIds();
  if (!layers.length) return;
  const t0 = performance.now();
  let feats;
  try {
    feats = map.queryRenderedFeatures({layers});
  } catch {
    return;
  }
  countCost = performance.now() - t0;
  const tally = new Map(layers.map(id => [id, 0]));
  for (const f of feats) tally.set(f.layer.id, (tally.get(f.layer.id) ?? 0) + 1);
  stylePanel.setCounts(tally);
}

/**
 * The forecast toolchain has changed which styleset draws the network. Standard is the one that
 * leaves it to the style spec; every other one paints the base layer from the forecast, so the
 * rules come off and the base layer is handed back.
 */
function setStyleset(styleset) {
  const wanted = stylingOn && styleset === 'standard';
  if (wanted === styleActive) return;
  styleActive = wanted;
  if (wanted) return applyStyle();
  clearStreamStyle();
  // The highlight switch is part of previewing a style, not a setting: whatever it was left at, the
  // selection is drawn again once the spec is no longer the thing drawing the network.
  setSelectionHighlightVisible(true);
  document.documentElement.style.removeProperty('--stream');
  repaintForecast();
}

// ── the selection methods ────────────────────────────────────────────────────
/**
 * Four things a click can mean, one at a time — four answers to the same question, not four features
 * that stack, so turning one on turns the others off.
 *
 *   river      the reach you clicked, and nothing else
 *   watershed  everything that drains to the reach you clicked
 *   aoi        the same, minus what came in from each inlet you then click
 *   multi      collect the watershed above the reach, and keep collecting
 *
 * River leads because it is the smallest answer; selecting a continent's drainage is the deliberate
 * act. It is also the one the rest of the app shares: a click in river mode still opens the charts
 * for that reach, where the other three are answering a question about the network instead.
 * Shift-click is the only exception: it collects a watershed without leaving the current method.
 */
const MODES = {
  browse: {card: 'browse', key: 'd'},
  river: {card: 'river-select', key: 'r'},
  watershed: {card: 'watershed', key: 'w'},
  aoi: {card: 'aoi', key: 'a'},
  multi: {card: 'picks', key: 'm'},
};

/** The two that select the reach they land on and nothing else — they differ only in the charts. */
const oneReach = m => m === 'browse' || m === 'river';

/** Multi-select is the one method that is remembered, because its collection is. */
let mode = picks.modeOn() ? 'multi' : 'browse';

/**
 * Give up what the method being left was holding, asking first when that is a real loss. River and
 * watershed hold nothing of their own; multi-select and the AOI accumulate and do not survive the
 * switch. Returns false when the answer is no, in which case the method does not change.
 */
async function leaveMode(prev) {
  if (prev === 'multi') {
    const n = picks.count();
    if (n > 1 && !await askConfirm({
      title: t('explorer.confirm.leaveMulti.title'),
      message: tn('explorer.confirm.leaveMulti', n),
      confirmKey: 'explorer.confirm.leaveAndClear',
    })) return false;
    picks.clear();
    return true;
  }
  if (prev === 'aoi') {
    const {inlets} = aoi.state();
    // No inlets is no AOI worth the name — the outlet is just the watershed selection, and it
    // carries over to whichever method is next rather than being thrown away.
    if (!inlets.length) return true;
    if (!await askConfirm({
      title: t('explorer.confirm.leaveAoi.title'),
      message: tn('explorer.confirm.leaveAoi', inlets.length),
      confirmKey: 'explorer.confirm.leaveAndClear',
    })) return false;
    aoi.clear();
    return true;
  }
  return true;
}

// One question at a time. The dialog is a promise now rather than a blocking `confirm()`, so a
// second click on another method row while the first is still being answered would ask twice and
// resolve into whichever order the answers came back in.
let switching = false;

async function setMode(next) {
  if (switching) return;
  const want = next in MODES ? next : 'river';
  const prev = mode;
  if (want !== prev) {
    switching = true;
    try {
      if (!await leaveMode(prev)) return;
    } finally {
      switching = false;
    }
  }
  mode = want;
  picks.setMode(mode === 'multi');
  paintModes();
  paintActions();
  // The same reach, read the other way. River and watershed are one click with two answers, so
  // switching between them repaints the map from what is already selected instead of leaving the
  // old answer on it until the next click.
  const between = m => oneReach(m) || m === 'watershed';
  if (sel && lastRec && mode !== prev && between(mode) && between(prev)) {
    const rec = mode === 'watershed' ? lastRec : reachOnlyRecord(lastRec);
    setSelection(rec, [{lo: rec.lo, hi: rec.hi}]);
  }
  // A watershed already selected is an AOI with no inlets yet, so it is adopted and the first click
  // goes to an inlet. A one-reach selection is not a watershed, so the AOI still asks for an outlet.
  if (mode === 'aoi' && sel && !sel.reachOnly && !aoi.state().outlet) {
    const {spans: _ignored, ...rec} = sel;
    aoi.setOutlet({...rec, count: rec.hi - rec.lo + 1});
  }
}

/**
 * A switch is a box: empty when off, checked when on. The words it used to carry said nothing the
 * row's own title does not, so they are the aria-label now and the box is what you read.
 */
function paintSwitch(btn, on) {
  if (on) btn.replaceChildren(heroIcon('check')); else btn.replaceChildren();
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', t(on ? 'explorer.mode.on' : 'explorer.mode.off'));
}

/** The four mode boxes and the class that tells the stylesheet which card is open. */
function paintModes() {
  for (const [name, {card}] of Object.entries(MODES)) {
    const on = name === mode;
    paintSwitch($(`${card}-mode`), on);
    $('panel').classList.toggle(`${card}-on`, on);
  }
}

// ── the AOI subsetter ────────────────────────────────────────────────────────
/**
 * "What drains to this reach that did not come in from up there" — one click for the outlet, then one
 * per inlet. aoi.js holds the state and the arithmetic; here is the mode, the click and the painting.
 */
/** What a click on a river means while the mode is on: the outlet first, then inlets. */
function aoiClick(at, lngLat) {
  let rec;
  try {
    rec = reachRecord(at);
  } catch (err) {
    return console.error(err);
  }
  const point = {lon: lngLat.lng, lat: lngLat.lat};
  const {outlet} = aoi.state();
  if (!outlet) {
    return aoi.setOutlet({...rec, ...point});
  }
  // A click below the outlet is not a failed inlet — it is the outlet moved down. The area only
  // grows, so the inlets stay where they were put and go on cutting the same ground.
  if (isDownstreamOf(rec, outlet)) {
    return aoi.setOutlet({...rec, ...point});
  }
  aoi.toggleInlet({...rec, ...point});
}

/** The AOI changed: repaint the card, the inlets on the map, and the selection it adds up to. */
function paintAoi() {
  const state = aoi.state();
  $('aoi-count').textContent = String(state.inlets.length);
  applyInlets(state.inlets.map(i => i.outletId));
  renderAoi($('aoi-body'), state, {
    onRemove: inlet => aoi.removeInlet(inlet.outletId),
    onZoom: inlet => flyToPick(inlet),
  });
  if (state.outlet) setSelection(state.outlet, state.spans);
  // The AOI was the selection, so dropping it drops that too. clearSelection() calls aoi.clear(),
  // which is already quiet by now, so this does not come back around.
  else if (sel) clearSelection();
}

// ── multi-select ─────────────────────────────────────────────────────────────
/**
 * A list of watersheds to hand to something else: deliberately additive, survives a reload, never
 * clears itself. Two ways in — the mode for a session of it, shift-click for a one-off.
 */
/** The list changed: repaint the map, the count beside the heading, and the rows. */
function paintPicks() {
  const list = picks.all();
  applyPicks(list);
  $('picks-count').textContent = String(list.length);
  renderPicks($('picks-body'), {
    onRemove: p => picks.remove(p.outletId),
    onZoom: p => flyToPick(p),
  });
  paintActions();
}

// ── map interactions ─────────────────────────────────────────────────────────
/**
 * A click on the map, before the forecast toolchain sees it.
 *
 * Returns true when the explorer has taken it: the four methods that are answering a question about
 * the network — a reach, a watershed, an area of interest, a collection — are not asking for a
 * reach's charts as well. The Data Browser returns false, so the click goes on to open them.
 */
function onMapClick(e, hit) {
  const p = hit?.properties;
  if (p?.riverId == null) return false;
  const mod = e.originalEvent;
  const additive = !!(mod && (mod.shiftKey || mod.metaKey || mod.ctrlKey));
  // Every field the tiles carry for that reach, whether or not a subset can be cut from it.
  showRiverAttributes(p);
  // With the AOI mode on, every click on a river belongs to the AOI — the outlet while there isn't
  // one, an inlet after that. A modified click is not an exception: while you are placing inlets,
  // a slipped modifier key should not tip you into collecting watersheds instead.
  if (mode === 'aoi') {
    aoiClick(p, e.lngLat);
    return true;
  }
  // The feature is the selection: outlet, index, upstream count and Group all come off it.
  const rec = selectOutlet(p);
  // A reach the tiles cannot describe a subset of is not a watershed, so it cannot be collected.
  if (rec && (mode === 'multi' || additive)) {
    // A modified click collects without switching methods — the one you noticed on the way past.
    picks.toggle({...rec, lon: e.lngLat.lng, lat: e.lngLat.lat});
  }
  return mode !== 'browse' || additive;
}

// ── the river names section ──────────────────────────────────────────────────
/**
 * Colouring the network by the river names table. A display switch, not a fifth selection method: it
 * never changes what a click means, which is why it is wired on its own.
 */
function paintNames() {
  const n = riverNames();
  $('names-count').textContent = n ? fmt(n.riverCount) : '';
}

function setNamesOn(on) {
  if (on && !riverNames()) return;
  namesOn = on;
  paintNamesMode();
  applyStyle();
}

/** The names card's own box — repainted on a language change without re-running the mode. */
function paintNamesMode() {
  paintSwitch($('names-mode'), namesOn);
  $('panel').classList.toggle('names-on', namesOn);
}

/** The guard the shortcut keys share: typing "n" into the styling editor stays typing. */
const typing = target =>
  target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName);

// ── boot ─────────────────────────────────────────────────────────────────────
/** The four selection methods, the actions over them and the river attributes under them. */
function initSelectionTools() {
  $('btn-explorer-clear').addEventListener('click', () => void clearCurrent());
  $('btn-copy').addEventListener('click', copyIds);
  $('btn-geoparquet').addEventListener('click', () => {
    if (!sel) return;
    setBusy(true);
    downloadGeometry({
      outletId: sel.outletId, lo: sel.lo, hi: sel.hi, count: sel.count,
      spans: sel.spans,
      // The group is in memory once an export has read the table, so say which one it was.
      onSettled: () => {
        setBusy(false);
        renderSelectionInfo();
      },
    });
  });

  aoi.onChange(paintAoi);
  picks.onChange(paintPicks);

  // The whole row is the switch, not just the box in it, because the rows are one control: you are
  // picking which of them a click on the map belongs to. A toolchain this build left out took its
  // row off the page with it, and the method goes with the row.
  for (const [name, {card}] of Object.entries(MODES)) {
    const head = $(`${card}-head`);
    if (!head) delete MODES[name];
    else head.addEventListener('click', () => void setMode(name));
  }
  if (!(mode in MODES)) mode = 'river';

  // The other way in, for a session spent on the map rather than in the panel. The key of the method
  // already on drops back to the river selector, so M stays the toggle it has always been.
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const key = e.key.toLowerCase();
    const hit = Object.entries(MODES).find(([, m]) => m.key === key);
    if (!hit) return;
    void setMode(mode === hit[0] ? 'river' : hit[0]);
  });

  showRiverAttributes(null);
  paintPicks();
  paintAoi();
  void setMode(mode);
}

/** The names colouring and the rule editor — everything that decides how the network is drawn. */
function initStylingTools() {
  // Both cards live in a dock rather than in the column: the rule editor is wider than the column
  // is, and while a style is being tuned the map is the thing to keep in view, not the controls.
  const toggleDock = () => {
    if (isDockOpen('styling')) return void closeDock(map, 'styling');
    void openDock(map, 'styling');
    // Nothing in the editor draws anything while a forecast styleset owns the network.
    wantStyleEditor();
  };
  $('btn-styling').addEventListener('click', toggleDock);
  $('styling-close').addEventListener('click', () => closeDock(map, 'styling'));

  $('names-mode').addEventListener('click', () => setNamesOn(!namesOn));
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key.toLowerCase() === 'n') setNamesOn(!namesOn);
  });

  // The switch cannot do anything until the table is here, so it says so rather than looking broken.
  $('names-mode').disabled = true;
  paintNames();
  loadRiverNames()
    .then(() => {
      $('names-mode').disabled = false;
      paintNames();
      // The copy on the device is good until the 5th of next month; this is what notices a session
      // that runs past it.
      watchRiverNames();
    })
    .catch(err => {
      namesError = err.message;
      console.warn('[names] riverNames.json could not be read', err);
      paintNames();
    });

  stylePanel = createStylePanel({
    mount: $('style-body'),
    onChange: applyStyle,
    selection: selectionForStyle,
    pmtiles: URLS.streamsPmtiles,
  });
  map.on('idle', refreshCounts);
  // The same archive the map draws from, opened through the shared protocol so the attribute list
  // is read off the copy the tiles already come through rather than a second one.
  const archive = new PMTiles(URLS.streamsPmtiles);
  protocol.add(archive);
  loadStreamAttributes(archive).then(info => stylePanel.setAttributes(info));
  registerStreamLayers(streamLayerIds);
}

/**
 * Wire whichever halves this build ships onto the map that already exists.
 *
 * `styleset` is what the forecast toolchain opens on, so the style spec knows from the start
 * whether the network is its to draw; `onRepaintNetwork` is what hands the base layer back when it
 * stops being.
 */
export function initExplorer({tools, styleset = 'standard', onRepaintNetwork = () => {},
                              onStyleEditor = () => {}} = {}) {
  selectionOn = !!tools?.hydrography;
  stylingOn = !!tools?.styling;
  repaintForecast = onRepaintNetwork;
  wantStyleEditor = onStyleEditor;

  attachExplorerLayers();
  if (selectionOn) initSelectionTools();
  if (stylingOn) initStylingTools();
  styleActive = stylingOn && styleset === 'standard';
  applyStyle();
  // The collection outlives the page, so whatever was restored is painted as soon as there is a
  // map to paint it on.
  if (selectionOn) applyPicks(picks.all());

  return {
    onMapClick,
    setStyleset,
    goToRiver,
    clearSelection,
    /** Everything walking [data-i18n] cannot reach, after the dictionary has been swapped. */
    repaint() {
      if (selectionOn) {
        paintModes();
        if (sel) renderSelectionInfo();
        showRiverAttributes(lastProps);
        paintPicks();
        paintAoi();
      }
      if (stylingOn) {
        paintNames();
        paintNamesMode();
        stylePanel?.repaint();
      }
    },
  };
}
