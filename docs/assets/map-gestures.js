(function attachMapGestures(globalScope) {
  "use strict";

  function pointerDistance(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function pointerMidpoint(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
  }

  function pinchTransform({ view, previousAnchor, currentAnchor, scaleFactor, minScale, maxScale }) {
    const oldScale = Number(view?.scale);
    const factor = Number(scaleFactor);
    if (
      !Number.isFinite(oldScale)
      || oldScale <= 0
      || !Number.isFinite(factor)
      || factor <= 0
      || !previousAnchor
      || !currentAnchor
    ) return null;

    const minimum = Number.isFinite(Number(minScale)) ? Number(minScale) : 0;
    const maximum = Number.isFinite(Number(maxScale)) ? Number(maxScale) : Number.POSITIVE_INFINITY;
    const nextScale = Math.max(minimum, Math.min(maximum, oldScale * factor));
    const worldX = (previousAnchor.x - Number(view.x || 0)) / oldScale;
    const worldY = (previousAnchor.y - Number(view.y || 0)) / oldScale;
    return {
      scale: nextScale,
      x: currentAnchor.x - worldX * nextScale,
      y: currentAnchor.y - worldY * nextScale,
    };
  }

  const api = Object.freeze({ pointerDistance, pointerMidpoint, pinchTransform });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.AstroMapGestures = api;
})(typeof window !== "undefined" ? window : globalThis);
