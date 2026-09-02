import {urls} from 'riverforecastsystem/v3';

// The data root is settled once in the shared module; importing it here is what runs
// configure() before the urls.* reads below. Build-time only, deliberately: a query-string data root
// would be a link that repoints every byte the map draws at an origin the sender chose.
import {V3_BASE} from '../settings/rfsConfig.js';

export {V3_BASE};

export const URLS = {
  streamsPmtiles: urls.streamsPmtiles(),
  catchmentsPmtiles: urls.catchmentsPmtiles(),
  groupsPmtiles: urls.groupsPmtiles(),
  // HydroBASINS sits beside the hydrography rather than inside a group: it is reference geography,
  // not something the v3 pipeline partitions.
  basinsPmtiles: `${V3_BASE}/hydrobasins_level2.pmtiles`,
  // One row per river, in riverIndex order, and the only place a reach's publication group is
  // written down — the stream tiles do not carry one. See groups.js.
  metadata: urls.hydrographyMetadataParquet(),
  streams: g => urls.streamsGeoparquet({group: g}),
  catchments: g => urls.catchmentsGeoparquet({group: g}),
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
