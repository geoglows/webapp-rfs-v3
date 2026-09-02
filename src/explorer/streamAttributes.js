import {firstZoomForOrder, TILE_ORDER_LADDER} from './config.js';
import {t, tf} from '../i18n/i18n.js';

export const SOURCE_LAYER = 'streams';

/**
 * What the app knows about the fields the tiles carry. The name is also the i18n key:
 * `explorer.attr.<name>` is the label and `.note` the sentence under it, so a field is documented by
 * being listed here and translated in the locale files. `note: true` says the field has one; `note`
 * as a function is a sentence with numbers from the tile ladder in it.
 */
const LADDER = () => [
  tf('explorer.attr.ladder.first',
    {order: TILE_ORDER_LADDER[0].minOrder, zoom: TILE_ORDER_LADDER[1].zoom}),
  ...TILE_ORDER_LADDER.slice(1).map(s => tf('explorer.attr.ladder.next', {order: s.minOrder, zoom: s.zoom})),
].join(', ');

const KNOWN = {
  strahlerOrder: {role: 'measure', note: () => tf('explorer.attr.strahlerOrder.note', {ladder: LADDER()})},
  shreveOrder: {role: 'measure', note: true},
  DSContArea: {role: 'measure', unit: 'm²', note: true},
  areaM2: {role: 'measure', unit: 'm²', note: true},
  Length: {role: 'measure', unit: 'm'},
  TDXHydroRegion: {role: 'category'},
  groupId: {role: 'category', note: true},
  riverId: {role: 'identity'},
  nextRiverId: {role: 'identity', note: true},
  outletRiverId: {role: 'identity', note: true},
  riverIndex: {role: 'identity', note: true},
  upstreamCount: {role: 'measure', note: true},
};

const ROLE_ORDER = {measure: 0, category: 1, identity: 2};

/** A known field's label, or the raw field name for one the app has never heard of. */
const labelOf = name => (KNOWN[name] ? t(`explorer.attr.${name}`) : name);

/** A known field's explanatory line, or "" for a field that has none. */
const noteOf = (name) => {
  const note = KNOWN[name]?.note;
  if (!note) return '';
  return typeof note === 'function' ? note() : t(`explorer.attr.${name}.note`);
};

/** What the app knows about one field name, with a sane fallback for a field it has never seen. */
export const fieldInfo = (name, type = 'number') => ({
  label: labelOf(name),
  unit: KNOWN[name]?.unit ?? '',
  note: noteOf(name),
  role: KNOWN[name]?.role ?? (type === 'string' ? 'category' : 'measure'),
});

export const roleRank = role => ROLE_ORDER[role] ?? 3;

function suggestedThreshold({type, min, max, values}) {
  if (type === 'string') return values?.[0] ?? '';
  if (min == null || max == null) return 0;
  if (max - min <= 12) return Math.max(min, Math.round((min + max) / 2));
  const mid = (min > 0 && max / Math.max(min, 1e-9) > 100)
    ? Math.sqrt(min * max)
    : (min + max) / 2;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(mid) || 1));
  return Math.round(mid / mag) * mag;
}

/** Merge `vector_layers[].fields` (names + types) with tilestats (ranges + distinct values). */
function build(fields, stats) {
  const byName = new Map((stats?.attributes ?? []).map(a => [a.attribute, a]));
  const names = new Set([...Object.keys(fields ?? {}), ...byName.keys()]);
  return [...names].map(name => {
    const s = byName.get(name);
    const declared = String(fields?.[name] ?? s?.type ?? 'number').toLowerCase();
    const type = declared === 'string' ? 'string' : declared === 'boolean' ? 'boolean' : 'number';
    const attr = {
      name,
      type,
      unit: KNOWN[name]?.unit ?? '',
      role: KNOWN[name]?.role ?? (type === 'string' ? 'category' : 'measure'),
      min: s?.min ?? null,
      max: s?.max ?? null,
      values: type === 'string' ? (s?.values ?? []).map(String).sort() : [],
    };
    // Read rather than stored: the panel is built once from the tile metadata and lives for the
    // session, so a label baked in here would stay in whichever language the tiles happened to
    // load in. Nothing spreads these objects, so the accessors survive every call site.
    Object.defineProperties(attr, {
      label: {get: () => labelOf(name), enumerable: true},
      note: {get: () => noteOf(name), enumerable: true},
    });
    attr.suggested = suggestedThreshold(attr);
    return attr;
  }).sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || a.label.localeCompare(b.label));
}

export async function loadStreamAttributes(archive) {
  try {
    const md = await archive.getMetadata();
    const layer = (md.vector_layers ?? []).find(l => l.id === SOURCE_LAYER) ?? md.vector_layers?.[0];
    const stats = (md.tilestats?.layers ?? []).find(l => l.layer === SOURCE_LAYER) ?? md.tilestats?.layers?.[0];
    const attributes = build(layer?.fields, stats);
    if (!attributes.length) return {attributes: [], error: t('explorer.attr.none')};
    return {
      attributes,
      minzoom: layer?.minzoom ?? md.minzoom ?? 0,
      maxzoom: layer?.maxzoom ?? md.maxzoom ?? null,
      reachCount: stats?.count ?? null,
    };
  } catch (err) {
    console.warn('[style] could not read tile attributes', err);
    return {attributes: [], error: err.message};
  }
}

export function orderVisibilityWarning(condition, minZoom) {
  if (condition?.attribute !== 'strahlerOrder') return null;
  const order = Number(condition.value);
  if (!isFinite(order) || !['>=', '>', '==', 'between'].includes(condition.op)) return null;
  const wanted = condition.op === '>' ? order + 1 : order;
  const from = firstZoomForOrder(wanted);
  if (from == null) return tf('explorer.attr.orderNeverDrawn', {order: wanted});
  if (from > (minZoom ?? 0)) return tf('explorer.attr.orderFromZoom', {order: wanted, zoom: from});
  return null;
}
