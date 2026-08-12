(function attachConstellationAtlas(globalScope) {
  "use strict";

  const OFFICIAL_COUNT = 88;

  function finiteCoordinate(point) {
    return Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1]));
  }

  function validateDocument(document) {
    if (!document || typeof document !== "object") throw new Error("Chybí data souhvězdí.");
    if (!Array.isArray(document.constellations) || document.constellations.length !== OFFICIAL_COUNT) {
      throw new Error(`Atlas musí obsahovat všech ${OFFICIAL_COUNT} souhvězdí IAU.`);
    }
    if (!Array.isArray(document.boundarySegments) || !document.boundarySegments.length) {
      throw new Error("Chybí oficiální hranice souhvězdí.");
    }
    const abbreviations = new Set();
    const items = document.constellations.map((item) => {
      const abbreviation = String(item?.abbreviation || "");
      if (!/^[A-Z][A-Za-z]{2}$/.test(abbreviation) || abbreviations.has(abbreviation)) {
        throw new Error(`Neplatná nebo duplicitní zkratka souhvězdí: ${abbreviation || "—"}.`);
      }
      abbreviations.add(abbreviation);
      const labels = Array.isArray(item.labels) ? item.labels.filter((label) => (
        Number.isFinite(Number(label?.raDeg)) && Number.isFinite(Number(label?.decDeg))
      )) : [];
      const lines = Array.isArray(item.lines)
        ? item.lines.map((path) => path.filter(finiteCoordinate)).filter((path) => path.length >= 2)
        : [];
      if (!labels.length || !lines.length) throw new Error(`Neúplná geometrie souhvězdí ${abbreviation}.`);
      return {
        abbreviation,
        czechName: String(item.czechName || item.latinName || abbreviation),
        latinName: String(item.latinName || abbreviation),
        genitive: String(item.genitive || ""),
        rank: Math.max(1, Math.min(3, Math.round(Number(item.rank) || 3))),
        labels,
        lines,
      };
    });
    const boundarySegments = document.boundarySegments
      .filter((segment) => Array.isArray(segment) && segment.length === 2 && segment.every(finiteCoordinate));
    if (boundarySegments.length !== document.boundarySegments.length) {
      throw new Error("Některý úsek hranice má neplatné souřadnice.");
    }
    return {
      metadata: {
        constellationCount: Number(document.constellationCount),
        regionCount: Number(document.regionCount),
        linePathCount: Number(document.linePathCount),
        boundarySegmentCount: Number(document.boundarySegmentCount),
        coordinateFrame: String(document.coordinateFrame || "J2000"),
        source: document.source || {},
      },
      items,
      boundarySegments,
    };
  }

  function rankLimitForScale(scale, fitScale) {
    const safeFit = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
    const ratio = (Number.isFinite(scale) ? scale : safeFit) / safeFit;
    if (ratio < 1.35) return 1;
    if (ratio < 2.25) return 2;
    return 3;
  }

  function visibleItems(items, scale, fitScale) {
    const limit = rankLimitForScale(scale, fitScale);
    return (Array.isArray(items) ? items : []).filter((item) => item.rank <= limit);
  }

  function wrappedSegments(path, projectWidth = 2400) {
    if (!Array.isArray(path) || path.length < 2) return [];
    const width = Number(projectWidth) || 2400;
    const projected = path.map(([raDeg, decDeg]) => ({
      x: ((360 - ((Number(raDeg) % 360 + 360) % 360)) / 360) * width,
      y: ((90 - Number(decDeg)) / 180) * (width / 2),
    }));
    const segments = [];
    for (let index = 1; index < projected.length; index += 1) {
      const start = projected[index - 1];
      const end = projected[index];
      if (Math.abs(end.x - start.x) <= width / 2) {
        segments.push([start, end]);
      } else if (start.x < end.x) {
        segments.push([start, { x: end.x - width, y: end.y }]);
        segments.push([{ x: start.x + width, y: start.y }, end]);
      } else {
        segments.push([start, { x: end.x + width, y: end.y }]);
        segments.push([{ x: start.x - width, y: start.y }, end]);
      }
    }
    return segments;
  }

  const api = Object.freeze({ OFFICIAL_COUNT, rankLimitForScale, validateDocument, visibleItems, wrappedSegments });
  globalScope.AstroConstellations = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
