/**
 * What is drawn on the map and what says so: the layer switches in the column, the basemap picker
 * over the map, and the legend in its corner. The basemap picker is shared with the data viewer in
 * shared/map/basemaps.js.
 *
 * The layer list lives here rather than in the markup because three things read it: the row that
 * switches a layer on, the legend row naming its colour, and the sync that greys out both when the
 * open dataset does not publish those tiles.
 */
import {layersPresent, layersVisible, map, setLayersVisible, setStreamsVisible,
  streamLayerIds} from './map.js';
import {initBasemapPicker} from '../../shared/map/basemaps.js';
import {$, el} from '../../shared/dom.js';
import {t} from '../../shared/i18n/i18n.js';

const LAYERS = [
  {
    // First, because it is the layer the app is about. `layers` is a function rather than a list:
    // the styled network is recompiled on every edit, so its ids are only knowable when asked — and
    // `onToggle` goes through map.js so the choice outlives those rebuilds.
    labelKey: 'layers.streams',
    layers: streamLayerIds,
    onToggle: setStreamsVisible,
    swatch: 'stream',
    titleKey: 'explorer.layers.streams.about',
  },
  {
    labelKey: 'explorer.layers.groups',
    layers: ['group-fill', 'group-line'],
    swatch: 'poly',
  },
  {
    labelKey: 'explorer.layers.basins',
    layers: ['basin-fill', 'basin-line'],
    swatch: 'poly basin',
    titleKey: 'explorer.layers.basins.about',
  },
  {
    labelKey: 'explorer.layers.catchments',
    layers: ['catchment-fill', 'catchment-outlet', 'catchment-line'],
    swatch: 'catchment',
    titleKey: 'explorer.layers.catchments.about',
  },
];

/** A layer entry's ids, which for the styled network can only be asked for, not stored. */
const layerIds = layer => (typeof layer.layers === 'function' ? layer.layers() : layer.layers);

/** Independent on/off switches — any number of the overlays can be drawn at once. */
function initLayerPicker() {
  const body = $('layers-body');
  const legend = $('legend-items');

  for (const layer of LAYERS) {
    // The switch: a checkbox, the name of the layer, and the colour it is drawn in. The whole row
    // is the label, so the name is as clickable as the box.
    const box = el('input', {type: 'checkbox'});
    const row = el('label', {class: 'legend-item'}, [
      box,
      el('span', {class: 'layer-name', 'data-i18n': layer.labelKey, text: t(layer.labelKey)}),
      el('span', {class: `swatch ${layer.swatch}`}),
    ]);
    box.addEventListener('change', () => {
      if (layer.onToggle) layer.onToggle(box.checked);
      else setLayersVisible(layerIds(layer), box.checked);
      syncLayerPicker();
    });
    body.append(row);

    // The legend row for the same layer, hidden until the layer is on: a colour is worth naming
    // only while there is something on the map wearing it.
    const legendRow = el('div', {class: 'legend-item hidden'}, [
      el('span', {class: `swatch ${layer.swatch}`}),
      el('span', {'data-i18n': layer.labelKey, text: t(layer.labelKey)}),
    ]);
    if (layer.titleKey) legendRow.setAttribute('data-i18n-title', layer.titleKey);
    legend.append(legendRow);

    layer.box = box;
    layer.row = row;
    layer.legendRow = legendRow;
  }
}

/** Point the switches and legend at what the map is actually drawing — a layer the open dataset does
 * not publish cannot be switched on however often it is clicked. */
export function syncLayerPicker() {
  for (const layer of LAYERS) {
    const ids = layerIds(layer);
    const present = layersPresent(ids);
    const on = present && layersVisible(ids);
    layer.box.checked = on;
    layer.box.disabled = !present;
    layer.row.classList.toggle('unavailable', !present);
    // Not data-i18n-title: the row's tooltip is two sentences joined only when the layer is
    // missing, so it is written here and rewritten by the language picker's repaint.
    layer.row.title = [
      layer.titleKey ? t(layer.titleKey) : null,
      present ? null : t('explorer.layers.missing'),
    ].filter(Boolean).join('\n\n');
    layer.legendRow.classList.toggle('hidden', !on);
  }
}

export function initMapControls() {
  initLayerPicker();
  // A getter, not the map: this runs before initMap() has built one — see the call site.
  initBasemapPicker(() => map);
  syncLayerPicker();
}
