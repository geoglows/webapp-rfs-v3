/**
 * mercator.ts — plate-carrée -> Web-Mercator row remap.
 *
 * MapLibre positions an image/canvas source by its corner coordinates in Mercator
 * space and samples it linearly. A 1° geographic tile painted with equal-latitude
 * rows therefore misregisters mid-tile (~200 m at 40°N over a full degree). The fix:
 * paint an output canvas whose rows are equally spaced in MERCATOR Y between the
 * tile's north and south edges, sampling the nearest source (geographic) row.
 */
export function buildMercatorRowMap(
  north: number,
  south: number,
  nrowsSrc: number,
  nrowsOut: number,
): Int32Array {
  const mercY = (latDeg: number): number => {
    const phi = (latDeg * Math.PI) / 180
    return Math.log(Math.tan(Math.PI / 4 + phi / 2))
  }
  const yN = mercY(north)
  const yS = mercY(south)
  const map = new Int32Array(nrowsOut)
  for (let r = 0; r < nrowsOut; r++) {
    // mercator Y at this output row's center, north -> south
    const y = yN + ((r + 0.5) / nrowsOut) * (yS - yN)
    const lat = ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI
    // source row for this latitude (equal-degree rows, north edge = row 0)
    let src = Math.floor(((north - lat) / (north - south)) * nrowsSrc)
    if (src < 0) src = 0
    if (src >= nrowsSrc) src = nrowsSrc - 1
    map[r] = src
  }
  return map
}
