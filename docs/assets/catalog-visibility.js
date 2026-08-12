(function attachCatalogVisibility(globalScope) {
  "use strict";

  const DEG_TO_RAD = Math.PI / 180;
  const RAD_TO_DEG = 180 / Math.PI;
  const SIDEREAL_RATE = 1.00273790935;
  const POLAR_DIRECTION_LIMIT = 89.5;
  const SAMPLE_MINUTES = 10;
  const VISIBILITY_MODES = Object.freeze(["all", "above-now", "below-now", "window-any", "window-duration"]);
  const DIRECTION_MODES = Object.freeze(["all", "north", "east", "south", "west", "custom"]);
  const HORIZON_KEYS = Object.freeze(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);

  function normalizeDegrees(value) {
    return ((Number(value) % 360) + 360) % 360;
  }

  function normalizeSignedDegrees(value) {
    return ((Number(value) + 180) % 360 + 360) % 360 - 180;
  }

  function finiteInRange(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function defaultSettings() {
    return {
      mode: "all",
      minimumAltitudeDeg: 20,
      windowHours: 10,
      minimumDurationMinutes: 60,
      directionMode: "all",
      azimuthStartDeg: 0,
      azimuthEndDeg: 360,
      horizonEnabled: false,
      horizonProfile: Object.fromEntries(HORIZON_KEYS.map((key) => [key, 0])),
    };
  }

  function normalizeSettings(settings = {}) {
    const defaults = defaultSettings();
    const windowHours = finiteInRange(settings.windowHours, defaults.windowHours, 1, 24);
    const profileInput = settings.horizonProfile && typeof settings.horizonProfile === "object"
      ? settings.horizonProfile
      : {};
    const horizonProfile = Object.fromEntries(HORIZON_KEYS.map((key) => [
      key,
      finiteInRange(profileInput[key], defaults.horizonProfile[key], 0, 75),
    ]));
    return {
      mode: VISIBILITY_MODES.includes(settings.mode) ? settings.mode : defaults.mode,
      minimumAltitudeDeg: finiteInRange(settings.minimumAltitudeDeg, defaults.minimumAltitudeDeg, 0, 75),
      windowHours,
      minimumDurationMinutes: finiteInRange(
        settings.minimumDurationMinutes,
        defaults.minimumDurationMinutes,
        10,
        windowHours * 60,
      ),
      directionMode: DIRECTION_MODES.includes(settings.directionMode) ? settings.directionMode : defaults.directionMode,
      azimuthStartDeg: finiteInRange(settings.azimuthStartDeg, defaults.azimuthStartDeg, 0, 360),
      azimuthEndDeg: finiteInRange(settings.azimuthEndDeg, defaults.azimuthEndDeg, 0, 360),
      horizonEnabled: settings.horizonEnabled === true,
      horizonProfile,
    };
  }

  function activeFilterCount(settings) {
    const normalized = normalizeSettings(settings);
    if (normalized.mode === "all") return 0;
    let count = 1;
    if (normalized.minimumAltitudeDeg !== 20 && normalized.mode !== "below-now") count += 1;
    if (["window-any", "window-duration"].includes(normalized.mode) && normalized.windowHours !== 10) count += 1;
    if (normalized.mode === "window-duration" && normalized.minimumDurationMinutes !== 60) count += 1;
    if (normalized.directionMode !== "all" && normalized.mode !== "below-now") count += 1;
    if (normalized.horizonEnabled && normalized.mode !== "below-now") count += 1;
    return count;
  }

  function julianDate(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    return date.getTime() / 86400000 + 2440587.5;
  }

  function greenwichSiderealTimeDeg(dateValue) {
    const jd = julianDate(dateValue);
    const t = (jd - 2451545.0) / 36525;
    return normalizeDegrees(
      280.46061837 +
        360.98564736629 * (jd - 2451545.0) +
        0.000387933 * t * t -
        (t * t * t) / 38710000,
    );
  }

  function localSiderealTimeDeg(dateValue, longitudeDeg) {
    return normalizeDegrees(greenwichSiderealTimeDeg(dateValue) + Number(longitudeDeg));
  }

  function altitudeSineFromLst(raDeg, decDeg, lstDeg, latitudeDeg) {
    const hourAngleRad = normalizeSignedDegrees(lstDeg - raDeg) * DEG_TO_RAD;
    const decRad = Number(decDeg) * DEG_TO_RAD;
    const latitudeRad = Number(latitudeDeg) * DEG_TO_RAD;
    return (
      Math.sin(latitudeRad) * Math.sin(decRad) +
      Math.cos(latitudeRad) * Math.cos(decRad) * Math.cos(hourAngleRad)
    );
  }

  function horizontalFromLst(raDeg, decDeg, lstDeg, latitudeDeg) {
    const hourAngleRad = normalizeSignedDegrees(lstDeg - raDeg) * DEG_TO_RAD;
    const decRad = Number(decDeg) * DEG_TO_RAD;
    const latitudeRad = Number(latitudeDeg) * DEG_TO_RAD;
    const sinAltitude = altitudeSineFromLst(raDeg, decDeg, lstDeg, latitudeDeg);
    const altitudeRad = Math.asin(Math.max(-1, Math.min(1, sinAltitude)));
    const azimuthRad = Math.atan2(
      -Math.sin(hourAngleRad) * Math.cos(decRad),
      Math.sin(decRad) * Math.cos(latitudeRad) -
        Math.cos(decRad) * Math.sin(latitudeRad) * Math.cos(hourAngleRad),
    );
    return {
      altitudeDeg: altitudeRad * RAD_TO_DEG,
      azimuthDeg: normalizeDegrees(azimuthRad * RAD_TO_DEG),
    };
  }

  function horizontalCoordinates(raDeg, decDeg, dateValue, place) {
    const lstDeg = localSiderealTimeDeg(dateValue, place?.lon);
    return horizontalFromLst(raDeg, decDeg, lstDeg, place?.lat);
  }

  function hasStableCardinalDirections(place) {
    return Math.abs(Number(place?.lat)) < POLAR_DIRECTION_LIMIT;
  }

  function horizonAltitudeAt(azimuthDeg, settings) {
    const normalized = normalizeSettings(settings);
    if (!normalized.horizonEnabled) return 0;
    const sector = normalizeDegrees(azimuthDeg) / 45;
    const lowerIndex = Math.floor(sector) % HORIZON_KEYS.length;
    const upperIndex = (lowerIndex + 1) % HORIZON_KEYS.length;
    const fraction = sector - Math.floor(sector);
    const lower = normalized.horizonProfile[HORIZON_KEYS[lowerIndex]];
    const upper = normalized.horizonProfile[HORIZON_KEYS[upperIndex]];
    return lower + (upper - lower) * fraction;
  }

  function directionMatches(azimuthDeg, settings, stableDirections = true) {
    const normalized = normalizeSettings(settings);
    if (!stableDirections || normalized.directionMode === "all") return true;
    const azimuth = normalizeDegrees(azimuthDeg);
    const centers = { north: 0, east: 90, south: 180, west: 270 };
    if (Object.hasOwn(centers, normalized.directionMode)) {
      return Math.abs(normalizeSignedDegrees(azimuth - centers[normalized.directionMode])) <= 45;
    }
    const rawSpan = Math.abs(normalized.azimuthEndDeg - normalized.azimuthStartDeg);
    if (rawSpan >= 359.999) return true;
    const start = normalizeDegrees(normalized.azimuthStartDeg);
    const end = normalizeDegrees(normalized.azimuthEndDeg);
    if (start <= end) return azimuth >= start && azimuth <= end;
    return azimuth >= start || azimuth <= end;
  }

  function effectiveMinimumAltitude(azimuthDeg, settings, stableDirections = true) {
    const normalized = normalizeSettings(settings);
    const profileAltitude = stableDirections ? horizonAltitudeAt(azimuthDeg, normalized) : 0;
    return Math.max(normalized.minimumAltitudeDeg, profileAltitude);
  }

  function usablePosition(horizontal, settings, stableDirections = true) {
    const thresholdDeg = effectiveMinimumAltitude(horizontal.azimuthDeg, settings, stableDirections);
    const directionMatch = directionMatches(horizontal.azimuthDeg, settings, stableDirections);
    return {
      ...horizontal,
      aboveHorizon: horizontal.altitudeDeg >= 0,
      thresholdDeg,
      directionMatch,
      usable: horizontal.altitudeDeg >= thresholdDeg && directionMatch,
    };
  }

  function nextEventDate(date, currentLstDeg, eventLstDeg) {
    const deltaSiderealDeg = normalizeDegrees(eventLstDeg - currentLstDeg);
    const deltaSolarHours = deltaSiderealDeg / 15 / SIDEREAL_RATE;
    return new Date(date.getTime() + deltaSolarHours * 3600000);
  }

  function fixedTargetEvents(raDeg, decDeg, dateValue, place) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const latitudeDeg = Number(place?.lat);
    const longitudeDeg = Number(place?.lon);
    const currentLstDeg = localSiderealTimeDeg(date, longitudeDeg);
    const transitAltitudeDeg = 90 - Math.abs(latitudeDeg - Number(decDeg));

    if (!hasStableCardinalDirections(place) || Math.abs(Math.cos(Number(decDeg) * DEG_TO_RAD)) < 1e-12) {
      const current = horizontalFromLst(raDeg, decDeg, currentLstDeg, latitudeDeg);
      return {
        rise: null,
        set: null,
        transit: null,
        transitAltitudeDeg: null,
        horizonState: current.altitudeDeg >= 0 ? "always-above" : "always-below",
      };
    }

    const latitudeRad = latitudeDeg * DEG_TO_RAD;
    const decRad = Number(decDeg) * DEG_TO_RAD;
    const denominator = Math.cos(latitudeRad) * Math.cos(decRad);
    const cosHourAngle = -Math.sin(latitudeRad) * Math.sin(decRad) / denominator;
    const transit = nextEventDate(date, currentLstDeg, normalizeDegrees(raDeg));
    if (cosHourAngle < -1) {
      return { rise: null, set: null, transit, transitAltitudeDeg, horizonState: "always-above" };
    }
    if (cosHourAngle > 1) {
      return { rise: null, set: null, transit, transitAltitudeDeg, horizonState: "always-below" };
    }

    const hourAngleDeg = Math.acos(Math.max(-1, Math.min(1, cosHourAngle))) * RAD_TO_DEG;
    return {
      rise: nextEventDate(date, currentLstDeg, normalizeDegrees(raDeg - hourAngleDeg)),
      set: nextEventDate(date, currentLstDeg, normalizeDegrees(raDeg + hourAngleDeg)),
      transit,
      transitAltitudeDeg,
      horizonState: "normal",
    };
  }

  function angularSeparationDeg(firstRaDeg, firstDecDeg, secondRaDeg, secondDecDeg) {
    for (const value of [firstRaDeg, firstDecDeg, secondRaDeg, secondDecDeg]) {
      if (!Number.isFinite(Number(value))) return null;
    }
    const firstRa = Number(firstRaDeg) * DEG_TO_RAD;
    const firstDec = Number(firstDecDeg) * DEG_TO_RAD;
    const secondRa = Number(secondRaDeg) * DEG_TO_RAD;
    const secondDec = Number(secondDecDeg) * DEG_TO_RAD;
    const cosine =
      Math.sin(firstDec) * Math.sin(secondDec) +
      Math.cos(firstDec) * Math.cos(secondDec) * Math.cos(firstRa - secondRa);
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * RAD_TO_DEG;
  }

  function analyzeTarget(target, dateValue, place, settingsValue, moonPosition = null) {
    const settings = normalizeSettings(settingsValue);
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const raDeg = Number(target?.coordinates?.raDeg ?? target?.raDeg);
    const decDeg = Number(target?.coordinates?.decDeg ?? target?.decDeg);
    if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) || !Number.isFinite(date.getTime())) return null;

    const stableDirections = hasStableCardinalDirections(place);
    const currentHorizontal = horizontalCoordinates(raDeg, decDeg, date, place);
    const current = usablePosition(currentHorizontal, settings, stableDirections);
    const totalMinutes = settings.windowHours * 60;
    const intervalCount = Math.ceil(totalMinutes / SAMPLE_MINUTES);
    const timeline = [];
    const timelineAltitudes = [];
    const intervals = [];
    let usableMinutes = 0;
    let runStartMinute = null;
    let maximum = {
      altitudeDeg: current.altitudeDeg,
      azimuthDeg: current.azimuthDeg,
      date,
    };

    for (let index = 0; index < intervalCount; index += 1) {
      const startMinute = index * SAMPLE_MINUTES;
      const endMinute = Math.min(totalMinutes, (index + 1) * SAMPLE_MINUTES);
      const middleMinute = (startMinute + endMinute) / 2;
      const middleDate = new Date(date.getTime() + middleMinute * 60000);
      const horizontal = horizontalCoordinates(raDeg, decDeg, middleDate, place);
      const position = usablePosition(horizontal, settings, stableDirections);
      const duration = endMinute - startMinute;
      timeline.push(position.usable ? 1 : 0);
      timelineAltitudes.push(Math.round(position.altitudeDeg * 10) / 10);
      if (position.altitudeDeg > maximum.altitudeDeg) {
        maximum = { altitudeDeg: position.altitudeDeg, azimuthDeg: position.azimuthDeg, date: middleDate };
      }
      if (position.usable) {
        usableMinutes += duration;
        if (runStartMinute === null) runStartMinute = startMinute;
      } else if (runStartMinute !== null) {
        intervals.push({
          start: new Date(date.getTime() + runStartMinute * 60000),
          end: new Date(date.getTime() + startMinute * 60000),
          durationMinutes: startMinute - runStartMinute,
        });
        runStartMinute = null;
      }
    }
    if (runStartMinute !== null) {
      intervals.push({
        start: new Date(date.getTime() + runStartMinute * 60000),
        end: new Date(date.getTime() + totalMinutes * 60000),
        durationMinutes: totalMinutes - runStartMinute,
      });
    }

    const events = fixedTargetEvents(raDeg, decDeg, date, place);
    if (events.transit && events.transit <= new Date(date.getTime() + totalMinutes * 60000)) {
      const transitHorizontal = horizontalCoordinates(raDeg, decDeg, events.transit, place);
      if (transitHorizontal.altitudeDeg > maximum.altitudeDeg) {
        maximum = { ...transitHorizontal, date: events.transit };
      }
    }
    const bestInterval = intervals.reduce(
      (best, interval) => (!best || interval.durationMinutes > best.durationMinutes ? interval : best),
      null,
    );
    const moonSeparationDeg = moonPosition
      ? angularSeparationDeg(raDeg, decDeg, moonPosition.raDeg, moonPosition.decDeg)
      : null;

    return {
      targetId: String(target?.targetId || ""),
      stableDirections,
      current,
      events,
      moonSeparationDeg,
      window: {
        start: date,
        end: new Date(date.getTime() + totalMinutes * 60000),
        durationMinutes: totalMinutes,
        usableMinutes,
        intervals,
        bestInterval,
        maximum,
        timeline,
        timelineAltitudes,
        sampleMinutes: SAMPLE_MINUTES,
      },
    };
  }

  function buildVisibilityIndex(targets, date, place, settings, moonPosition = null) {
    const index = new Map();
    for (const target of Array.isArray(targets) ? targets : []) {
      const analysis = analyzeTarget(target, date, place, settings, moonPosition);
      if (analysis) index.set(String(target.targetId || ""), analysis);
    }
    return index;
  }

  function targetMatches(analysis, settingsValue) {
    const settings = normalizeSettings(settingsValue);
    if (settings.mode === "all") return true;
    if (!analysis) return false;
    if (settings.mode === "above-now") return analysis.current.usable;
    if (settings.mode === "below-now") return !analysis.current.aboveHorizon;
    if (settings.mode === "window-any") return analysis.window.usableMinutes > 0;
    if (settings.mode === "window-duration") {
      return analysis.window.usableMinutes >= settings.minimumDurationMinutes;
    }
    return true;
  }

  const api = Object.freeze({
    DIRECTION_MODES,
    HORIZON_KEYS,
    POLAR_DIRECTION_LIMIT,
    SAMPLE_MINUTES,
    VISIBILITY_MODES,
    activeFilterCount,
    analyzeTarget,
    altitudeSineFromLst,
    angularSeparationDeg,
    buildVisibilityIndex,
    defaultSettings,
    directionMatches,
    effectiveMinimumAltitude,
    fixedTargetEvents,
    greenwichSiderealTimeDeg,
    hasStableCardinalDirections,
    horizonAltitudeAt,
    horizontalCoordinates,
    horizontalFromLst,
    localSiderealTimeDeg,
    normalizeDegrees,
    normalizeSettings,
    targetMatches,
  });

  globalScope.CatalogVisibility = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
