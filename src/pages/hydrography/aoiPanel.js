import {el, button} from "../../shared/dom.js";
/**
 * The AOI subsetter's readout: where the outlet is, what the inlets took off, and how much is left.
 *
 * Every row is a reason to take an inlet back off — which reach it is, and how much of the AOI it
 * is holding back — because that is the only decision left once the outlet is placed. Clearing is
 * the column's one Clear button, shared with the other three methods.
 *
 * Built as nodes; the ids come out of the tiles, so nothing from the data becomes markup.
 */
import {inletCut} from './aoi.js';
import {fmt} from './ui.js';

/** How many reaches this inlet is keeping out, on its own terms — before any overlap with others. */
const cutSize = inlet => {
  const cut = inletCut(inlet);
  return cut.hi - cut.lo + 1;
};

function inletRow(inlet, {onRemove, onZoom}) {
  const row = el('div', {class: 'pick-row'});
  const main = el('div', {class: 'pick-main'});
  main.append(
    el('span', {class: 'pick-id', text: String(inlet.outletId)}),
    el('span', {class: 'pick-meta', text: [
      `−${fmt(cutSize(inlet))} reaches`,
      inlet.strahlerOrder != null ? `ord ${inlet.strahlerOrder}` : null,
    ].filter(Boolean).join(' · ')}),
  );
  row.append(el('span', {class: 'pick-n', text: '↧'}), main);
  if (inlet.lon != null && inlet.lat != null) {
    row.append(button({class: 'mini', text: '⤢', title: `Centre the map on ${inlet.outletId}`, onclick: () => onZoom(inlet)}));
  }
  row.append(button({class: 'mini danger', text: '×', title: `Put ${inlet.outletId} and the ground above it back in the AOI`, onclick: () => onRemove(inlet)}));
  return row;
}

/** Repaint the whole body for the current state. */
export function renderAoi(mount, state, {onRemove, onZoom}) {
  const {outlet, inlets, count, trimmed} = state;
  const out = [];

  if (!outlet) {
    out.push(el('div', {class: 'picks-empty', text: 'Click the outlet of your area of interest.'}));
    mount.replaceChildren(...out);
    return;
  }

  const head = el('div', {class: 'aoi-head'});
  head.append(
    el('span', {class: 'aoi-k', text: 'outlet'}),
    el('span', {class: 'aoi-outlet', text: String(outlet.outletId)}),
    el('span', {class: 'pick-meta', text: `${fmt(count)} of ${fmt(outlet.count)} reaches kept`}),
  );
  out.push(head);

  if (!inlets.length) {
    out.push(el('div', {class: 'picks-empty', text: 'No inlets yet — the AOI is the whole watershed.'}));
  } else {
    const rows = el('div', {class: 'picks-list'});
    for (const inlet of inlets) rows.append(inletRow(inlet, {onRemove, onZoom}));
    out.push(rows);
    out.push(el('div', {class: 'picks-empty', text: `${fmt(inlets.length)} inlet${inlets.length === 1 ? '' : 's'} · ${fmt(trimmed)} reaches trimmed off.`}));
  }

  mount.replaceChildren(...out);
}
