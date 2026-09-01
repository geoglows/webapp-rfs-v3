import {urls} from 'riverforecastsystem/v3';

// The data root is settled once for both pages in the shared module; importing it here is what runs
// configure() before the urls.* reads below. Build-time only, deliberately: a query-string data root
// would be a link that repoints every byte the map draws at an origin the sender chose.
import {V3_BASE} from '../../shared/settings/rfsConfig.js';

export {V3_BASE};

const group = g => urls.hydrographyGroup({group: g});

export const URLS = {
  streamsPmtiles: urls.streamsPmtiles(),
  catchmentsPmtiles: `${group(0)}/catchments.pmtiles`,
  groupsPmtiles: `${group(0)}/groups.pmtiles`,
  // HydroBASINS sits beside the hydrography rather than inside a group: it is reference geography,
  // not something the v3 pipeline partitions.
  basinsPmtiles: `${V3_BASE}/hydrobasins_level2.pmtiles`,
  streams: g => `${group(g)}/streams_${g}.geo.parquet`,
  catchments: g => `${group(g)}/catchments_${g}.geo.parquet`,
};

export const MIN_ZOOM = 0;
export const MAX_ZOOM = 16;
export const ZOOM_STEP = 0.5;
export const TILE_ORDER_LADDER = [
  {zoom: 0, minOrder: 7},
  {zoom: 5, minOrder: 6},
  {zoom: 7, minOrder: 4},
  {zoom: 9, minOrder: 2},
];

/** Which zoom a reach of this Strahler order first appears at, per the ladder above. */
export const firstZoomForOrder = order => {
  const hit = TILE_ORDER_LADDER.find(step => order >= step.minOrder);
  return hit ? hit.zoom : null;
};
