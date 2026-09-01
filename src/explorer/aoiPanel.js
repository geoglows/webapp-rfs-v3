import {button, el, fmt} from "../dom.js";
/**
 * The AOI readout: where the outlet is, what the inlets took off, how much is left. Every row is a
 * reason to take an inlet back off, the only decision left once the outlet is placed. Built as nodes,
 * so nothing coming out of the tiles becomes markup.
 */
import {inletCut} from './aoi.js';
import {t, tf, tn} from '../i18n/i18n.js';


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
      `−${tn('explorer.picks.reaches', cutSize(inlet))}`,
      inlet.strahlerOrder != null ? `ord ${inlet.strahlerOrder}` : null,
    ].filter(Boolean).join(' · ')}),
  );
  row.append(el('span', {class: 'pick-n', text: '↧'}), main);
  if (inlet.lon != null && inlet.lat != null) {
    row.append(button({class: 'btn mini', text: '⤢', title: tf('explorer.picks.centre', {id: inlet.outletId}), onclick: () => onZoom(inlet)}));
  }
  row.append(button({class: 'btn mini danger', text: '×', title: tf('explorer.aoi.removeInlet', {id: inlet.outletId}), onclick: () => onRemove(inlet)}));
  return row;
}

/** Repaint the whole body for the current state. */
export function renderAoi(mount, state, {onRemove, onZoom}) {
  const {outlet, inlets, count, trimmed} = state;
  const out = [];

  if (!outlet) {
    out.push(el('div', {class: 'picks-empty', text: t('explorer.aoi.pickOutlet')}));
    mount.replaceChildren(...out);
    return;
  }

  const head = el('div', {class: 'aoi-head'});
  head.append(
    el('span', {class: 'aoi-k', text: t('explorer.readout.outlet')}),
    el('span', {class: 'aoi-outlet', text: String(outlet.outletId)}),
    el('span', {class: 'pick-meta', text: tf('explorer.aoi.kept', {n: fmt(count), total: fmt(outlet.count)})}),
  );
  out.push(head);

  if (!inlets.length) {
    out.push(el('div', {class: 'picks-empty', text: t('explorer.aoi.noInlets')}));
  } else {
    const rows = el('div', {class: 'picks-list'});
    for (const inlet of inlets) rows.append(inletRow(inlet, {onRemove, onZoom}));
    out.push(rows);
    out.push(el('div', {class: 'picks-empty', text: `${tn('explorer.aoi.inlets', inlets.length)} · ${tf('explorer.aoi.trimmed', {n: fmt(trimmed)})}`}));
  }

  mount.replaceChildren(...out);
}
