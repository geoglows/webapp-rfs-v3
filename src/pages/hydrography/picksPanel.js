import {button, el, fmt} from "../../shared/dom.js";
/**
 * The multi-select list: what has been collected.
 *
 * The rows are the working set — newest first, because the one you just clicked is the one you are
 * checking. Everything a row shows is the reason you would take it back off the list: which Group
 * it is in, how big the watershed is, what order the outlet is.
 *
 * Copying, downloading and clearing are not here: those are one button each at the head of the
 * column, shared by all four selection methods, because they mean the same thing in each of them.
 *
 * Built as nodes; the ids come out of the tiles, so nothing from the data becomes markup.
 */
import {MAX_PICKS, picks} from './picks.js';
import {t, tf, tn} from '../../shared/i18n/i18n.js';


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
  if (!list.length) {
    out.push(el('div', {class: 'picks-empty', text: t('explorer.picks.empty')}));
  } else {
    const rows = el('div', {class: 'picks-list'});
    list.forEach((p, i) => rows.append(pickRow(p, i, list.length, {onRemove, onZoom})));
    out.push(rows);
  }
  if (picks.full()) {
    out.push(el('div', {class: 'picks-empty', text: tf('explorer.picks.full', {n: fmt(MAX_PICKS)})}));
  }
  mount.replaceChildren(...out);
}
