const T_ASCII = 2;
const T_SHORT = 3;
const T_LONG = 4;
const T_DOUBLE = 12;
const even = (n) => n + 1 & ~1;

function asciiz(s) {
  const bytes = new TextEncoder().encode(s);
  const count = bytes.length + 1;
  const block = new Uint8Array(even(count));
  block.set(bytes);
  return {block, count};
}

function encodeExtentGeoTiff(input) {
  const {width, height, bounds, data} = input;
  if (data.length !== width * height) {
    throw new Error(`data length ${data.length} != width*height ${width * height}`);
  }
  const software = asciiz(input.software ?? "RFS v3 FLDPLN flood extent");
  const geoKeys = new Uint16Array([
    1,
    1,
    0,
    4,
    1024,
    0,
    1,
    2,
    // GTModelTypeGeoKey        = ModelTypeGeographic
    1025,
    0,
    1,
    1,
    // GTRasterTypeGeoKey       = RasterPixelIsArea
    2048,
    0,
    1,
    4326,
    // GeographicTypeGeoKey     = GCS_WGS_84
    2054,
    0,
    1,
    9102
    // GeogAngularUnitsGeoKey   = Angular_Degree
  ]);
  const pixelScale = new Float64Array([
    (bounds.east - bounds.west) / width,
    // ScaleX  (deg/px, positive)
    (bounds.north - bounds.south) / height,
    // ScaleY  (deg/px, positive; applied as −Y)
    0
  ]);
  const tiePoint = new Float64Array([0, 0, 0, bounds.west, bounds.north, 0]);
  const NTAGS = 14;
  const ifdOffset = 8;
  const ifdLen = 2 + NTAGS * 12 + 4;
  let heap = even(ifdOffset + ifdLen);
  const geoKeyOff = heap;
  heap = even(heap + geoKeys.byteLength);
  const pixelScaleOff = heap;
  heap = even(heap + pixelScale.byteLength);
  const tiePointOff = heap;
  heap = even(heap + tiePoint.byteLength);
  const softwareOff = heap;
  heap = even(heap + software.block.byteLength);
  const pixelOff = heap;
  const total = pixelOff + data.byteLength;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  dv.setUint16(0, 18761, true);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOffset, true);
  let p = ifdOffset;
  dv.setUint16(p, NTAGS, true);
  p += 2;
  const tag = (id, type, count, value) => {
    dv.setUint16(p, id, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    if (type === T_SHORT && count === 1) dv.setUint16(p + 8, value, true);
    else dv.setUint32(p + 8, value, true);
    p += 12;
  };
  tag(256, T_LONG, 1, width);
  tag(257, T_LONG, 1, height);
  tag(258, T_SHORT, 1, 8);
  tag(259, T_SHORT, 1, 1);
  tag(262, T_SHORT, 1, 1);
  tag(273, T_LONG, 1, pixelOff);
  tag(277, T_SHORT, 1, 1);
  tag(278, T_LONG, 1, height);
  tag(279, T_LONG, 1, data.byteLength);
  tag(305, T_ASCII, software.count, softwareOff);
  tag(339, T_SHORT, 1, 1);
  tag(33550, T_DOUBLE, 3, pixelScaleOff);
  tag(33922, T_DOUBLE, 6, tiePointOff);
  tag(34735, T_SHORT, geoKeys.length, geoKeyOff);
  dv.setUint32(p, 0, true);
  p += 4;
  new Uint8Array(buf, geoKeyOff, geoKeys.byteLength).set(new Uint8Array(geoKeys.buffer));
  new Uint8Array(buf, pixelScaleOff, pixelScale.byteLength).set(new Uint8Array(pixelScale.buffer));
  new Uint8Array(buf, tiePointOff, tiePoint.byteLength).set(new Uint8Array(tiePoint.buffer));
  new Uint8Array(buf, softwareOff, software.block.byteLength).set(software.block);
  new Uint8Array(buf, pixelOff, data.byteLength).set(data);
  return buf;
}

export {
  encodeExtentGeoTiff
};
