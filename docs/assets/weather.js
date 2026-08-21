(() => {
  "use strict";

  const DEFAULT_TIME_ZONE = "Europe/Prague";
  const FORECAST_DAYS = 6;
  const CACHE_TTL = 20 * 60 * 1000;
  const CZECH_WEATHER_BOUNDS = {
    minLatitude: 48.5,
    maxLatitude: 51.1,
    minLongitude: 12.0,
    maxLongitude: 18.9,
  };
  const OUTSIDE_CZECH_MESSAGE = "Souřadnice jsou mimo podporovanou oblast předpovědi pro Česko.";
  const MODEL_LIST = [
    { key: "chmi_aladin_cz_1km", label: "ALADIN CZ", detail: "1 km · 3 dny" },
    { key: "dwd_icon_seamless", label: "ICON", detail: "2–11 km · 7 dní" },
    { key: "dmi_harmonie_arome_europe", label: "HARMONIE", detail: "2 km · 2,5 dne" },
    { key: "ecmwf_ifs", label: "ECMWF IFS", detail: "9 km · 15 dní" },
    { key: "ncep_gfs_seamless", label: "GFS", detail: "13 km · 16 dní" },
  ];
  const MODEL_GROUPS = [
    MODEL_LIST.map((model) => model.key),
    ["dwd_icon_seamless", "dmi_harmonie_arome_europe", "ecmwf_ifs", "ncep_gfs_seamless"],
    ["dwd_icon_seamless", "ecmwf_ifs", "ncep_gfs_seamless"],
  ];
  const HOURLY_VARIABLES = [
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "cloud_cover_2m",
    "precipitation",
    "visibility",
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "dew_point_2m",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
  ];
  const COLORS = {
    excellent: "#8fe3aa",
    good: "#72c8c1",
    fair: "#e2bd68",
    poor: "#d46a5f",
    dark: "#789bd1",
    cold: "#72a8d8",
    warm: "#d7a85f",
    muted: "#647168",
  };

  const locationManager = window.AstroLocation;
  const places = locationManager?.presets || [{ id: "praha", name: "Praha", lat: 50.0755, lon: 14.4378 }];

  const forecastState = {
    placeId: locationManager?.getSelectedId() || "praha",
    nightIndex: 0,
    kind: "astronomy",
    mode: "summary",
    forecast: null,
    loading: false,
    error: null,
    fetchedAt: null,
    nightKeys: [],
    timeZone: DEFAULT_TIME_ZONE,
    requestId: 0,
    controller: null,
    outsideCoverage: false,
  };

  const forecastElements = {};

  document.addEventListener("DOMContentLoaded", initializeForecast);

  function initializeForecast() {
    cacheForecastElements();
    setupViewTabs();
    setupForecastControls();
    forecastState.outsideCoverage = !isWithinCzechWeatherArea(getSelectedPlace());
    rebuildNightKeys();
    renderForecast();
    loadForecast();
  }

  function cacheForecastElements() {
    forecastElements.atlasView = document.querySelector("#atlasView");
    forecastElements.forecastView = document.querySelector("#forecastView");
    forecastElements.atlasControls = document.querySelector("[data-atlas-controls]");
    forecastElements.kicker = document.querySelector("#forecastKicker");
    forecastElements.title = document.querySelector("#forecastTitle");
    forecastElements.placeSelect = document.querySelector("#forecastPlaceSelect");
    forecastElements.coordinateEditor = document.querySelector("#forecastCoordinateEditor");
    forecastElements.latitudeInput = document.querySelector("#forecastLatitudeInput");
    forecastElements.longitudeInput = document.querySelector("#forecastLongitudeInput");
    forecastElements.applyCoordinatesButton = document.querySelector("#forecastApplyCoordinatesButton");
    forecastElements.coordinateError = document.querySelector("#forecastCoordinateError");
    forecastElements.refreshButton = document.querySelector("#forecastRefreshButton");
    forecastElements.nightTabs = document.querySelector("#forecastNightTabs");
    forecastElements.summaryDate = document.querySelector("#forecastSummaryDate");
    forecastElements.verdict = document.querySelector("#forecastVerdict");
    forecastElements.summaryLine = document.querySelector("#forecastSummaryLine");
    forecastElements.bestWindow = document.querySelector("#forecastBestWindow");
    forecastElements.bestWindowLabel = document.querySelector("#forecastBestWindowLabel");
    forecastElements.agreement = document.querySelector("#forecastAgreement");
    forecastElements.agreementLabel = document.querySelector("#forecastAgreementLabel");
    forecastElements.darkness = document.querySelector("#forecastDarkness");
    forecastElements.darknessLabel = document.querySelector("#forecastDarknessLabel");
    forecastElements.moon = document.querySelector("#forecastMoon");
    forecastElements.moonLabel = document.querySelector("#forecastMoonLabel");
    forecastElements.status = document.querySelector("#forecastStatus");
    forecastElements.matrix = document.querySelector("#forecastMatrix");
    forecastElements.updated = document.querySelector("#forecastUpdated");
  }

  function setupViewTabs() {
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.addEventListener("click", () => activateView(button.dataset.viewTarget));
    });
  }

  function activateView(view) {
    const showForecast = view === "forecast";
    forecastElements.atlasView.hidden = showForecast;
    forecastElements.forecastView.hidden = !showForecast;
    forecastElements.atlasControls.classList.toggle("is-hidden", showForecast);
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      const active = button.dataset.viewTarget === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (showForecast) {
      renderForecast();
    } else {
      window.dispatchEvent(new Event("resize"));
    }
  }

  function setupForecastControls() {
    populateForecastPlaceSelect();
    syncForecastLocationControls();
    forecastElements.placeSelect.addEventListener("change", handleForecastPlaceSelection);
    forecastElements.applyCoordinatesButton.addEventListener("click", applyForecastCoordinates);
    for (const input of [forecastElements.latitudeInput, forecastElements.longitudeInput]) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyForecastCoordinates();
      });
    }
    forecastElements.refreshButton.addEventListener("click", () => loadForecast(true));
    if (locationManager) {
      window.addEventListener(locationManager.eventName, handleSharedForecastLocation);
    }

    document.querySelectorAll("[data-forecast-kind]").forEach((button) => {
      button.addEventListener("click", () => {
        forecastState.kind = button.dataset.forecastKind;
        forecastState.nightIndex = 0;
        document.querySelectorAll("[data-forecast-kind]").forEach((item) => {
          const active = item.dataset.forecastKind === forecastState.kind;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
        });
        renderForecast();
      });
    });

    document.querySelectorAll("[data-forecast-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        forecastState.mode = button.dataset.forecastMode;
        document.querySelectorAll("[data-forecast-mode]").forEach((item) => {
          const active = item.dataset.forecastMode === forecastState.mode;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
        });
        renderForecastMatrix(getSelectedNight());
      });
    });
  }

  function populateForecastPlaceSelect() {
    forecastElements.placeSelect.replaceChildren();
    for (const place of places) {
      const option = document.createElement("option");
      option.value = place.id;
      option.textContent = place.name;
      forecastElements.placeSelect.append(option);
    }
    if (locationManager) {
      const customOption = document.createElement("option");
      customOption.value = locationManager.customId;
      customOption.textContent = locationManager.customOptionLabel();
      forecastElements.placeSelect.append(customOption);
    }
  }

  function fillForecastCoordinateInputs(place) {
    forecastElements.latitudeInput.value = Number(place.lat).toFixed(4);
    forecastElements.longitudeInput.value = Number(place.lon).toFixed(4);
  }

  function syncForecastLocationControls() {
    const custom = locationManager?.getCustomPlace();
    const customOption = locationManager
      ? forecastElements.placeSelect.querySelector(`option[value="${locationManager.customId}"]`)
      : null;
    if (customOption) customOption.textContent = locationManager.customOptionLabel();
    forecastElements.placeSelect.value = forecastState.placeId;
    const customSelected = forecastState.placeId === locationManager?.customId;
    forecastElements.coordinateEditor.hidden = !customSelected;
    if (customSelected && custom) fillForecastCoordinateInputs(custom);
  }

  function handleForecastPlaceSelection() {
    forecastElements.coordinateError.textContent = "";
    if (forecastElements.placeSelect.value === locationManager?.customId) {
      forecastElements.coordinateEditor.hidden = false;
      const custom = locationManager.getCustomPlace();
      fillForecastCoordinateInputs(custom || getSelectedPlace());
      if (custom) locationManager.select(locationManager.customId, "forecast");
      return;
    }
    forecastElements.coordinateEditor.hidden = true;
    if (locationManager) {
      locationManager.select(forecastElements.placeSelect.value, "forecast");
    }
  }

  function applyForecastCoordinates() {
    if (!locationManager) return;
    const result = locationManager.saveCustom(
      forecastElements.latitudeInput.value,
      forecastElements.longitudeInput.value,
      "forecast",
    );
    forecastElements.coordinateError.textContent = result.error || "";
    if (result.place) fillForecastCoordinateInputs(result.place);
  }

  function handleSharedForecastLocation(event) {
    forecastState.placeId = event.detail?.id || locationManager.getSelectedId();
    forecastState.timeZone = getSelectedPlace().timeZone || DEFAULT_TIME_ZONE;
    forecastState.forecast = null;
    forecastState.error = null;
    forecastState.nightIndex = 0;
    forecastState.outsideCoverage = !isWithinCzechWeatherArea(getSelectedPlace());
    syncForecastLocationControls();
    rebuildNightKeys();
    renderForecast();
    loadForecast(false, true);
  }

  function getSelectedPlace() {
    return locationManager?.getPlace(forecastState.placeId) || places.find((place) => place.id === forecastState.placeId) || places[0];
  }

  function isWithinCzechWeatherArea(place) {
    return (
      place.lat >= CZECH_WEATHER_BOUNDS.minLatitude &&
      place.lat <= CZECH_WEATHER_BOUNDS.maxLatitude &&
      place.lon >= CZECH_WEATHER_BOUNDS.minLongitude &&
      place.lon <= CZECH_WEATHER_BOUNDS.maxLongitude
    );
  }

  function rebuildNightKeys() {
    const today = dateKeyAtLocation(new Date());
    forecastState.nightKeys = Array.from({ length: 5 }, (_, index) => addDaysToKey(today, index));
    forecastState.nightIndex = clamp(forecastState.nightIndex, 0, forecastState.nightKeys.length - 1);
  }

  async function loadForecast(force = false, replaceActive = false) {
    if (forecastState.loading && !replaceActive) return;
    if (forecastState.loading && replaceActive) forecastState.controller?.abort();
    const place = getSelectedPlace();
    if (!isWithinCzechWeatherArea(place)) {
      forecastState.requestId += 1;
      forecastState.controller?.abort();
      forecastState.controller = null;
      forecastState.loading = false;
      forecastState.forecast = null;
      forecastState.error = null;
      forecastState.fetchedAt = null;
      forecastState.outsideCoverage = true;
      updateForecastLoading();
      renderForecast();
      return;
    }
    forecastState.outsideCoverage = false;
    const cached = force ? null : readForecastCache(place);
    if (cached) {
      forecastState.forecast = normalizeForecast(cached.data, place);
      forecastState.timeZone = forecastState.forecast.timeZone;
      forecastState.fetchedAt = new Date(cached.fetchedAt);
      forecastState.error = null;
      rebuildNightKeys();
      renderForecast();
      return;
    }

    forecastState.loading = true;
    forecastState.error = null;
    updateForecastLoading();
    const requestId = forecastState.requestId + 1;
    forecastState.requestId = requestId;

    const params = new URLSearchParams({
      latitude: String(place.lat),
      longitude: String(place.lon),
      timezone: "auto",
      timeformat: "unixtime",
      forecast_days: String(FORECAST_DAYS),
      wind_speed_unit: "kmh",
      hourly: HOURLY_VARIABLES.join(","),
      models: MODEL_GROUPS[0].join(","),
    });
    const controller = new AbortController();
    forecastState.controller = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25000);

    try {
      const data = await fetchForecastData(params, controller.signal);
      if (requestId !== forecastState.requestId) return;
      forecastState.forecast = normalizeForecast(data, place);
      forecastState.timeZone = forecastState.forecast.timeZone;
      forecastState.fetchedAt = new Date();
      writeForecastCache(place, data, forecastState.fetchedAt);
      rebuildNightKeys();
    } catch (error) {
      if (requestId !== forecastState.requestId) return;
      forecastState.error = error;
      forecastState.forecast = null;
    } finally {
      window.clearTimeout(timeout);
      if (requestId === forecastState.requestId) {
        forecastState.loading = false;
        forecastState.controller = null;
        updateForecastLoading();
        renderForecast();
      }
    }
  }

  async function fetchForecastData(params, signal) {
    let lastStatus = null;
    for (const modelKeys of MODEL_GROUPS) {
      params.set("models", modelKeys.join(","));
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
      if (response.ok) return response.json();
      lastStatus = response.status;
      if (![400, 422].includes(response.status)) break;
    }
    throw new Error(`Open-Meteo ${lastStatus || "nedostupné"}`);
  }

  function normalizeForecast(data, place) {
    const hourly = data.hourly || {};
    const rows = (hourly.time || []).map((time, index) => {
      const date = new Date(Number(time) * 1000);
      const models = MODEL_LIST.map((model) => ({
        ...model,
        cloud: modelValue(hourly, "cloud_cover", model.key, index),
        cloudLow: modelValue(hourly, "cloud_cover_low", model.key, index),
        cloudMid: modelValue(hourly, "cloud_cover_mid", model.key, index),
        cloudHigh: modelValue(hourly, "cloud_cover_high", model.key, index),
        fogCover: modelValue(hourly, "cloud_cover_2m", model.key, index),
        precipitation: modelValue(hourly, "precipitation", model.key, index),
        visibility: modelValue(hourly, "visibility", model.key, index),
        temperature: modelValue(hourly, "temperature_2m", model.key, index),
        apparentTemperature: modelValue(hourly, "apparent_temperature", model.key, index),
        humidity: modelValue(hourly, "relative_humidity_2m", model.key, index),
        dewPoint: modelValue(hourly, "dew_point_2m", model.key, index),
        weatherCode: modelValue(hourly, "weather_code", model.key, index),
        wind: modelValue(hourly, "wind_speed_10m", model.key, index),
        gust: modelValue(hourly, "wind_gusts_10m", model.key, index),
      }));
      return summarizeHour(date, place, models);
    });
    return { rows, place, timeZone: data.timezone || place.timeZone || DEFAULT_TIME_ZONE };
  }

  function modelValue(hourly, variable, modelKey, index) {
    const values = hourly[`${variable}_${modelKey}`];
    if (!Array.isArray(values) || values[index] === null || values[index] === undefined) return null;
    const value = Number(values[index]);
    return Number.isFinite(value) ? value : null;
  }

  function summarizeHour(date, place, models) {
    const cloudModels = models.filter((model) => Number.isFinite(model.cloud));
    const cloudValues = cloudModels.map((model) => model.cloud);
    const cloud = median(cloudValues);
    const cloudMin = cloudValues.length ? Math.min(...cloudValues) : null;
    const cloudMax = cloudValues.length ? Math.max(...cloudValues) : null;
    const cloudSpread = Number.isFinite(cloudMin) && Number.isFinite(cloudMax) ? cloudMax - cloudMin : null;
    const cloudLow = median(models.map((model) => model.cloudLow));
    const cloudMid = median(models.map((model) => model.cloudMid));
    const cloudHigh = median(models.map((model) => model.cloudHigh));
    const clearCount = cloudModels.filter((model) => model.cloud <= 25).length;

    const rainModels = models.filter((model) => Number.isFinite(model.precipitation));
    const rainCount = rainModels.filter((model) => model.precipitation >= 0.05).length;
    const precipitationMax = maximum(rainModels.map((model) => model.precipitation));

    const fogModels = models
      .map((model) => ({ ...model, fogRisk: modelFogRisk(model) }))
      .filter((model) => model.fogRisk !== null);
    const fogCount = fogModels.filter((model) => model.fogRisk >= 2).length;
    const fogRisk = maximum(fogModels.map((model) => model.fogRisk));
    const visibilityMin = minimum(models.map((model) => model.visibility));

    const dewGaps = models
      .filter((model) => Number.isFinite(model.temperature) && Number.isFinite(model.dewPoint))
      .map((model) => model.temperature - model.dewPoint);
    const dewGap = median(dewGaps);
    const temperatures = models.map((model) => model.temperature).filter(Number.isFinite);
    const apparentTemperatures = models.map((model) => model.apparentTemperature).filter(Number.isFinite);
    const humidities = models.map((model) => model.humidity).filter(Number.isFinite);
    const temperature = median(temperatures);
    const apparentTemperature = median(apparentTemperatures);
    const humidity = median(humidities);
    const temperatureSpread = temperatures.length ? Math.max(...temperatures) - Math.min(...temperatures) : null;
    const apparentTemperatureSpread = apparentTemperatures.length
      ? Math.max(...apparentTemperatures) - Math.min(...apparentTemperatures)
      : null;
    const wind = median(models.map((model) => model.wind));
    const gust = maximum(models.map((model) => model.gust));
    const sunAltitude = sunAltitudeAt(date, place);
    const moon = moonAt(date, place);

    const cloudRisk = Number.isFinite(cloud)
      ? clamp(cloud + (Number.isFinite(cloudSpread) ? cloudSpread * 0.22 : 0), 0, 100)
      : 55;
    const rainPenalty = rainModels.length
      ? (rainCount / rainModels.length) * 34 + clamp((precipitationMax || 0) * 24, 0, 26)
      : 8;
    const fogPenalty = Number.isFinite(fogRisk) ? [0, 5, 18, 34][fogRisk] : 4;
    const dewPenalty = !Number.isFinite(dewGap) ? 5 : dewGap < 1 ? 24 : dewGap < 2 ? 17 : dewGap < 4 ? 8 : 0;
    const windPenalty = !Number.isFinite(wind) ? 3 : wind >= 30 ? 23 : wind >= 20 ? 14 : wind >= 12 ? 6 : 0;
    const darknessPenalty = sunAltitude <= -18 ? 0 : sunAltitude <= -12 ? 7 : sunAltitude <= -6 ? 18 : 34;
    const moonPenalty = moon.altitude > 0
      ? moon.illumination * clamp((moon.altitude + 5) / 55, 0, 1) * 18
      : 0;
    const score = clamp(
      100 - cloudRisk * 0.7 - rainPenalty - fogPenalty - dewPenalty - windPenalty - darknessPenalty - moonPenalty,
      0,
      100,
    );

    return {
      date,
      models,
      cloud,
      cloudLow,
      cloudMid,
      cloudHigh,
      cloudSpread,
      clearCount,
      cloudModelCount: cloudModels.length,
      rainCount,
      rainModelCount: rainModels.length,
      precipitationMax,
      fogCount,
      fogModelCount: fogModels.length,
      fogRisk,
      visibilityMin,
      dewGap,
      temperature,
      apparentTemperature,
      humidity,
      temperatureSpread,
      apparentTemperatureSpread,
      condition: combinedWeatherCondition(models),
      wind,
      gust,
      sunAltitude,
      moon,
      score,
    };
  }

  function modelFogRisk(model) {
    const hasFogCover = Number.isFinite(model.fogCover);
    const hasVisibility = Number.isFinite(model.visibility);
    if (!hasFogCover && !hasVisibility) return null;
    if ((hasFogCover && model.fogCover >= 65) || (hasVisibility && model.visibility <= 1000)) return 3;
    if ((hasFogCover && model.fogCover >= 30) || (hasVisibility && model.visibility <= 3000)) return 2;
    if ((hasFogCover && model.fogCover >= 10) || (hasVisibility && model.visibility <= 7000)) return 1;
    return 0;
  }

  function weatherCodeCondition(code) {
    if (!Number.isFinite(code)) return null;
    if (code === 0) return { id: "clear", label: "jasno", color: COLORS.excellent, severity: 0 };
    if (code <= 2) return { id: "partly-cloudy", label: "polojasno", color: COLORS.good, severity: 1 };
    if (code === 3) return { id: "cloudy", label: "zataženo", color: COLORS.fair, severity: 2 };
    if (code === 45 || code === 48) return { id: "fog", label: "mlha", color: COLORS.fair, severity: 4 };
    if (code >= 51 && code <= 57) return { id: "drizzle", label: "mrholení", color: COLORS.fair, severity: 5 };
    if (code >= 61 && code <= 67) return { id: "rain", label: "déšť", color: COLORS.poor, severity: 7 };
    if (code >= 71 && code <= 77) return { id: "snow", label: "sněžení", color: COLORS.cold, severity: 7 };
    if (code >= 80 && code <= 82) return { id: "showers", label: "přeháňky", color: COLORS.poor, severity: 6 };
    if (code >= 85 && code <= 86) return { id: "snow-showers", label: "sněhové přeháňky", color: COLORS.cold, severity: 7 };
    if (code >= 95) return { id: "storm", label: "bouřky", color: COLORS.poor, severity: 9 };
    return null;
  }

  function modelWeatherCondition(model) {
    const coded = weatherCodeCondition(model.weatherCode);
    if (coded) return coded;
    if (Number.isFinite(model.precipitation) && model.precipitation >= 0.05) {
      return { id: "rain", label: "déšť", color: COLORS.poor, severity: 7 };
    }
    const fogRisk = modelFogRisk(model);
    if (Number.isFinite(fogRisk) && fogRisk >= 2) {
      return { id: "fog", label: "mlha", color: COLORS.fair, severity: 4 };
    }
    if (!Number.isFinite(model.cloud)) return null;
    if (model.cloud <= 20) return { id: "clear", label: "jasno", color: COLORS.excellent, severity: 0 };
    if (model.cloud <= 65) return { id: "partly-cloudy", label: "polojasno", color: COLORS.good, severity: 1 };
    return { id: "cloudy", label: "zataženo", color: COLORS.fair, severity: 2 };
  }

  function mostCommonCondition(conditions) {
    const groups = new Map();
    conditions.filter(Boolean).forEach((condition) => {
      const group = groups.get(condition.id) || { ...condition, count: 0 };
      group.count += 1;
      groups.set(condition.id, group);
    });
    return [...groups.values()].sort((left, right) => right.count - left.count || right.severity - left.severity)[0] || null;
  }

  function combinedWeatherCondition(models) {
    return mostCommonCondition(models.map(modelWeatherCondition)) || {
      id: "unknown",
      label: "bez dat",
      color: COLORS.muted,
      severity: -1,
      count: 0,
    };
  }

  function getSelectedNight() {
    const key = forecastState.nightKeys[forecastState.nightIndex];
    const rows = forecastState.forecast?.rows || [];
    const hours = forecastState.kind === "general"
      ? rows.filter((row) => dateKeyAtLocation(row.date) === key)
      : rows.filter((row) => nightKeyForDate(row.date) === key && row.sunAltitude < -0.833);
    return { key, hours };
  }

  function renderForecast() {
    const place = getSelectedPlace();
    forecastElements.kicker.textContent = forecastState.kind === "general" ? "Obecná předpověď" : "Pozorovací podmínky";
    forecastElements.title.textContent = locationManager?.formatPlace(place, true) || place.name;
    renderNightTabs();
    const night = getSelectedNight();

    if (forecastState.outsideCoverage) {
      forecastElements.matrix.dataset.error = "outside-czech-weather-area";
      renderForecastPlaceholder(OUTSIDE_CZECH_MESSAGE, true);
      forecastElements.verdict.textContent = "Mimo oblast Česka";
      forecastElements.status.textContent = "Předpověď pouze pro Česko";
      return;
    }
    if (forecastState.loading && !forecastState.forecast) {
      renderForecastPlaceholder("Načítám pět předpovědních modelů…");
      return;
    }
    if (forecastState.error || !forecastState.forecast) {
      forecastElements.matrix.dataset.error = forecastState.error?.message || "Bez dat předpovědi";
      renderForecastPlaceholder("Předpověď se nepodařilo načíst. Zkus ji obnovit.", true);
      return;
    }
    delete forecastElements.matrix.dataset.error;
    if (!night.hours.length) {
      renderForecastPlaceholder("Pro tuto noc zatím nejsou dostupná hodinová data.", true);
      return;
    }

    const bestWindow = findBestWindow(night.hours);
    renderForecastSummary(night, bestWindow);
    renderForecastMatrix(night);
    const modelCount = maximum(night.hours.map((hour) => hour.cloudModelCount)) || 0;
    forecastElements.status.textContent = `${modelCount} modelů · ${night.hours.length} hodin`;
    forecastElements.updated.textContent = forecastState.fetchedAt
      ? `Aktualizováno ${formatDateTime(forecastState.fetchedAt)}`
      : "--";
  }

  function renderNightTabs() {
    forecastElements.nightTabs.replaceChildren();
    forecastElements.nightTabs.setAttribute(
      "aria-label",
      forecastState.kind === "general" ? "Den předpovědi" : "Pozorovací noc",
    );
    forecastState.nightKeys.forEach((key, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `night-tab${index === forecastState.nightIndex ? " is-active" : ""}`;
      button.role = "tab";
      button.setAttribute("aria-selected", String(index === forecastState.nightIndex));
      const label = forecastState.kind === "general"
        ? index === 0 ? "Dnes" : index === 1 ? "Zítra" : weekdayForKey(key)
        : index === 0 ? "Dnešní noc" : index === 1 ? "Zítřejší noc" : weekdayForKey(key);
      button.innerHTML = `<strong>${label}</strong><span>${shortDateForKey(key)}</span>`;
      button.addEventListener("click", () => {
        forecastState.nightIndex = index;
        renderForecast();
      });
      forecastElements.nightTabs.append(button);
    });
  }

  function renderForecastPlaceholder(message, isError = false) {
    forecastElements.summaryDate.textContent = fullDateForKey(forecastState.nightKeys[forecastState.nightIndex]);
    forecastElements.verdict.textContent = isError
      ? "Data nejsou dostupná"
      : forecastState.kind === "general" ? "Počítám počasí" : "Počítám oblohu";
    forecastElements.verdict.style.color = "";
    forecastElements.summaryLine.textContent = message;
    setForecastSummaryLabels();
    forecastElements.bestWindow.textContent = "--";
    forecastElements.agreement.textContent = "--";
    forecastElements.darkness.textContent = "--";
    forecastElements.moon.textContent = "--";
    forecastElements.status.textContent = forecastState.loading ? "Načítám" : "Open-Meteo";
    forecastElements.updated.textContent = "--";
    forecastElements.matrix.style.setProperty("--forecast-hours", "1");
    forecastElements.matrix.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "forecast-error";
    empty.textContent = message;
    forecastElements.matrix.append(empty);
  }

  function renderForecastSummary(night, bestWindow) {
    if (forecastState.kind === "general") {
      renderGeneralForecastSummary(night);
      return;
    }
    setForecastSummaryLabels();
    const bestHours = bestWindow?.hours || night.hours;
    const score = bestWindow?.score ?? median(bestHours.map((hour) => hour.score));
    const agreement = modelAgreement(bestHours);
    const maxRainCount = maximum(bestHours.map((hour) => hour.rainCount)) || 0;
    const maxFogCount = maximum(bestHours.map((hour) => hour.fogCount)) || 0;
    const minDewGap = minimum(bestHours.map((hour) => hour.dewGap));
    const details = [
      maxRainCount ? `déšť ukazuje až ${maxRainCount}/5 modelů` : "bez srážek",
      maxFogCount ? `mlhu ukazuje až ${maxFogCount}/5 modelů` : "bez mlhy",
      dewSummary(minDewGap),
    ];
    const middleHour = bestHours[Math.floor(bestHours.length / 2)] || night.hours[Math.floor(night.hours.length / 2)];

    forecastElements.summaryDate.textContent = fullDateForKey(night.key);
    forecastElements.verdict.textContent = verdictForScore(score);
    forecastElements.verdict.style.color = colorForScore(score);
    forecastElements.summaryLine.textContent = details.join(" · ");
    forecastElements.bestWindow.textContent = bestWindow
      ? `${formatTime(bestWindow.start)}–${formatTime(bestWindow.end)}`
      : "--";
    forecastElements.agreement.textContent = agreement;
    forecastElements.darkness.textContent = darknessWindow(night.hours);
    forecastElements.moon.textContent = middleHour
      ? `${moonPhaseName(middleHour.moon.age)} · ${Math.round(middleHour.moon.illumination * 100)} % · ${middleHour.moon.altitude > 0 ? "nad obzorem" : "pod obzorem"}`
      : "--";
  }

  function setForecastSummaryLabels(labels = null) {
    const defaults = forecastState.kind === "general"
      ? { bestWindow: "Teplota", agreement: "Shoda modelů", darkness: "Srážky", moon: "Vítr" }
      : { bestWindow: "Nejlepší okno", agreement: "Shoda modelů", darkness: "Astronomická tma", moon: "Měsíc" };
    const resolved = { ...defaults, ...(labels || {}) };
    forecastElements.bestWindowLabel.textContent = resolved.bestWindow;
    forecastElements.agreementLabel.textContent = resolved.agreement;
    forecastElements.darknessLabel.textContent = resolved.darkness;
    forecastElements.moonLabel.textContent = resolved.moon;
  }

  function relevantGeneralHours(hours) {
    const future = hours.filter((hour) => hour.date.getTime() >= Date.now() - 30 * 60 * 1000);
    return future.length ? future : hours;
  }

  function formatTemperatureRange(minimumValue, maximumValue) {
    if (!Number.isFinite(minimumValue) || !Number.isFinite(maximumValue)) return "--";
    return `${Math.round(minimumValue)}–${Math.round(maximumValue)} °C`;
  }

  function renderGeneralForecastSummary(period) {
    const hours = relevantGeneralHours(period.hours);
    const temperatures = hours.map((hour) => hour.temperature);
    const apparentTemperatures = hours.map((hour) => hour.apparentTemperature);
    const humidities = hours.map((hour) => hour.humidity);
    const condition = mostCommonCondition(hours.map((hour) => hour.condition)) || {
      label: "bez dat",
      color: COLORS.muted,
    };
    const maxRain = maximum(hours.map((hour) => hour.precipitationMax));
    const maxRainModels = maximum(hours.map((hour) => hour.rainCount)) || 0;
    const rainModelCount = maximum(hours.map((hour) => hour.rainModelCount)) || 0;
    const maxWind = maximum(hours.map((hour) => hour.wind));
    const maxGust = maximum(hours.map((hour) => hour.gust));
    const spread = median(hours.map((hour) => hour.temperatureSpread));
    const cloud = average(hours.map((hour) => hour.cloud));

    setForecastSummaryLabels({
      bestWindow: "Teplota",
      agreement: "Shoda modelů",
      darkness: "Srážky",
      moon: "Vítr",
    });
    forecastElements.summaryDate.textContent = fullDateForKey(period.key);
    forecastElements.verdict.textContent = condition.label.charAt(0).toUpperCase() + condition.label.slice(1);
    forecastElements.verdict.style.color = condition.color;
    forecastElements.summaryLine.textContent = [
      `pocitově ${formatTemperatureRange(minimum(apparentTemperatures), maximum(apparentTemperatures))}`,
      `vlhkost ${roundValue(minimum(humidities))}–${roundValue(maximum(humidities))} %`,
      `oblačnost průměrně ${roundValue(cloud)} %`,
    ].join(" · ");
    forecastElements.bestWindow.textContent = formatTemperatureRange(minimum(temperatures), maximum(temperatures));
    forecastElements.agreement.textContent = Number.isFinite(spread) ? `rozptyl ±${(spread / 2).toFixed(1)} °C` : "--";
    forecastElements.darkness.textContent = Number.isFinite(maxRain)
      ? `${maxRain < 0.05 ? "0" : maxRain.toFixed(1)} mm/h · ${maxRainModels}/${rainModelCount} modelů`
      : "--";
    forecastElements.moon.textContent = Number.isFinite(maxWind)
      ? `max ${Math.round(maxWind)} · náraz ${roundValue(maxGust)} km/h`
      : "--";
  }

  function findBestWindow(hours) {
    const now = Date.now() - 30 * 60 * 1000;
    const future = hours.filter((hour) => hour.date.getTime() >= now);
    const candidates = future.length >= 3 ? future : hours;
    if (!candidates.length) return null;
    const windowLength = Math.min(3, candidates.length);
    let best = null;
    for (let index = 0; index <= candidates.length - windowLength; index += 1) {
      const windowHours = candidates.slice(index, index + windowLength);
      const score = windowHours.reduce((sum, hour) => sum + hour.score, 0) / windowHours.length;
      if (!best || score > best.score) {
        best = {
          score,
          hours: windowHours,
          start: windowHours[0].date,
          end: new Date(windowHours[windowHours.length - 1].date.getTime() + 60 * 60 * 1000),
        };
      }
    }
    return best;
  }

  function modelAgreement(hours) {
    const averages = MODEL_LIST.map((model) => {
      const values = hours
        .map((hour) => hour.models.find((item) => item.key === model.key)?.cloud)
        .filter(Number.isFinite);
      return values.length ? { model, cloud: average(values) } : null;
    }).filter(Boolean);
    if (!averages.length) return "--";
    const clear = averages.filter((item) => item.cloud <= 25).length;
    const cloudy = averages.filter((item) => item.cloud >= 70).length;
    if (clear === averages.length) return `${clear}/${averages.length} jasno`;
    if (cloudy === averages.length) return `${cloudy}/${averages.length} oblačno`;
    return `${clear}/${averages.length} jasno`;
  }

  function darknessWindow(hours) {
    const dark = hours.filter((hour) => hour.sunAltitude <= -18);
    if (!dark.length) return "nenastane";
    const end = new Date(dark[dark.length - 1].date.getTime() + 60 * 60 * 1000);
    return `${formatTime(dark[0].date)}–${formatTime(end)}`;
  }

  function renderForecastMatrix(night) {
    if (!night?.hours?.length) return;
    const hours = night.hours;
    forecastElements.matrix.replaceChildren();
    forecastElements.matrix.style.setProperty("--forecast-hours", String(hours.length));
    appendMatrixHeader(hours, night.key);
    if (forecastState.mode === "models") {
      MODEL_LIST.forEach((model, index) => {
        appendMatrixRow(
          model.label,
          model.detail,
          hours.map((hour) => forecastState.kind === "general"
            ? generalModelCell(hour, model.key)
            : modelCloudCell(hour, model.key)),
          index === MODEL_LIST.length - 1,
        );
      });
      return;
    }

    const rows = forecastState.kind === "general"
      ? [
        ["Počasí", "společný výsledek modelů", (hour) => generalConditionCell(hour)],
        ["Teplota", "medián · rozptyl modelů", (hour) => temperatureCell(hour)],
        ["Pocitová", "vítr · vlhkost · slunce", (hour) => apparentTemperatureCell(hour)],
        ["Srážky", "maximum · počet modelů", (hour) => rainCell(hour)],
        ["Mraky", "celkem · nízká / střední / vysoká", (hour) => cloudCell(hour)],
        ["Vítr", "rychlost · nejsilnější náraz", (hour) => windCell(hour)],
        ["Vlhkost", "relativní vlhkost ve 2 m", (hour) => humidityCell(hour)],
      ]
      : [
        ["Mraky", "celkem · nízká / střední / vysoká", (hour) => cloudCell(hour)],
        ["Déšť", "maximum · počet modelů", (hour) => rainCell(hour)],
        ["Mlha", "riziko · nejhorší dohlednost", (hour) => fogCell(hour)],
        ["Rosa", "teplota nad rosným bodem", (hour) => dewCell(hour)],
        ["Vítr", "rychlost · nejsilnější náraz", (hour) => windCell(hour)],
        ["Tma", "astronomický soumrak", (hour) => darknessCell(hour)],
        ["Měsíc", "osvětlení · výška", (hour) => moonCell(hour)],
      ];
    rows.forEach(([label, detail, factory], index) => {
      appendMatrixRow(label, detail, hours.map(factory), index === rows.length - 1);
    });
  }

  function appendMatrixHeader(hours, key) {
    const corner = createMatrixCell("forecast-corner forecast-time-cell");
    corner.innerHTML = `<strong>Hodina</strong><small>${shortDateForKey(key)}</small>`;
    forecastElements.matrix.append(corner);
    hours.forEach((hour, index) => {
      const cell = createMatrixCell("forecast-time-cell");
      if (hour.date.getTime() < Date.now() - 30 * 60 * 1000) cell.classList.add("is-past");
      if (index === hours.length - 1) cell.classList.add("is-last-column");
      const context = forecastState.kind === "general" ? hour.condition.label : shortScoreLabel(hour.score);
      cell.innerHTML = `<strong>${formatTime(hour.date)}</strong><small>${context}</small>`;
      forecastElements.matrix.append(cell);
    });
  }

  function appendMatrixRow(label, detail, cellData, isLastRow) {
    const labelCell = createMatrixCell("forecast-row-label");
    if (isLastRow) labelCell.classList.add("is-last-row");
    labelCell.innerHTML = `<strong>${label}</strong><span>${detail}</span>`;
    forecastElements.matrix.append(labelCell);
    cellData.forEach((data, index) => {
      const cell = createMatrixCell(`forecast-value-cell${data.missing ? " is-missing" : ""}`);
      if (isLastRow) cell.classList.add("is-last-row");
      if (index === cellData.length - 1) cell.classList.add("is-last-column");
      if (data.past) cell.classList.add("is-past");
      cell.style.setProperty("--cell-color", data.color || COLORS.muted);
      cell.title = data.title || `${label}: ${data.primary}`;
      cell.innerHTML = `<strong>${data.primary}</strong><small>${data.secondary}</small>`;
      forecastElements.matrix.append(cell);
    });
  }

  function createMatrixCell(extraClass) {
    const cell = document.createElement("div");
    cell.className = `forecast-cell ${extraClass}`;
    return cell;
  }

  function baseCell(hour, primary, secondary, color, title, missing = false) {
    return {
      primary,
      secondary,
      color,
      title,
      missing,
      past: hour.date.getTime() < Date.now() - 30 * 60 * 1000,
    };
  }

  function generalConditionCell(hour) {
    const condition = hour.condition;
    if (!condition || condition.id === "unknown") {
      return baseCell(hour, "--", "bez dat", COLORS.muted, "Počasí: bez dat", true);
    }
    const modelCount = hour.models.map(modelWeatherCondition).filter(Boolean).length;
    return baseCell(
      hour,
      condition.label,
      `${condition.count || 0}/${modelCount} modelů`,
      condition.color,
      `${condition.label}, shoduje se ${condition.count || 0} z ${modelCount} dostupných modelů`,
    );
  }

  function temperatureCell(hour) {
    if (!Number.isFinite(hour.temperature)) {
      return baseCell(hour, "--", "bez dat", COLORS.muted, "Teplota: bez dat", true);
    }
    const spread = Number.isFinite(hour.temperatureSpread) ? `±${(hour.temperatureSpread / 2).toFixed(1)} °C` : "rozptyl --";
    return baseCell(
      hour,
      `${Math.round(hour.temperature)} °C`,
      spread,
      colorForTemperature(hour.temperature),
      `Teplota ${hour.temperature.toFixed(1)} °C, rozptyl modelů ${spread}`,
    );
  }

  function apparentTemperatureCell(hour) {
    if (!Number.isFinite(hour.apparentTemperature)) {
      return baseCell(hour, "--", "bez dat", COLORS.muted, "Pocitová teplota: bez dat", true);
    }
    const difference = Number.isFinite(hour.temperature)
      ? `${hour.apparentTemperature - hour.temperature >= 0 ? "+" : ""}${(hour.apparentTemperature - hour.temperature).toFixed(1)} °C`
      : "oproti teplotě --";
    return baseCell(
      hour,
      `${Math.round(hour.apparentTemperature)} °C`,
      difference,
      colorForTemperature(hour.apparentTemperature),
      `Pocitová teplota ${hour.apparentTemperature.toFixed(1)} °C, ${difference} oproti teplotě vzduchu`,
    );
  }

  function humidityCell(hour) {
    if (!Number.isFinite(hour.humidity)) {
      return baseCell(hour, "--", "bez dat", COLORS.muted, "Vlhkost: bez dat", true);
    }
    const label = hour.humidity < 35 ? "sucho" : hour.humidity <= 75 ? "běžná" : hour.humidity <= 90 ? "vlhko" : "velmi vlhko";
    const color = hour.humidity <= 75 ? COLORS.good : hour.humidity <= 90 ? COLORS.fair : COLORS.cold;
    return baseCell(hour, `${Math.round(hour.humidity)} %`, label, color, `Relativní vlhkost ${Math.round(hour.humidity)} %, ${label}`);
  }

  function cloudCell(hour) {
    if (!Number.isFinite(hour.cloud)) return baseCell(hour, "--", "bez dat", COLORS.muted, "Mraky: bez dat", true);
    const layers = `N ${roundValue(hour.cloudLow)} · S ${roundValue(hour.cloudMid)} · V ${roundValue(hour.cloudHigh)}`;
    return baseCell(
      hour,
      `${Math.round(hour.cloud)} %`,
      layers,
      colorForCloud(hour.cloud),
      `Mraky ${Math.round(hour.cloud)} %, nízké ${roundValue(hour.cloudLow)} %, střední ${roundValue(hour.cloudMid)} %, vysoké ${roundValue(hour.cloudHigh)} %`,
    );
  }

  function rainCell(hour) {
    if (!Number.isFinite(hour.precipitationMax)) return baseCell(hour, "--", "bez dat", COLORS.muted, "Déšť: bez dat", true);
    const amount = hour.precipitationMax < 0.05 ? "0 mm" : `${hour.precipitationMax.toFixed(1)} mm`;
    return baseCell(
      hour,
      amount,
      `${hour.rainCount}/${hour.rainModelCount} modelů`,
      hour.rainCount === 0 ? COLORS.excellent : hour.precipitationMax < 0.5 ? COLORS.fair : COLORS.poor,
      `Maximum srážek ${amount}, srážky ukazuje ${hour.rainCount} z ${hour.rainModelCount} modelů`,
    );
  }

  function fogCell(hour) {
    if (!Number.isFinite(hour.fogRisk)) return baseCell(hour, "--", "bez dat", COLORS.muted, "Mlha: bez dat", true);
    const labels = ["bez mlhy", "opar", "možná", "vysoké"];
    const visibility = Number.isFinite(hour.visibilityMin) ? `min ${formatDistance(hour.visibilityMin)}` : `${hour.fogCount}/${hour.fogModelCount}`;
    return baseCell(
      hour,
      labels[hour.fogRisk],
      visibility,
      [COLORS.excellent, COLORS.good, COLORS.fair, COLORS.poor][hour.fogRisk],
      `Mlha: ${labels[hour.fogRisk]}, nejhorší dohlednost ${Number.isFinite(hour.visibilityMin) ? formatDistance(hour.visibilityMin) : "neznámá"}`,
    );
  }

  function dewCell(hour) {
    if (!Number.isFinite(hour.dewGap)) return baseCell(hour, "--", "bez dat", COLORS.muted, "Rosa: bez dat", true);
    const label = dewRiskLabel(hour.dewGap);
    return baseCell(
      hour,
      `+${Math.max(0, hour.dewGap).toFixed(1)} °C`,
      label,
      hour.dewGap < 2 ? COLORS.poor : hour.dewGap < 4 ? COLORS.fair : COLORS.excellent,
      `Teplota je ${Math.max(0, hour.dewGap).toFixed(1)} °C nad rosným bodem, ${label.toLowerCase()}`,
    );
  }

  function windCell(hour) {
    if (!Number.isFinite(hour.wind)) return baseCell(hour, "--", "bez dat", COLORS.muted, "Vítr: bez dat", true);
    const gust = Number.isFinite(hour.gust) ? `náraz ${Math.round(hour.gust)}` : "náraz --";
    return baseCell(
      hour,
      `${Math.round(hour.wind)} km/h`,
      gust,
      hour.wind < 12 ? COLORS.excellent : hour.wind < 20 ? COLORS.good : hour.wind < 30 ? COLORS.fair : COLORS.poor,
      `Vítr ${Math.round(hour.wind)} km/h, ${gust} km/h`,
    );
  }

  function darknessCell(hour) {
    const darkness = darknessLabel(hour.sunAltitude);
    return baseCell(
      hour,
      darkness.label,
      `Slunce ${Math.round(hour.sunAltitude)}°`,
      darkness.color,
      `${darkness.longLabel}, Slunce ${Math.round(hour.sunAltitude)}° pod obzorem`,
    );
  }

  function moonCell(hour) {
    const illumination = Math.round(hour.moon.illumination * 100);
    const above = hour.moon.altitude > 0;
    const secondary = above ? `výška ${Math.round(hour.moon.altitude)}°` : "pod obzorem";
    const color = !above ? COLORS.excellent : illumination < 25 ? COLORS.good : illumination < 65 ? COLORS.fair : COLORS.poor;
    return baseCell(hour, `${illumination} %`, secondary, color, `Měsíc ${illumination} %, ${secondary}`);
  }

  function modelCloudCell(hour, modelKey) {
    const model = hour.models.find((item) => item.key === modelKey);
    if (!model || !Number.isFinite(model.cloud)) return baseCell(hour, "--", "mimo výhled", COLORS.muted, "Model nemá pro tuto hodinu data", true);
    const layers = `N ${roundValue(model.cloudLow)} · S ${roundValue(model.cloudMid)} · V ${roundValue(model.cloudHigh)}`;
    return baseCell(hour, `${Math.round(model.cloud)} %`, layers, colorForCloud(model.cloud), `${model.label}: ${Math.round(model.cloud)} % oblačnosti`);
  }

  function generalModelCell(hour, modelKey) {
    const model = hour.models.find((item) => item.key === modelKey);
    if (!model || !Number.isFinite(model.temperature)) {
      return baseCell(hour, "--", "mimo výhled", COLORS.muted, "Model nemá pro tuto hodinu data", true);
    }
    const condition = modelWeatherCondition(model) || { label: "bez dat", color: COLORS.muted };
    const precipitation = Number.isFinite(model.precipitation) && model.precipitation >= 0.05
      ? `${model.precipitation.toFixed(1)} mm`
      : "0 mm";
    return baseCell(
      hour,
      `${Math.round(model.temperature)} °C`,
      `${condition.label} · ${precipitation}`,
      condition.color,
      `${model.label}: ${model.temperature.toFixed(1)} °C, ${condition.label}, srážky ${precipitation}`,
    );
  }

  function updateForecastLoading() {
    forecastElements.refreshButton.disabled = forecastState.loading || forecastState.outsideCoverage;
    forecastElements.refreshButton.classList.toggle("is-loading", forecastState.loading);
  }

  function forecastCacheKey(place) {
    const suffix = place.id === locationManager?.customId ? `.${place.lat.toFixed(4)}.${place.lon.toFixed(4)}` : "";
    return `astroAtlas.forecast.v2.${place.id}${suffix}`;
  }

  function readForecastCache(place) {
    try {
      const raw = localStorage.getItem(forecastCacheKey(place));
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached.fetchedAt || Date.now() - cached.fetchedAt > CACHE_TTL) return null;
      return cached;
    } catch {
      return null;
    }
  }

  function writeForecastCache(place, data, fetchedAt) {
    try {
      localStorage.setItem(
        forecastCacheKey(place),
        JSON.stringify({ fetchedAt: fetchedAt.getTime(), data }),
      );
    } catch {
      // The live forecast still works when browser storage is unavailable.
    }
  }

  function getForecastTimeZone() {
    return forecastState.forecast?.timeZone || forecastState.timeZone || DEFAULT_TIME_ZONE;
  }

  function datePartsAtLocation(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: getForecastTimeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function dateKeyAtLocation(date) {
    const parts = datePartsAtLocation(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function nightKeyForDate(date) {
    const parts = datePartsAtLocation(date);
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    return Number(parts.hour) < 12 ? addDaysToKey(key, -1) : key;
  }

  function addDaysToKey(key, amount) {
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function keyAsDate(key) {
    return new Date(`${key}T12:00:00Z`);
  }

  function shortDateForKey(key) {
    return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", timeZone: "UTC" }).format(keyAsDate(key));
  }

  function fullDateForKey(key) {
    return new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(keyAsDate(key));
  }

  function weekdayForKey(key) {
    const value = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", timeZone: "UTC" }).format(keyAsDate(key));
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: getForecastTimeZone() }).format(date);
  }

  function formatDateTime(date) {
    return new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: getForecastTimeZone() }).format(date);
  }

  function formatDistance(metres) {
    if (metres < 1000) return `${Math.round(metres / 100) * 100} m`;
    return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
  }

  function roundValue(value) {
    return Number.isFinite(value) ? Math.round(value) : "--";
  }

  function dewRiskLabel(gap) {
    if (!Number.isFinite(gap)) return "riziko neznámé";
    if (gap < 2) return "vysoké riziko";
    if (gap < 4) return "pozor na rosu";
    return "nízké riziko";
  }

  function dewSummary(gap) {
    if (!Number.isFinite(gap)) return "rosa neznámá";
    if (gap < 2) return "vysoké riziko rosy";
    if (gap < 4) return "možná rosa";
    return "nízké riziko rosy";
  }

  function darknessLabel(altitude) {
    if (altitude <= -18) return { label: "astro", longLabel: "astronomická tma", color: COLORS.dark };
    if (altitude <= -12) return { label: "nautická", longLabel: "nautický soumrak", color: COLORS.good };
    if (altitude <= -6) return { label: "civilní", longLabel: "civilní soumrak", color: COLORS.fair };
    return { label: "soumrak", longLabel: "Slunce těsně pod obzorem", color: COLORS.poor };
  }

  function colorForCloud(cloud) {
    if (!Number.isFinite(cloud)) return COLORS.muted;
    if (cloud <= 20) return COLORS.excellent;
    if (cloud <= 45) return COLORS.good;
    if (cloud <= 70) return COLORS.fair;
    return COLORS.poor;
  }

  function colorForTemperature(temperature) {
    if (!Number.isFinite(temperature)) return COLORS.muted;
    if (temperature < 5) return COLORS.cold;
    if (temperature < 22) return COLORS.good;
    if (temperature < 29) return COLORS.warm;
    return COLORS.poor;
  }

  function colorForScore(score) {
    if (score >= 75) return COLORS.excellent;
    if (score >= 55) return COLORS.good;
    if (score >= 35) return COLORS.fair;
    return COLORS.poor;
  }

  function verdictForScore(score) {
    if (score >= 75) return "Výborné podmínky";
    if (score >= 55) return "Dobré podmínky";
    if (score >= 35) return "Proměnlivé podmínky";
    if (score >= 20) return "Slabé podmínky";
    return "Nevhodné podmínky";
  }

  function shortScoreLabel(score) {
    if (score >= 75) return "výborné";
    if (score >= 55) return "dobré";
    if (score >= 35) return "smíšené";
    return "slabé";
  }

  function median(values) {
    const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!usable.length) return null;
    const middle = Math.floor(usable.length / 2);
    return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
  }

  function average(values) {
    const usable = values.filter(Number.isFinite);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  }

  function maximum(values) {
    const usable = values.filter(Number.isFinite);
    return usable.length ? Math.max(...usable) : null;
  }

  function minimum(values) {
    const usable = values.filter(Number.isFinite);
    return usable.length ? Math.min(...usable) : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Compact solar and lunar ephemerides reused from the original local astronomy widget.
  function sunEquatorial(date) {
    const days = julianDay(date) - 2451545.0;
    const anomaly = normalizeDegrees(357.529 + 0.98560028 * days);
    const meanLongitude = normalizeDegrees(280.459 + 0.98564736 * days);
    const longitude = normalizeDegrees(meanLongitude + 1.915 * sinDeg(anomaly) + 0.02 * sinDeg(2 * anomaly));
    const obliquity = 23.439 - 0.00000036 * days;
    return {
      raDeg: normalizeDegrees(radToDeg(Math.atan2(cosDeg(obliquity) * sinDeg(longitude), cosDeg(longitude)))),
      decDeg: radToDeg(Math.asin(sinDeg(obliquity) * sinDeg(longitude))),
    };
  }

  function moonEquatorial(date) {
    const days = julianDay(date) - 2451543.5;
    const node = normalizeDegrees(125.1228 - 0.0529538083 * days);
    const inclination = 5.1454;
    const periapsis = normalizeDegrees(318.0634 + 0.1643573223 * days);
    const axis = 60.2666;
    const eccentricity = 0.0549;
    const anomaly = normalizeDegrees(115.3654 + 13.0649929509 * days);
    const eccentricAnomaly = solveKepler(anomaly, eccentricity);
    const xv = axis * (Math.cos(eccentricAnomaly) - eccentricity);
    const yv = axis * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentricAnomaly);
    const trueAnomaly = Math.atan2(yv, xv);
    const radius = Math.sqrt(xv * xv + yv * yv);
    const nodeRad = degToRad(node);
    const inclinationRad = degToRad(inclination);
    const periapsisRad = degToRad(periapsis);
    const x = radius * (Math.cos(nodeRad) * Math.cos(trueAnomaly + periapsisRad) - Math.sin(nodeRad) * Math.sin(trueAnomaly + periapsisRad) * Math.cos(inclinationRad));
    const y = radius * (Math.sin(nodeRad) * Math.cos(trueAnomaly + periapsisRad) + Math.cos(nodeRad) * Math.sin(trueAnomaly + periapsisRad) * Math.cos(inclinationRad));
    const z = radius * Math.sin(trueAnomaly + periapsisRad) * Math.sin(inclinationRad);
    return eclipticToEquatorial(x, y, z, days);
  }

  function moonAt(date, place) {
    const moon = moonEquatorial(date);
    const sun = sunEquatorial(date);
    const elongation = angularDistance(moon.raDeg, moon.decDeg, sun.raDeg, sun.decDeg);
    return {
      illumination: (1 - cosDeg(elongation)) / 2,
      altitude: equatorialAltitude(moon.raDeg, moon.decDeg, date, place),
      age: positiveModulo((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000, 29.530588853),
    };
  }

  function sunAltitudeAt(date, place) {
    const sun = sunEquatorial(date);
    return equatorialAltitude(sun.raDeg, sun.decDeg, date, place);
  }

  function equatorialAltitude(raDeg, decDeg, date, place) {
    const latitude = degToRad(place.lat);
    const declination = degToRad(decDeg);
    const hourAngle = degToRad(normalizeSignedDegrees(greenwichSiderealDegrees(date) + place.lon - raDeg));
    const sinAltitude = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
    return radToDeg(Math.asin(clamp(sinAltitude, -1, 1)));
  }

  function eclipticToEquatorial(x, y, z, days) {
    const obliquity = degToRad(23.4393 - 3.563e-7 * days);
    const equatorialY = y * Math.cos(obliquity) - z * Math.sin(obliquity);
    const equatorialZ = y * Math.sin(obliquity) + z * Math.cos(obliquity);
    return {
      raDeg: normalizeDegrees(radToDeg(Math.atan2(equatorialY, x))),
      decDeg: radToDeg(Math.atan2(equatorialZ, Math.sqrt(x * x + equatorialY * equatorialY))),
    };
  }

  function solveKepler(meanAnomalyDeg, eccentricity) {
    const meanAnomaly = degToRad(meanAnomalyDeg);
    let eccentricAnomaly = meanAnomaly + eccentricity * Math.sin(meanAnomaly) * (1 + eccentricity * Math.cos(meanAnomaly));
    for (let index = 0; index < 8; index += 1) {
      eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly) / (1 - eccentricity * Math.cos(eccentricAnomaly));
    }
    return eccentricAnomaly;
  }

  function angularDistance(ra1, dec1, ra2, dec2) {
    const cosine = sinDeg(dec1) * sinDeg(dec2) + cosDeg(dec1) * cosDeg(dec2) * cosDeg(ra1 - ra2);
    return radToDeg(Math.acos(clamp(cosine, -1, 1)));
  }

  function moonPhaseName(age) {
    if (age < 1.84566) return "nov";
    if (age < 5.53699) return "dorůstající srpek";
    if (age < 9.22831) return "první čtvrť";
    if (age < 12.91963) return "dorůstající";
    if (age < 16.61096) return "úplněk";
    if (age < 20.30228) return "couvající";
    if (age < 23.99361) return "poslední čtvrť";
    if (age < 27.68493) return "ubývající srpek";
    return "nov";
  }

  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  function greenwichSiderealDegrees(date) {
    const julian = julianDay(date);
    const centuries = (julian - 2451545.0) / 36525;
    return normalizeDegrees(280.46061837 + 360.98564736629 * (julian - 2451545.0) + 0.000387933 * centuries * centuries - centuries * centuries * centuries / 38710000);
  }

  function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
  }

  function normalizeSignedDegrees(value) {
    return ((value + 180) % 360 + 360) % 360 - 180;
  }

  function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function degToRad(value) {
    return value * Math.PI / 180;
  }

  function radToDeg(value) {
    return value * 180 / Math.PI;
  }

  function sinDeg(value) {
    return Math.sin(degToRad(value));
  }

  function cosDeg(value) {
    return Math.cos(degToRad(value));
  }
})();
