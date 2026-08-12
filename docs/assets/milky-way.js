(function attachMilkyWay(globalScope) {
  "use strict";

  const DEG_TO_RAD = Math.PI / 180;
  const RAD_TO_DEG = 180 / Math.PI;

  // IAU J2000 equatorial-to-galactic rotation matrix.
  const EQ_TO_GAL = Object.freeze([
    Object.freeze([-0.0548755604, -0.8734370902, -0.4838350155]),
    Object.freeze([0.4941094279, -0.4448296300, 0.7469822445]),
    Object.freeze([-0.8676661490, -0.1980763734, 0.4559837762]),
  ]);

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
  }

  function angularDistanceDeg(left, right) {
    return Math.abs(((left - right + 180) % 360 + 360) % 360 - 180);
  }

  function gaussianAngular(longitudeDeg, centerDeg, sigmaDeg) {
    const distance = angularDistanceDeg(longitudeDeg, centerDeg);
    return Math.exp(-0.5 * (distance / sigmaDeg) ** 2);
  }

  function equatorialToGalactic(raDeg, decDeg) {
    const ra = Number(raDeg) * DEG_TO_RAD;
    const dec = Number(decDeg) * DEG_TO_RAD;
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
    const cosDec = Math.cos(dec);
    const x = cosDec * Math.cos(ra);
    const y = cosDec * Math.sin(ra);
    const z = Math.sin(dec);
    const galacticX = EQ_TO_GAL[0][0] * x + EQ_TO_GAL[0][1] * y + EQ_TO_GAL[0][2] * z;
    const galacticY = EQ_TO_GAL[1][0] * x + EQ_TO_GAL[1][1] * y + EQ_TO_GAL[1][2] * z;
    const galacticZ = EQ_TO_GAL[2][0] * x + EQ_TO_GAL[2][1] * y + EQ_TO_GAL[2][2] * z;
    return {
      longitudeDeg: normalizeDegrees(Math.atan2(galacticY, galacticX) * RAD_TO_DEG),
      latitudeDeg: Math.asin(clamp(galacticZ, -1, 1)) * RAD_TO_DEG,
    };
  }

  function intensityAtGalactic(longitudeDeg, latitudeDeg) {
    const longitude = normalizeDegrees(Number(longitudeDeg) || 0);
    const latitude = Math.abs(Number(latitudeDeg) || 0);
    const thinDisk = Math.exp(-0.5 * (latitude / 4.8) ** 2);
    const broadDisk = Math.exp(-0.5 * (latitude / 13.5) ** 2);
    const galacticCenter = gaussianAngular(longitude, 0, 30);
    const longitudeStructure = clamp(
      0.22
      + 0.64 * galacticCenter
      + 0.18 * gaussianAngular(longitude, 25, 22)
      + 0.24 * gaussianAngular(longitude, 80, 30)
      + 0.12 * gaussianAngular(longitude, 132, 36)
      + 0.18 * gaussianAngular(longitude, 300, 34),
    );
    const centralBulge = galacticCenter * Math.exp(-0.5 * (latitude / 10) ** 2);
    return clamp((0.72 * thinDisk + 0.28 * broadDisk) * longitudeStructure + 0.22 * centralBulge);
  }

  function intensityAtEquatorial(raDeg, decDeg) {
    const galactic = equatorialToGalactic(raDeg, decDeg);
    return galactic ? intensityAtGalactic(galactic.longitudeDeg, galactic.latitudeDeg) : 0;
  }

  function createMask(widthValue, heightValue) {
    const width = Math.max(1, Math.round(Number(widthValue) || 1));
    const height = Math.max(1, Math.round(Number(heightValue) || 1));
    const data = new Uint8ClampedArray(width * height * 4);
    const rightAscensions = Array.from({ length: width }, (_, x) => {
      const ra = (360 - ((x + 0.5) / width) * 360) * DEG_TO_RAD;
      return { cos: Math.cos(ra), sin: Math.sin(ra) };
    });

    for (let y = 0; y < height; y += 1) {
      const dec = (90 - ((y + 0.5) / height) * 180) * DEG_TO_RAD;
      const cosDec = Math.cos(dec);
      const equatorialZ = Math.sin(dec);
      for (let x = 0; x < width; x += 1) {
        const equatorialX = cosDec * rightAscensions[x].cos;
        const equatorialY = cosDec * rightAscensions[x].sin;
        const galacticX = EQ_TO_GAL[0][0] * equatorialX + EQ_TO_GAL[0][1] * equatorialY + EQ_TO_GAL[0][2] * equatorialZ;
        const galacticY = EQ_TO_GAL[1][0] * equatorialX + EQ_TO_GAL[1][1] * equatorialY + EQ_TO_GAL[1][2] * equatorialZ;
        const galacticZ = EQ_TO_GAL[2][0] * equatorialX + EQ_TO_GAL[2][1] * equatorialY + EQ_TO_GAL[2][2] * equatorialZ;
        const longitude = normalizeDegrees(Math.atan2(galacticY, galacticX) * RAD_TO_DEG);
        const latitude = Math.asin(clamp(galacticZ, -1, 1)) * RAD_TO_DEG;
        const intensity = intensityAtGalactic(longitude, latitude);
        if (intensity < 0.012) continue;
        const centerWarmth = gaussianAngular(longitude, 0, 36);
        const offset = (y * width + x) * 4;
        data[offset] = Math.round(112 + 45 * centerWarmth);
        data[offset + 1] = Math.round(136 + 34 * centerWarmth);
        data[offset + 2] = Math.round(126 + 14 * centerWarmth);
        data[offset + 3] = Math.round(48 * intensity ** 0.78);
      }
    }

    return { width, height, data };
  }

  const api = Object.freeze({
    EQ_TO_GAL,
    angularDistanceDeg,
    createMask,
    equatorialToGalactic,
    intensityAtEquatorial,
    intensityAtGalactic,
  });

  globalScope.AstroMilkyWay = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
