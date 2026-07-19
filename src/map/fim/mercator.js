function buildMercatorRowMap(north, south, nrowsSrc, nrowsOut) {
  const mercY = (latDeg) => {
    const phi = latDeg * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + phi / 2));
  };
  const yN = mercY(north);
  const yS = mercY(south);
  const map = new Int32Array(nrowsOut);
  for (let r = 0; r < nrowsOut; r++) {
    const y = yN + (r + 0.5) / nrowsOut * (yS - yN);
    const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
    let src = Math.floor((north - lat) / (north - south) * nrowsSrc);
    if (src < 0) src = 0;
    if (src >= nrowsSrc) src = nrowsSrc - 1;
    map[r] = src;
  }
  return map;
}

export {
  buildMercatorRowMap
};
