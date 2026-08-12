(function attachCatalogMap(globalScope) {
  "use strict";

  const PRIORITY_ORDER = Object.freeze({ C: 0, B: 1, A: 2 });

  const DENSITY_LEVELS = Object.freeze([
    Object.freeze({
      id: "priority-a",
      maxScaleRatio: 1.65,
      priorities: Object.freeze(["A"]),
      shortLabel: "A",
      label: "priorita A",
    }),
    Object.freeze({
      id: "priority-ab",
      maxScaleRatio: 3,
      priorities: Object.freeze(["A", "B"]),
      shortLabel: "A+B",
      label: "priority A+B",
    }),
    Object.freeze({
      id: "priority-abc",
      maxScaleRatio: Number.POSITIVE_INFINITY,
      priorities: Object.freeze(["A", "B", "C"]),
      shortLabel: "A-C",
      label: "priority A-C",
    }),
  ]);

  const SHOW_ALL_LEVEL = Object.freeze({
    id: "all",
    maxScaleRatio: Number.POSITIVE_INFINITY,
    priorities: Object.freeze(["A", "B", "C"]),
    shortLabel: "650",
    label: "vsech 650",
  });

  const GROUP_STYLES = Object.freeze({
    galaxies: Object.freeze({ color: "#8fc7d9", symbol: "galaxy" }),
    "open-clusters": Object.freeze({ color: "#e5c780", symbol: "open-cluster" }),
    "globular-clusters": Object.freeze({ color: "#8fd5a6", symbol: "globular-cluster" }),
    "planetary-nebulae": Object.freeze({ color: "#c4a3d8", symbol: "planetary-nebula" }),
    nebulae: Object.freeze({ color: "#d7a195", symbol: "nebula" }),
    "cluster-nebulae": Object.freeze({ color: "#79c9bb", symbol: "cluster-nebula" }),
    other: Object.freeze({ color: "#b9c0b5", symbol: "other" }),
  });

  function priorityOf(target) {
    return String(target?.dwarf3?.priority?.level || "C").toUpperCase();
  }

  function densityForScale(scale, fitScale, showAll = false) {
    const safeFitScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : safeFitScale;
    const ratio = safeScale / safeFitScale;
    const level = showAll
      ? SHOW_ALL_LEVEL
      : DENSITY_LEVELS.find((candidate) => ratio < candidate.maxScaleRatio) || DENSITY_LEVELS.at(-1);
    return { ...level, ratio };
  }

  function targetsForDensity(targets, density, selectedTargetId = null) {
    const allowed = new Set(density?.priorities || []);
    return [...(Array.isArray(targets) ? targets : [])]
      .filter((target) => target?.targetId === selectedTargetId || allowed.has(priorityOf(target)))
      .sort((left, right) => {
        if (left?.targetId === selectedTargetId) return 1;
        if (right?.targetId === selectedTargetId) return -1;
        const priorityDifference = (PRIORITY_ORDER[priorityOf(left)] || 0) - (PRIORITY_ORDER[priorityOf(right)] || 0);
        if (priorityDifference !== 0) return priorityDifference;
        const scoreDifference = Number(left?.dwarf3?.score || 0) - Number(right?.dwarf3?.score || 0);
        if (scoreDifference !== 0) return scoreDifference;
        return String(left?.targetId || "").localeCompare(String(right?.targetId || ""));
      });
  }

  function resolveMapHit(photo, catalogTarget) {
    if (photo) return { kind: "photo", record: photo };
    if (catalogTarget) return { kind: "catalog", target: catalogTarget };
    return null;
  }

  const api = Object.freeze({
    DENSITY_LEVELS,
    GROUP_STYLES,
    PRIORITY_ORDER,
    densityForScale,
    priorityOf,
    resolveMapHit,
    targetsForDensity,
  });

  globalScope.CatalogMap = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
