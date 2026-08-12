(function attachSolarSystem(globalScope) {
  "use strict";

  const AU_KM = 149597870.7;
  const BODY_DEFINITIONS = Object.freeze([
    Object.freeze({ id: "Sun", name: "Slunce", color: "#f2c75c", radiusKm: 695700, kind: "sun" }),
    Object.freeze({ id: "Moon", name: "Měsíc", color: "#e8ece6", radiusKm: 1737.4, kind: "moon" }),
    Object.freeze({ id: "Mercury", name: "Merkur", color: "#b8b5ad", radiusKm: 2439.7, kind: "mercury" }),
    Object.freeze({ id: "Venus", name: "Venuše", color: "#ead6a1", radiusKm: 6051.8, kind: "venus" }),
    Object.freeze({ id: "Mars", name: "Mars", color: "#dd8065", radiusKm: 3389.5, kind: "mars" }),
    Object.freeze({ id: "Jupiter", name: "Jupiter", color: "#d8b98e", radiusKm: 69911, kind: "jupiter" }),
    Object.freeze({ id: "Saturn", name: "Saturn", color: "#e2cf91", radiusKm: 58232, kind: "saturn" }),
    Object.freeze({ id: "Uranus", name: "Uran", color: "#8bd8d8", radiusKm: 25362, kind: "uranus" }),
    Object.freeze({ id: "Neptune", name: "Neptun", color: "#7194df", radiusKm: 24622, kind: "neptune" }),
  ]);

  function requireAstronomy() {
    const astronomy = globalScope.Astronomy;
    if (!astronomy) throw new Error("Chybí Astronomy Engine.");
    return astronomy;
  }

  function validDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Neplatné datum pro výpočet Sluneční soustavy.");
    return date;
  }

  function validPlace(place) {
    const latitude = Number(place?.lat);
    const longitude = Number(place?.lon);
    const height = Number(place?.height || 0);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error("Neplatná zeměpisná šířka.");
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error("Neplatná zeměpisná délka.");
    }
    return { latitude, longitude, height: Number.isFinite(height) ? height : 0 };
  }

  function angularDiameterArcsec(radiusKm, distanceAu) {
    const distanceKm = Number(distanceAu) * AU_KM;
    if (!Number.isFinite(radiusKm) || !Number.isFinite(distanceKm) || distanceKm <= radiusKm) return null;
    return 2 * Math.atan(radiusKm / distanceKm) * 180 / Math.PI * 3600;
  }

  function moonPhaseName(phaseDeg) {
    const phase = ((Number(phaseDeg) % 360) + 360) % 360;
    if (phase < 22.5 || phase >= 337.5) return "nov";
    if (phase < 67.5) return "dorůstající srpek";
    if (phase < 112.5) return "první čtvrť";
    if (phase < 157.5) return "dorůstající Měsíc";
    if (phase < 202.5) return "úplněk";
    if (phase < 247.5) return "ubývající Měsíc";
    if (phase < 292.5) return "poslední čtvrť";
    return "ubývající srpek";
  }

  function safeEvent(callback) {
    try {
      const event = callback();
      return event?.date instanceof Date && Number.isFinite(event.date.getTime()) ? event.date : null;
    } catch {
      return null;
    }
  }

  function calculateEvents(astronomy, body, observer, date) {
    const rise = safeEvent(() => astronomy.SearchRiseSet(body, observer, +1, date, 2));
    const set = safeEvent(() => astronomy.SearchRiseSet(body, observer, -1, date, 2));
    let transit = null;
    let transitAltitude = null;
    try {
      const event = astronomy.SearchHourAngle(body, observer, 0, date, +1);
      if (event?.time?.date instanceof Date && Number.isFinite(event.time.date.getTime())) {
        transit = event.time.date;
        transitAltitude = Number.isFinite(event.hor?.altitude) ? event.hor.altitude : null;
      }
    } catch {
      transit = null;
    }
    return { rise, set, transit, transitAltitude };
  }

  function calculateBody(astronomy, definition, date, observer) {
    const body = astronomy.Body[definition.id];
    const equatorJ2000 = astronomy.Equator(body, date, observer, false, true);
    const equatorOfDate = astronomy.Equator(body, date, observer, true, true);
    const horizon = astronomy.Horizon(date, observer, equatorOfDate.ra, equatorOfDate.dec, "normal");
    const illumination = astronomy.Illumination(body, date);
    const constellation = astronomy.Constellation(equatorJ2000.ra, equatorJ2000.dec);
    const moonPhaseDeg = definition.id === "Moon" ? astronomy.MoonPhase(date) : null;
    const events = calculateEvents(astronomy, body, observer, date);

    return {
      ...definition,
      raDeg: equatorJ2000.ra * 15,
      decDeg: equatorJ2000.dec,
      raOfDateHours: equatorOfDate.ra,
      decOfDateDeg: equatorOfDate.dec,
      distanceAu: equatorOfDate.dist,
      altitudeDeg: horizon.altitude,
      azimuthDeg: horizon.azimuth,
      aboveHorizon: horizon.altitude >= 0,
      constellation: constellation?.symbol || "",
      constellationName: constellation?.name || "",
      magnitude: illumination.mag,
      phaseAngleDeg: illumination.phase_angle,
      illuminatedFraction: illumination.phase_fraction,
      heliocentricDistanceAu: illumination.helio_dist,
      geocentricDistanceAu: illumination.geo_dist,
      ringTiltDeg: Number.isFinite(illumination.ring_tilt) ? illumination.ring_tilt : null,
      angularDiameterArcsec: angularDiameterArcsec(definition.radiusKm, equatorOfDate.dist),
      elongationDeg: definition.id === "Sun" ? 0 : astronomy.AngleFromSun(body, date),
      moonPhaseDeg,
      moonPhaseName: moonPhaseDeg === null ? null : moonPhaseName(moonPhaseDeg),
      events,
    };
  }

  function calculate(dateValue, placeValue) {
    const astronomy = requireAstronomy();
    const date = validDate(dateValue);
    const place = validPlace(placeValue);
    const observer = new astronomy.Observer(place.latitude, place.longitude, place.height);
    return BODY_DEFINITIONS.map((definition) => calculateBody(astronomy, definition, date, observer));
  }

  function calculatePlanningSample(dateValue, placeValue) {
    const astronomy = requireAstronomy();
    const date = validDate(dateValue);
    const place = validPlace(placeValue);
    const observer = new astronomy.Observer(place.latitude, place.longitude, place.height);

    function planningBody(bodyId) {
      const body = astronomy.Body[bodyId];
      const equatorJ2000 = astronomy.Equator(body, date, observer, false, true);
      const equatorOfDate = astronomy.Equator(body, date, observer, true, true);
      const horizon = astronomy.Horizon(date, observer, equatorOfDate.ra, equatorOfDate.dec, "normal");
      return {
        raDeg: equatorJ2000.ra * 15,
        decDeg: equatorJ2000.dec,
        altitudeDeg: horizon.altitude,
      };
    }

    const sun = planningBody("Sun");
    const moon = planningBody("Moon");
    return {
      date,
      sunAltitudeDeg: sun.altitudeDeg,
      moonAltitudeDeg: moon.altitudeDeg,
      moonRaDeg: moon.raDeg,
      moonDecDeg: moon.decDeg,
      moonIlluminatedFraction: astronomy.Illumination(astronomy.Body.Moon, date).phase_fraction,
    };
  }

  const api = Object.freeze({
    AU_KM,
    BODY_DEFINITIONS,
    angularDiameterArcsec,
    calculate,
    calculatePlanningSample,
    moonPhaseName,
  });

  globalScope.AstroSolarSystem = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
