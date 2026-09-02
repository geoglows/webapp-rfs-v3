import {button, el, fmt} from "../dom.js";
import {MAX_PICKS, picks} from './picks.js';
import {tf, tn} from '../i18n/i18n.js';


function pickRow(p, i, total, {onRemove, onZoom}) {
  const row = el('div', {class: 'pick-row'});
  const n = el('span', {class: 'pick-n', text: String(total - i)});
  const id = el('span', {class: 'pick-id', text: String(p.outletId)});
  const meta = el('span', {class: 'pick-meta', text: [
    p.groupId != null ? `group ${p.groupId}` : null,
    tn('explorer.picks.reaches', p.count),
    p.strahlerOrder != null ? `ord ${p.strahlerOrder}` : null,
  ].filter(Boolean).join(' · ')});
  const box = el('div', {class: 'pick-main'});
  box.append(id, meta);
  row.append(n, box);
  if (p.lon != null && p.lat != null) {
    row.append(button({class: 'btn mini', text: '⤢', title: tf('explorer.picks.centre', {id: p.outletId}), onclick: () => onZoom(p)}));
  }
  row.append(button({class: 'btn mini danger', text: '×', title: tf('explorer.picks.remove', {id: p.outletId}), onclick: () => onRemove(p)}));
  return row;
}

/** Repaint the whole body for the current list. */
export function renderPicks(mount, {onRemove, onZoom}) {
  const list = picks.all();
  const out = [];
  if (list.length) {
    const rows = el('div', {class: 'picks-list'});
    list.forEach((p, i) => rows.append(pickRow(p, i, list.length, {onRemove, onZoom})));
    out.push(rows);
  }
  if (picks.full()) {
    out.push(el('div', {class: 'picks-empty', text: tf('explorer.picks.full', {n: fmt(MAX_PICKS)})}));
  }
  mount.replaceChildren(...out);
}
