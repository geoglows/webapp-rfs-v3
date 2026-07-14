/**
 * geotiff.ts — minimal, dependency-free GeoTIFF writer for the flood raster.
 *
 * Emits a single-band, uncompressed, little-endian baseline TIFF carrying the
 * GeoTIFF GeoKey tags for a north-up EPSG:4326 (geographic / plate-carrée) grid.
 * That is exactly the frame the flood kernel computes in — row 0 = north edge,
 * equal-degree latitude rows, col 0 = west edge — so the worker's grid maps to
 * TIFF pixel order (top-to-bottom, left-to-right) with no reprojection. The
 * on-screen canvas is Web-Mercator-remapped for MapLibre's linear image
 * sampling; this file deliberately exports the *geographic* grid, which is the
 * correct source for a GeoTIFF.
 *
 * Scope is intentionally narrow (what this app emits): one uint8 sample per
 * pixel, a single strip, PixelIsArea. It is not a general TIFF encoder.
 */

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

export interface ExtentGeoTiffInput {
  width: number        // ncols
  height: number       // nrows
  bounds: Bounds       // geographic extent, EPSG:4326
  data: Uint8Array     // row-major, row 0 = north edge; length width*height
  software?: string    // written to the Software tag (305) for provenance
}

// TIFF field-type codes used here
const T_ASCII = 2
const T_SHORT = 3
const T_LONG = 4
const T_DOUBLE = 12

const even = (n: number): number => (n + 1) & ~1

/**
 * ASCII value as a NUL-terminated, even-length byte block (TIFF requires even
 * offsets). `count` is the logical length (string + the single NUL terminator);
 * `block` may carry one extra pad byte to reach an even length.
 */
function asciiz(s: string): { block: Uint8Array; count: number } {
  const bytes = new TextEncoder().encode(s)
  const count = bytes.length + 1               // includes the NUL terminator
  const block = new Uint8Array(even(count))    // padded to even; trailing bytes are 0
  block.set(bytes)
  return { block, count }
}

/**
 * Encode a binary flood-extent grid (1 = flooded, 0 = dry) as a georeferenced
 * single-band uint8 GeoTIFF. Returns the file bytes ready to download.
 */
export function encodeExtentGeoTiff(input: ExtentGeoTiffInput): ArrayBuffer {
  const { width, height, bounds, data } = input
  if (data.length !== width * height) {
    throw new Error(`data length ${data.length} != width*height ${width * height}`)
  }

  const software = asciiz(input.software ?? 'rfs-v3-app FLDPLN flood extent')

  // GeoKey directory (all values inline in the key entries → SHORT array).
  // header: dirVersion=1, keyRevision=1, minorRevision=0, numberOfKeys=4
  const geoKeys = new Uint16Array([
    1, 1, 0, 4,
    1024, 0, 1, 2,     // GTModelTypeGeoKey        = ModelTypeGeographic
    1025, 0, 1, 1,     // GTRasterTypeGeoKey       = RasterPixelIsArea
    2048, 0, 1, 4326,  // GeographicTypeGeoKey     = GCS_WGS_84
    2054, 0, 1, 9102,  // GeogAngularUnitsGeoKey   = Angular_Degree
  ])
  const pixelScale = new Float64Array([
    (bounds.east - bounds.west) / width,    // ScaleX  (deg/px, positive)
    (bounds.north - bounds.south) / height, // ScaleY  (deg/px, positive; applied as −Y)
    0,
  ])
  // raster point (0,0,0) → model (west, north, 0): NW corner of the top-left pixel
  const tiePoint = new Float64Array([0, 0, 0, bounds.west, bounds.north, 0])

  const NTAGS = 14
  const ifdOffset = 8
  const ifdLen = 2 + NTAGS * 12 + 4 // entry count + entries + next-IFD pointer
  let heap = even(ifdOffset + ifdLen)

  // Lay out the out-of-line blocks (each begins on an even offset).
  const geoKeyOff = heap;      heap = even(heap + geoKeys.byteLength)
  const pixelScaleOff = heap;  heap = even(heap + pixelScale.byteLength)
  const tiePointOff = heap;    heap = even(heap + tiePoint.byteLength)
  const softwareOff = heap;    heap = even(heap + software.block.byteLength)
  const pixelOff = heap
  const total = pixelOff + data.byteLength

  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)

  // ---- TIFF header (little-endian) ----
  dv.setUint16(0, 0x4949, true)  // 'II'
  dv.setUint16(2, 42, true)      // magic
  dv.setUint32(4, ifdOffset, true)

  // ---- IFD ----
  let p = ifdOffset
  dv.setUint16(p, NTAGS, true); p += 2
  // one 12-byte entry; `value` is either an inline scalar (SHORT/LONG count 1) or an offset
  const tag = (id: number, type: number, count: number, value: number): void => {
    dv.setUint16(p, id, true)
    dv.setUint16(p + 2, type, true)
    dv.setUint32(p + 4, count, true)
    if (type === T_SHORT && count === 1) dv.setUint16(p + 8, value, true)
    else dv.setUint32(p + 8, value, true) // LONG scalar, or heap offset
    p += 12
  }
  // Entries MUST be in ascending tag-id order.
  tag(256, T_LONG, 1, width)         // ImageWidth
  tag(257, T_LONG, 1, height)        // ImageLength
  tag(258, T_SHORT, 1, 8)            // BitsPerSample
  tag(259, T_SHORT, 1, 1)            // Compression = none
  tag(262, T_SHORT, 1, 1)            // PhotometricInterpretation = BlackIsZero
  tag(273, T_LONG, 1, pixelOff)      // StripOffsets
  tag(277, T_SHORT, 1, 1)            // SamplesPerPixel
  tag(278, T_LONG, 1, height)        // RowsPerStrip (single strip)
  tag(279, T_LONG, 1, data.byteLength) // StripByteCounts
  tag(305, T_ASCII, software.count, softwareOff) // Software (count includes NUL)
  tag(339, T_SHORT, 1, 1)            // SampleFormat = unsigned integer
  tag(33550, T_DOUBLE, 3, pixelScaleOff)         // ModelPixelScaleTag
  tag(33922, T_DOUBLE, 6, tiePointOff)           // ModelTiepointTag
  tag(34735, T_SHORT, geoKeys.length, geoKeyOff) // GeoKeyDirectoryTag
  // (keep NTAGS in sync with the number of tag() calls above)
  dv.setUint32(p, 0, true); p += 4  // next IFD = 0 (last)

  // ---- out-of-line blocks ----
  new Uint8Array(buf, geoKeyOff, geoKeys.byteLength).set(new Uint8Array(geoKeys.buffer))
  new Uint8Array(buf, pixelScaleOff, pixelScale.byteLength).set(new Uint8Array(pixelScale.buffer))
  new Uint8Array(buf, tiePointOff, tiePoint.byteLength).set(new Uint8Array(tiePoint.buffer))
  new Uint8Array(buf, softwareOff, software.block.byteLength).set(software.block)

  // ---- pixel data (single strip, same order as `data`) ----
  new Uint8Array(buf, pixelOff, data.byteLength).set(data)

  return buf
}