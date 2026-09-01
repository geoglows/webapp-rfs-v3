import {el} from "../dom.js";
/**
 * Every attribute the tiles carry for a clicked reach, under the same labels, units and notes the
 * styling panel uses and in the same order: measures, then categories, then identifiers. The order is
 * the grouping — no headings, because the rows are the list you scan. Built as nodes, so nothing
 * coming out of the tiles becomes markup.
 */
import {fieldInfo, roleRank} from './streamAttributes.js';

const isNum = v => typeof v === 'number' && isFinite(v);

/** Exactly what the tiles carry, with the unit after it. Nothing is rounded, abbreviated or
 * re-based: an attribute you cannot read the real value off is not worth printing. */
function valueOf(name, v, info) {
  if (v == null || v === '') return {text: '—', title: `${name} is not set on this reach`};
  const unit = isNum(v) && info.unit ? ` ${info.unit}` : '';
  const text = `${v}${unit}`;
  return {text, title: `${name} = ${text}`};
}

function row(name, v) {
  const info = fieldInfo(name, typeof v === 'string' ? 'string' : 'number');
  const {text, title} = valueOf(name, v, info);
  const r = el('div', {class: `river-row river-${info.role}`});
  const key = el('span', {class: 'river-k', text: info.label});
  key.title = info.note ? `${name} — ${info.note}` : name;
  const val = el('span', {class: 'river-v', text: text});
  val.title = title;
  r.append(key, val);
  return r;
}

/** Repaint the panel for one feature's properties, in the styling panel's field order so the same
 * attribute sits in the same place in both. `props` is null until something has been clicked. */
export function renderRiverAttributes(mount, props) {
  if (props == null) return mount.replaceChildren();
  const names = Object.keys(props).sort((a, b) => {
    const ia = fieldInfo(a, typeof props[a] === 'string' ? 'string' : 'number');
    const ib = fieldInfo(b, typeof props[b] === 'string' ? 'string' : 'number');
    return (roleRank(ia.role) - roleRank(ib.role)) || ia.label.localeCompare(ib.label);
  });
  const out = [];
  for (const name of names) out.push(row(name, props[name]));
  mount.replaceChildren(...out);
}
