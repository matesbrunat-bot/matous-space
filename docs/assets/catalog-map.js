(function attachCatalogMap(globalScope) {
  "use strict";

  const PRIORITY_ORDER = Object.freeze({ C: 0, B: 1, A: 2 });
  const PHOTO_STATUS_FILTERS = Object.freeze(["all", "photographed", "unphotographed"]);
  const CATALOG_PRIORITIES = Object.freeze(["A", "B", "C"]);
  const CATALOG_MEMBERSHIPS = Object.freeze(["Messier", "Caldwell", "Herschel 400", "Fotografický doplněk"]);
  const CATALOG_FRAMINGS = Object.freeze([
    "Tele – jeden záběr",
    "Tele – ořez",
    "Tele – výrazný ořez",
    "Tele – 2×2 mozaika",
    "Širokoúhlý / více mozaik",
  ]);
  const CAPTURE_MODES = Object.freeze(["all", "astro", "dual-band"]);

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

  function normalizePhotoStatus(value) {
    return PHOTO_STATUS_FILTERS.includes(value) ? value : "all";
  }

  function buildPhotoLinkIndex(records, validTargetIds = null) {
    const validIds = validTargetIds instanceof Set ? validTargetIds : null;
    const byTargetId = new Map();
    const unlinked = [];
    const invalidLinks = [];
    let photoCount = 0;

    for (const record of Array.isArray(records) ? records : []) {
      if (!String(record?.image || "").trim()) continue;
      photoCount += 1;
      const targetId = String(record?.catalogTargetId || "").trim();
      if (!targetId) {
        unlinked.push(record);
        continue;
      }
      if (validIds && !validIds.has(targetId)) {
        invalidLinks.push(record);
        continue;
      }
      if (!byTargetId.has(targetId)) byTargetId.set(targetId, []);
      byTargetId.get(targetId).push(record);
    }

    return {
      byTargetId,
      invalidLinks,
      linkedPhotoCount: [...byTargetId.values()].reduce((sum, photos) => sum + photos.length, 0),
      photoCount,
      photographedTargetCount: byTargetId.size,
      unlinked,
    };
  }

  function filterTargetsByPhotoStatus(targets, status, photoLinkIndex) {
    const normalizedStatus = normalizePhotoStatus(status);
    const byTargetId = photoLinkIndex?.byTargetId instanceof Map ? photoLinkIndex.byTargetId : new Map();
    if (normalizedStatus === "all") return [...(Array.isArray(targets) ? targets : [])];
    const shouldBePhotographed = normalizedStatus === "photographed";
    return [...(Array.isArray(targets) ? targets : [])].filter(
      (target) => byTargetId.has(String(target?.targetId || "")) === shouldBePhotographed,
    );
  }

  function defaultCatalogFilters() {
    return {
      angularSizeMax: null,
      angularSizeMin: null,
      captureMode: "all",
      difficultyMax: 5,
      framings: [...CATALOG_FRAMINGS],
      groupId: "",
      integrationMax: 150,
      memberships: [],
      photoStatus: "all",
      priorities: [...CATALOG_PRIORITIES],
      query: "",
      suitabilityMin: 2,
      typeCode: "",
    };
  }

  function finiteInRange(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function nullablePositiveNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function allowedValues(values, allowed, fallback) {
    if (!Array.isArray(values)) return [...fallback];
    return [...new Set(values.map(String).filter((value) => allowed.includes(value)))];
  }

  function normalizeCatalogFilters(filters = {}) {
    const defaults = defaultCatalogFilters();
    return {
      angularSizeMax: nullablePositiveNumber(filters.angularSizeMax),
      angularSizeMin: nullablePositiveNumber(filters.angularSizeMin),
      captureMode: CAPTURE_MODES.includes(filters.captureMode) ? filters.captureMode : defaults.captureMode,
      difficultyMax: finiteInRange(filters.difficultyMax, defaults.difficultyMax, 1, 5),
      framings: allowedValues(filters.framings, CATALOG_FRAMINGS, defaults.framings),
      groupId: String(filters.groupId || ""),
      integrationMax: finiteInRange(filters.integrationMax, defaults.integrationMax, 15, 150),
      memberships: allowedValues(filters.memberships, CATALOG_MEMBERSHIPS, defaults.memberships),
      photoStatus: normalizePhotoStatus(filters.photoStatus),
      priorities: allowedValues(filters.priorities, CATALOG_PRIORITIES, defaults.priorities),
      query: String(filters.query || "").trim(),
      suitabilityMin: finiteInRange(filters.suitabilityMin, defaults.suitabilityMin, 2, 5),
      typeCode: String(filters.typeCode || ""),
    };
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("cs")
      .replace(/[^a-z0-9]+/g, "");
  }

  function catalogValues(catalogs) {
    const values = [];
    for (const value of Object.values(catalogs || {})) {
      if (Array.isArray(value)) values.push(...value);
      else if (value) values.push(value);
    }
    return values;
  }

  function catalogSearchText(target) {
    return normalizeSearchText([
      target?.targetId,
      target?.displayName,
      target?.names?.curated,
      ...(target?.names?.common || []),
      ...catalogValues(target?.catalogs),
      ...(target?.memberships || []),
      target?.constellation,
      target?.objectType?.code,
      target?.objectType?.label,
      target?.mapGroup?.label,
      target?.sameFrameGroup,
    ].filter(Boolean).join(" "));
  }

  function targetMatchesCatalogFilters(target, filters, photoLinkIndex) {
    const normalized = normalizeCatalogFilters(filters);
    const query = normalizeSearchText(normalized.query);
    if (query && !catalogSearchText(target).includes(query)) return false;
    if (normalized.groupId && target?.mapGroup?.id !== normalized.groupId) return false;
    if (normalized.typeCode && target?.objectType?.code !== normalized.typeCode) return false;
    if (!normalized.priorities.includes(priorityOf(target))) return false;
    if (
      normalized.memberships.length &&
      !normalized.memberships.some((membership) => (target?.memberships || []).includes(membership))
    ) return false;
    if (!normalized.framings.includes(String(target?.dwarf3?.framing || ""))) return false;
    if (normalized.captureMode === "astro" && !String(target?.dwarf3?.filter || "").includes("Astro")) return false;
    if (normalized.captureMode === "dual-band" && String(target?.dwarf3?.dualBandUse || "Ne") === "Ne") return false;
    if (Number(target?.dwarf3?.difficulty || 5) > normalized.difficultyMax) return false;
    if (Number(target?.dwarf3?.suitability || 0) < normalized.suitabilityMin) return false;
    if (Number(target?.dwarf3?.minimumIntegrationMinutes || 0) > normalized.integrationMax) return false;

    const angularSize = Number(target?.angularSizeArcmin?.major);
    if (normalized.angularSizeMin !== null && (!Number.isFinite(angularSize) || angularSize < normalized.angularSizeMin)) {
      return false;
    }
    if (normalized.angularSizeMax !== null && (!Number.isFinite(angularSize) || angularSize > normalized.angularSizeMax)) {
      return false;
    }

    const hasPhoto = photoLinkIndex?.byTargetId instanceof Map
      ? photoLinkIndex.byTargetId.has(String(target?.targetId || ""))
      : false;
    if (normalized.photoStatus === "photographed" && !hasPhoto) return false;
    if (normalized.photoStatus === "unphotographed" && hasPhoto) return false;
    return true;
  }

  function filterCatalogTargets(targets, filters, photoLinkIndex) {
    const normalized = normalizeCatalogFilters(filters);
    return [...(Array.isArray(targets) ? targets : [])]
      .filter((target) => targetMatchesCatalogFilters(target, normalized, photoLinkIndex))
      .sort((left, right) => {
        const priorityDifference = (PRIORITY_ORDER[priorityOf(right)] || 0) - (PRIORITY_ORDER[priorityOf(left)] || 0);
        if (priorityDifference !== 0) return priorityDifference;
        const scoreDifference = Number(right?.dwarf3?.score || 0) - Number(left?.dwarf3?.score || 0);
        if (scoreDifference !== 0) return scoreDifference;
        return String(left?.displayName || left?.targetId || "").localeCompare(
          String(right?.displayName || right?.targetId || ""),
          "cs",
        );
      });
  }

  function activeCatalogFilterCount(filters) {
    const normalized = normalizeCatalogFilters(filters);
    let count = 0;
    if (normalized.query) count += 1;
    if (normalized.groupId) count += 1;
    if (normalized.typeCode) count += 1;
    if (normalized.priorities.length !== CATALOG_PRIORITIES.length) count += 1;
    if (normalized.memberships.length) count += 1;
    if (normalized.framings.length !== CATALOG_FRAMINGS.length) count += 1;
    if (normalized.captureMode !== "all") count += 1;
    if (normalized.difficultyMax < 5) count += 1;
    if (normalized.suitabilityMin > 2) count += 1;
    if (normalized.integrationMax < 150) count += 1;
    if (normalized.angularSizeMin !== null || normalized.angularSizeMax !== null) count += 1;
    if (normalized.photoStatus !== "all") count += 1;
    return count;
  }

  function resolveMapHit(photo, catalogTarget) {
    if (photo) return { kind: "photo", record: photo };
    if (catalogTarget) return { kind: "catalog", target: catalogTarget };
    return null;
  }

  const api = Object.freeze({
    CAPTURE_MODES,
    CATALOG_FRAMINGS,
    CATALOG_MEMBERSHIPS,
    CATALOG_PRIORITIES,
    DENSITY_LEVELS,
    GROUP_STYLES,
    PHOTO_STATUS_FILTERS,
    PRIORITY_ORDER,
    activeCatalogFilterCount,
    buildPhotoLinkIndex,
    catalogSearchText,
    defaultCatalogFilters,
    densityForScale,
    filterCatalogTargets,
    filterTargetsByPhotoStatus,
    normalizeCatalogFilters,
    normalizePhotoStatus,
    normalizeSearchText,
    priorityOf,
    resolveMapHit,
    targetMatchesCatalogFilters,
    targetsForDensity,
  });

  globalScope.CatalogMap = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
