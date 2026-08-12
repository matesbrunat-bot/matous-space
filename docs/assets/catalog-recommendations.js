(function attachCatalogRecommendations(globalScope) {
  "use strict";

  const SCORE_WEIGHTS = Object.freeze({
    catalog: 25,
    altitude: 20,
    duration: 20,
    suitability: 12,
    ease: 8,
    moon: 15,
  });
  const PHOTO_STATUSES = Object.freeze(["all", "unphotographed", "photographed"]);
  const DEFAULT_OPTIONS = Object.freeze({
    limit: 20,
    minimumAltitudeDeg: 20,
    minimumDarkMinutes: 20,
    photoStatus: "all",
  });

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  function roundPoint(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  function validDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function normalizeOptions(value = {}) {
    return {
      limit: Math.round(clamp(value.limit ?? DEFAULT_OPTIONS.limit, 5, 50)),
      minimumAltitudeDeg: clamp(value.minimumAltitudeDeg ?? DEFAULT_OPTIONS.minimumAltitudeDeg, 0, 75),
      minimumDarkMinutes: Math.round(clamp(value.minimumDarkMinutes ?? DEFAULT_OPTIONS.minimumDarkMinutes, 10, 180)),
      photoStatus: PHOTO_STATUSES.includes(value.photoStatus) ? value.photoStatus : DEFAULT_OPTIONS.photoStatus,
    };
  }

  function twilightWeight(sunAltitudeDeg) {
    const altitude = Number(sunAltitudeDeg);
    if (!Number.isFinite(altitude) || altitude > -12) return 0;
    if (altitude <= -18) return 1;
    return 0.35 + ((-12 - altitude) / 6) * 0.65;
  }

  function angularSeparationDeg(firstRaDeg, firstDecDeg, secondRaDeg, secondDecDeg) {
    const values = [firstRaDeg, firstDecDeg, secondRaDeg, secondDecDeg].map(Number);
    if (values.some((value) => !Number.isFinite(value))) return null;
    const [firstRa, firstDec, secondRa, secondDec] = values.map((value) => value * Math.PI / 180);
    const cosine =
      Math.sin(firstDec) * Math.sin(secondDec) +
      Math.cos(firstDec) * Math.cos(secondDec) * Math.cos(firstRa - secondRa);
    return Math.acos(clamp(cosine, -1, 1)) * 180 / Math.PI;
  }

  function moonQuality(sample, target) {
    const moonAltitudeDeg = Number(sample?.moonAltitudeDeg);
    if (!Number.isFinite(moonAltitudeDeg) || moonAltitudeDeg <= 0) {
      return { quality: 1, separationDeg: null, moonAboveHorizon: false };
    }
    const separationDeg = angularSeparationDeg(
      target?.coordinates?.raDeg,
      target?.coordinates?.decDeg,
      sample?.moonRaDeg,
      sample?.moonDecDeg,
    );
    const illumination = clamp(sample?.moonIlluminatedFraction);
    const separationFactor = separationDeg === null ? 0.5 : clamp((separationDeg - 20) / 100);
    const altitudeFactor = clamp(moonAltitudeDeg / 45);
    const penalty = illumination * altitudeFactor * (1 - separationFactor) * 0.9;
    return {
      quality: clamp(1 - penalty),
      separationDeg,
      moonAboveHorizon: true,
    };
  }

  function intervalDuration(index, count, sampleMinutes, totalMinutes) {
    const startMinute = index * sampleMinutes;
    if (index >= count - 1) return Math.max(0, totalMinutes - startMinute);
    return Math.min(sampleMinutes, Math.max(0, totalMinutes - startMinute));
  }

  function buildIntervals(flags, startValue, sampleMinutes, totalMinutes) {
    const start = validDate(startValue);
    if (!start) return [];
    const intervals = [];
    let runStart = null;
    for (let index = 0; index < flags.length; index += 1) {
      const startMinute = index * sampleMinutes;
      if (flags[index] && runStart === null) runStart = startMinute;
      if (!flags[index] && runStart !== null) {
        intervals.push({
          start: new Date(start.getTime() + runStart * 60000),
          end: new Date(start.getTime() + startMinute * 60000),
          durationMinutes: startMinute - runStart,
        });
        runStart = null;
      }
    }
    if (runStart !== null) {
      intervals.push({
        start: new Date(start.getTime() + runStart * 60000),
        end: new Date(start.getTime() + totalMinutes * 60000),
        durationMinutes: totalMinutes - runStart,
      });
    }
    return intervals;
  }

  function scoreComponent(id, label, points, maximum, detail) {
    return Object.freeze({ id, label, points: roundPoint(points), maximum, detail });
  }

  function scoreTarget(target, visibility, skyTimeline, photoCount = 0, optionsValue = {}) {
    const options = normalizeOptions(optionsValue);
    if (!target || !visibility?.window?.timeline?.length || !skyTimeline?.samples?.length) return null;

    const sampleMinutes = Number(visibility.window.sampleMinutes) || Number(skyTimeline.sampleMinutes) || 10;
    const totalMinutes = Number(visibility.window.durationMinutes) || sampleMinutes * visibility.window.timeline.length;
    const sampleCount = Math.min(
      visibility.window.timeline.length,
      visibility.window.timelineAltitudes?.length || 0,
      skyTimeline.samples.length,
    );
    if (!sampleCount) return null;

    const darkFlags = [];
    let darkUsableMinutes = 0;
    let astronomicalDarkMinutes = 0;
    let equivalentDarkMinutes = 0;
    let maximumAltitudeDeg = -90;
    let maximumAltitudeDate = null;
    let moonQualityTotal = 0;
    let moonQualityMinutes = 0;
    let moonAboveMinutes = 0;
    let minimumMoonSeparationDeg = null;

    for (let index = 0; index < sampleCount; index += 1) {
      const duration = intervalDuration(index, sampleCount, sampleMinutes, totalMinutes);
      const targetUsable = Boolean(visibility.window.timeline[index]);
      const sample = skyTimeline.samples[index] || {};
      const darkEnough = Number(sample.sunAltitudeDeg) <= -12;
      const usableInDarkness = targetUsable && darkEnough;
      darkFlags.push(usableInDarkness ? 1 : 0);
      if (!usableInDarkness || duration <= 0) continue;

      darkUsableMinutes += duration;
      if (Number(sample.sunAltitudeDeg) <= -18) astronomicalDarkMinutes += duration;
      equivalentDarkMinutes += duration * twilightWeight(sample.sunAltitudeDeg);

      const altitudeDeg = Number(visibility.window.timelineAltitudes[index]);
      if (Number.isFinite(altitudeDeg) && altitudeDeg > maximumAltitudeDeg) {
        maximumAltitudeDeg = altitudeDeg;
        maximumAltitudeDate = validDate(sample.date) || new Date(visibility.window.start.getTime() + (index + 0.5) * sampleMinutes * 60000);
      }

      const moon = moonQuality(sample, target);
      moonQualityTotal += moon.quality * duration;
      moonQualityMinutes += duration;
      if (moon.moonAboveHorizon) {
        moonAboveMinutes += duration;
        if (moon.separationDeg !== null) {
          minimumMoonSeparationDeg = minimumMoonSeparationDeg === null
            ? moon.separationDeg
            : Math.min(minimumMoonSeparationDeg, moon.separationDeg);
        }
      }
    }

    if (darkUsableMinutes < options.minimumDarkMinutes || maximumAltitudeDeg <= -90) return null;

    const intervals = buildIntervals(darkFlags, visibility.window.start, sampleMinutes, totalMinutes);
    const bestInterval = intervals.reduce(
      (best, interval) => (!best || interval.durationMinutes > best.durationMinutes ? interval : best),
      null,
    );
    const catalogScore = clamp(Number(target?.dwarf3?.score) / 100);
    const altitudeRange = Math.max(15, 90 - options.minimumAltitudeDeg);
    const altitudeRatio = clamp((maximumAltitudeDeg - options.minimumAltitudeDeg) / altitudeRange);
    const integrationMinutes = Math.max(15, Number(target?.dwarf3?.minimumIntegrationMinutes) || 60);
    const durationGoalMinutes = Math.max(90, integrationMinutes * 1.5);
    const durationRatio = clamp(equivalentDarkMinutes / durationGoalMinutes);
    const suitability = clamp(Number(target?.dwarf3?.suitability) / 5);
    const difficulty = clamp(Number(target?.dwarf3?.difficulty), 1, 5);
    const ease = clamp((6 - difficulty) / 5);
    const averageMoonQuality = moonQualityMinutes > 0 ? moonQualityTotal / moonQualityMinutes : 1;

    const components = [
      scoreComponent("catalog", "Katalogová kvalita", catalogScore * SCORE_WEIGHTS.catalog, SCORE_WEIGHTS.catalog, `${Math.round(catalogScore * 100)} / 100`),
      scoreComponent("altitude", "Výška za tmy", altitudeRatio * SCORE_WEIGHTS.altitude, SCORE_WEIGHTS.altitude, `${roundPoint(maximumAltitudeDeg)}°`),
      scoreComponent("duration", "Doba za tmy", durationRatio * SCORE_WEIGHTS.duration, SCORE_WEIGHTS.duration, `${Math.round(darkUsableMinutes)} min`),
      scoreComponent("suitability", "Vhodnost DWARF 3", suitability * SCORE_WEIGHTS.suitability, SCORE_WEIGHTS.suitability, `${roundPoint(Number(target?.dwarf3?.suitability) || 0)} / 5`),
      scoreComponent("ease", "Snadnost snímání", ease * SCORE_WEIGHTS.ease, SCORE_WEIGHTS.ease, `obtížnost ${Math.round(difficulty)} / 5`),
      scoreComponent("moon", "Měsíční podmínky", averageMoonQuality * SCORE_WEIGHTS.moon, SCORE_WEIGHTS.moon, moonAboveMinutes > 0 && minimumMoonSeparationDeg !== null ? `nejméně ${roundPoint(minimumMoonSeparationDeg)}°` : "Měsíc pod obzorem"),
    ];
    const score = Math.round(components.reduce((sum, component) => sum + component.points, 0));

    return {
      target,
      targetId: String(target.targetId || ""),
      score,
      components,
      photoCount: Math.max(0, Number(photoCount) || 0),
      darkUsableMinutes,
      astronomicalDarkMinutes,
      equivalentDarkMinutes: roundPoint(equivalentDarkMinutes),
      maximumAltitudeDeg,
      maximumAltitudeDate,
      bestInterval,
      intervals,
      moonAboveMinutes,
      minimumMoonSeparationDeg,
      averageMoonQuality,
    };
  }

  function photoCountFor(photoLinks, targetId) {
    const map = photoLinks instanceof Map ? photoLinks : photoLinks?.byTargetId;
    return map?.get(String(targetId || ""))?.length || 0;
  }

  function buildRecommendations(targets, visibilityIndex, skyTimeline, photoLinks, optionsValue = {}) {
    const options = normalizeOptions(optionsValue);
    const scored = [];
    let consideredCount = 0;
    for (const target of Array.isArray(targets) ? targets : []) {
      const photoCount = photoCountFor(photoLinks, target?.targetId);
      if (options.photoStatus === "photographed" && photoCount === 0) continue;
      if (options.photoStatus === "unphotographed" && photoCount > 0) continue;
      consideredCount += 1;
      const visibility = visibilityIndex?.get(String(target?.targetId || ""));
      const recommendation = scoreTarget(target, visibility, skyTimeline, photoCount, options);
      if (recommendation) scored.push(recommendation);
    }

    scored.sort((left, right) =>
      right.score - left.score ||
      right.astronomicalDarkMinutes - left.astronomicalDarkMinutes ||
      right.maximumAltitudeDeg - left.maximumAltitudeDeg ||
      Number(right.target?.dwarf3?.score || 0) - Number(left.target?.dwarf3?.score || 0) ||
      String(left.target?.displayName || left.targetId).localeCompare(String(right.target?.displayName || right.targetId), "cs"),
    );

    return {
      items: scored.slice(0, options.limit).map((item, index) => ({ ...item, rank: index + 1 })),
      eligibleCount: scored.length,
      consideredCount,
      options,
    };
  }

  const api = Object.freeze({
    DEFAULT_OPTIONS,
    PHOTO_STATUSES,
    SCORE_WEIGHTS,
    angularSeparationDeg,
    buildIntervals,
    buildRecommendations,
    moonQuality,
    normalizeOptions,
    scoreTarget,
    twilightWeight,
  });

  globalScope.CatalogRecommendations = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
