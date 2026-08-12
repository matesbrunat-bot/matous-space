const BASE_WIDTH = 2400;
const BASE_HEIGHT = 1200;
const MIN_ZOOM = 0.28;
const MAX_ZOOM = 8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const VISIBILITY_MASK_WIDTH = 1200;
const VISIBILITY_MASK_HEIGHT = 600;
const ALTITUDE_CONTOUR_COLUMNS = 360;
const ALTITUDE_CONTOUR_ROWS = 180;
const POLAR_DIRECTION_LIMIT = 89.5;
const CATALOG_LABEL_PADDING = 4;
const RECOMMENDATION_MAP_LIMIT = 12;

const catalogVisibilityApi = window.CatalogVisibility;
if (!catalogVisibilityApi) {
  throw new Error("Chybí modul dynamické viditelnosti katalogu.");
}
const catalogRecommendationsApi = window.CatalogRecommendations;
if (!catalogRecommendationsApi) {
  throw new Error("Chybí modul doporučení katalogových cílů.");
}
const catalogMapApi = window.CatalogMap;
if (!catalogMapApi) {
  throw new Error("Chybí modul katalogové mapy.");
}
const solarSystemApi = window.AstroSolarSystem;
if (!solarSystemApi) {
  throw new Error("Chybí modul Sluneční soustavy.");
}

const OBSERVING_PLACES = [
  { id: "praha", name: "Praha", lat: 50.0755, lon: 14.4378 },
  { id: "brno", name: "Brno", lat: 49.1951, lon: 16.6068 },
  { id: "ostrava", name: "Ostrava", lat: 49.8209, lon: 18.2625 },
  { id: "plzen", name: "Plzeň", lat: 49.7384, lon: 13.3736 },
  { id: "hradec-kralove", name: "Hradec Králové", lat: 50.2092, lon: 15.8328 },
];

const CUSTOM_PLACE_ID = "custom";
const LOCATION_CHANGE_EVENT = "astroAtlas:locationchange";
const LOCATION_STORAGE_KEY = "astroAtlas.observingPlace";
const CUSTOM_LOCATION_STORAGE_KEY = "astroAtlas.customPlace";
const MOBILE_VISIBILITY_PANEL_KEY = "astroAtlas.mobile.visibilityPanelCollapsed";
const MOBILE_ORIENTATION_PANEL_KEY = "astroAtlas.mobile.orientationPanelCollapsed";
const MOBILE_LAYERS_PANEL_KEY = "astroAtlas.mobile.layersPanelCollapsed";
const PHOTO_LAYER_STORAGE_KEY = "astroAtlas.layers.photos";
const CATALOG_LAYER_STORAGE_KEY = "astroAtlas.layers.catalog";
const SOLAR_LAYER_STORAGE_KEY = "astroAtlas.layers.solarSystem";
const CATALOG_SHOW_ALL_STORAGE_KEY = "astroAtlas.layers.catalogShowAll";
const CATALOG_PHOTO_STATUS_STORAGE_KEY = "astroAtlas.catalog.photoStatus";
const CATALOG_FILTERS_STORAGE_KEY = "astroAtlas.catalog.filters";
const RECOMMENDATION_LIMIT_STORAGE_KEY = "astroAtlas.recommendations.limit";
const TIME_PLAYBACK_STEP_STORAGE_KEY = "astroAtlas.time.playbackStep";
const TIME_PLAYBACK_INTERVAL_MS = 850;
const TIMELINE_RENDER_DELAY_MS = 90;
const MOBILE_LAYOUT_QUERY = "(max-width: 720px)";

const timeControlsApi = window.AstroTimeControls;
if (!timeControlsApi) {
  throw new Error("Chybí modul časové osy atlasu.");
}

function readLocationStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocationStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The selected location still works for the current session.
  }
}

function readBooleanPreference(key, fallback) {
  const value = readLocationStorage(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function readNumberPreference(key, fallback, minimum, maximum) {
  const stored = readLocationStorage(key);
  if (stored === null || stored === "") return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function readCatalogFiltersPreference() {
  let stored = null;
  try {
    stored = JSON.parse(readLocationStorage(CATALOG_FILTERS_STORAGE_KEY) || "null");
  } catch {
    stored = null;
  }
  const legacyPhotoStatus = catalogMapApi.normalizePhotoStatus(readLocationStorage(CATALOG_PHOTO_STATUS_STORAGE_KEY));
  return catalogMapApi.normalizeCatalogFilters({
    ...(stored && typeof stored === "object" ? stored : {}),
    photoStatus: stored?.photoStatus || legacyPhotoStatus,
  });
}

function parseLocationCoordinate(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function validateLocationCoordinates(latitude, longitude) {
  const lat = parseLocationCoordinate(latitude);
  const lon = parseLocationCoordinate(longitude);
  if (lat === null || lon === null) {
    return { error: "Zadej obě souřadnice jako čísla." };
  }
  if (lat < -90 || lat > 90) {
    return { error: "Zeměpisná šířka musí být od −90 do 90°." };
  }
  if (lon < -180 || lon > 180) {
    return { error: "Zeměpisná délka musí být od −180 do 180°." };
  }
  return { lat, lon };
}

function coordinateText(value, positive, negative) {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

function readCustomObservingPlace() {
  try {
    const stored = JSON.parse(readLocationStorage(CUSTOM_LOCATION_STORAGE_KEY) || "null");
    const validation = validateLocationCoordinates(stored?.lat, stored?.lon);
    if (validation.error) return null;
    return {
      id: CUSTOM_PLACE_ID,
      name: "Vlastní místo",
      lat: validation.lat,
      lon: validation.lon,
    };
  } catch {
    return null;
  }
}

const AstroLocation = {
  presets: OBSERVING_PLACES,
  customId: CUSTOM_PLACE_ID,
  eventName: LOCATION_CHANGE_EVENT,
  validate: validateLocationCoordinates,
  getCustomPlace: readCustomObservingPlace,
  getPlace(id) {
    if (id === CUSTOM_PLACE_ID) return readCustomObservingPlace() || OBSERVING_PLACES[0];
    return OBSERVING_PLACES.find((place) => place.id === id) || OBSERVING_PLACES[0];
  },
  getSelectedId() {
    const stored = readLocationStorage(LOCATION_STORAGE_KEY) || readLocationStorage("astroAtlas.forecastPlace");
    if (stored === CUSTOM_PLACE_ID && readCustomObservingPlace()) return stored;
    return OBSERVING_PLACES.some((place) => place.id === stored) ? stored : OBSERVING_PLACES[0].id;
  },
  formatPlace(place, includeCoordinates = false) {
    if (!includeCoordinates || place.id !== CUSTOM_PLACE_ID) return place.name;
    return `${place.name} · ${coordinateText(place.lat, "N", "S")} · ${coordinateText(place.lon, "E", "W")}`;
  },
  customOptionLabel() {
    const custom = readCustomObservingPlace();
    return custom
      ? `Vlastní · ${custom.lat.toFixed(4)}, ${custom.lon.toFixed(4)}`
      : "Vlastní souřadnice…";
  },
  select(id, source = "unknown") {
    const selectedId = id === CUSTOM_PLACE_ID && !readCustomObservingPlace() ? this.getSelectedId() : this.getPlace(id).id;
    const place = this.getPlace(selectedId);
    writeLocationStorage(LOCATION_STORAGE_KEY, selectedId);
    window.dispatchEvent(new CustomEvent(LOCATION_CHANGE_EVENT, { detail: { id: selectedId, place, source } }));
    return place;
  },
  saveCustom(latitude, longitude, source = "unknown") {
    const validation = validateLocationCoordinates(latitude, longitude);
    if (validation.error) return validation;
    const place = {
      id: CUSTOM_PLACE_ID,
      name: "Vlastní místo",
      lat: validation.lat,
      lon: validation.lon,
    };
    writeLocationStorage(CUSTOM_LOCATION_STORAGE_KEY, JSON.stringify({ lat: place.lat, lon: place.lon }));
    writeLocationStorage(LOCATION_STORAGE_KEY, CUSTOM_PLACE_ID);
    window.dispatchEvent(new CustomEvent(LOCATION_CHANGE_EVENT, { detail: { id: CUSTOM_PLACE_ID, place, source } }));
    return { place };
  },
};

window.AstroLocation = AstroLocation;

const state = {
  objects: [],
  filtered: [],
  catalog: {
    metadata: null,
    targets: [],
    filtered: [],
    byId: new Map(),
    rendered: [],
    photoLinks: catalogMapApi.buildPhotoLinkIndex([]),
    filters: readCatalogFiltersPreference(),
    visibility: {
      byId: new Map(),
      calculationKey: "",
      error: null,
    },
  },
  selectedId: null,
  hoveredId: null,
  selectedCatalogId: null,
  hoveredCatalogId: null,
  selectedSolarId: null,
  hoveredSolarId: null,
  sidebarMode: "photos",
  photoTargetFilterId: null,
  dialogMode: "create",
  editingId: null,
  view: { scale: 1, fitScale: 1, x: 0, y: 0 },
  dragging: false,
  dragMoved: false,
  dragStart: { x: 0, y: 0 },
  viewStart: { x: 0, y: 0 },
  dpr: 1,
  size: { width: 0, height: 0 },
  visibility: {
    enabled: true,
    placeId: AstroLocation.getSelectedId(),
  },
  layers: {
    photos: readBooleanPreference(PHOTO_LAYER_STORAGE_KEY, true),
    catalog: readBooleanPreference(CATALOG_LAYER_STORAGE_KEY, true),
    solar: readBooleanPreference(SOLAR_LAYER_STORAGE_KEY, true),
    catalogShowAll: readBooleanPreference(CATALOG_SHOW_ALL_STORAGE_KEY, false),
  },
  solar: {
    bodies: [],
    byId: new Map(),
    rendered: [],
    calculationKey: "",
    error: null,
  },
  recommendations: {
    items: [],
    byTargetId: new Map(),
    eligibleCount: 0,
    consideredCount: 0,
    limit: readNumberPreference(RECOMMENDATION_LIMIT_STORAGE_KEY, 20, 5, 30),
    skyTimeline: null,
    skyKey: "",
    calculationKey: "",
    error: null,
  },
  time: {
    playing: false,
    timerId: null,
    timelineRenderId: null,
    playbackStepMinutes: timeControlsApi.normalizePlaybackStep(
      readNumberPreference(TIME_PLAYBACK_STEP_STORAGE_KEY, 60, 15, 180),
    ),
  },
};

const elements = {
  canvas: document.querySelector("#skyCanvas"),
  searchInput: document.querySelector("#searchInput"),
  constellationFilter: document.querySelector("#constellationFilter"),
  typeFilter: document.querySelector("#typeFilter"),
  yearFilter: document.querySelector("#yearFilter"),
  equipmentFilter: document.querySelector("#equipmentFilter"),
  resetViewButton: document.querySelector("#resetViewButton"),
  uploadButton: document.querySelector("#uploadButton"),
  visibilityPanel: document.querySelector(".visibility-panel"),
  visibilityPanelToggle: document.querySelector("#visibilityPanelToggle"),
  visibilityToggle: document.querySelector("#visibilityToggle"),
  placeSelect: document.querySelector("#placeSelect"),
  atlasCoordinateEditor: document.querySelector("#atlasCoordinateEditor"),
  atlasLatitudeInput: document.querySelector("#atlasLatitudeInput"),
  atlasLongitudeInput: document.querySelector("#atlasLongitudeInput"),
  atlasApplyCoordinatesButton: document.querySelector("#atlasApplyCoordinatesButton"),
  atlasCoordinateError: document.querySelector("#atlasCoordinateError"),
  layersPanel: document.querySelector("#layersPanel"),
  layersPanelToggle: document.querySelector("#layersPanelToggle"),
  photoLayerToggle: document.querySelector("#photoLayerToggle"),
  catalogLayerToggle: document.querySelector("#catalogLayerToggle"),
  solarLayerToggle: document.querySelector("#solarLayerToggle"),
  catalogShowAllToggle: document.querySelector("#catalogShowAllToggle"),
  catalogShowAllLabel: document.querySelector("#catalogShowAllLabel"),
  catalogPhotoFilter: document.querySelector("#catalogPhotoFilter"),
  catalogPhotoStatusInputs: [...document.querySelectorAll('input[name="catalogPhotoStatus"]')],
  catalogAllCount: document.querySelector("#catalogAllCount"),
  catalogPhotographedCount: document.querySelector("#catalogPhotographedCount"),
  catalogUnphotographedCount: document.querySelector("#catalogUnphotographedCount"),
  catalogFiltersButton: document.querySelector("#catalogFiltersButton"),
  catalogQuickResetButton: document.querySelector("#catalogQuickResetButton"),
  catalogFilterSummary: document.querySelector("#catalogFilterSummary"),
  photoLayerCount: document.querySelector("#photoLayerCount"),
  solarLayerCount: document.querySelector("#solarLayerCount"),
  catalogLayerStatus: document.querySelector("#catalogLayerStatus"),
  catalogDensityStatus: document.querySelector("#catalogDensityStatus"),
  catalogSelectionPanel: document.querySelector("#catalogSelectionPanel"),
  catalogSelectionName: document.querySelector("#catalogSelectionName"),
  catalogSelectionStatus: document.querySelector("#catalogSelectionStatus"),
  catalogOpenPhotosButton: document.querySelector("#catalogOpenPhotosButton"),
  catalogClearSelectionButton: document.querySelector("#catalogClearSelectionButton"),
  visibilityDate: document.querySelector("#visibilityDate"),
  visibilityTime: document.querySelector("#visibilityTime"),
  nowVisibilityButton: document.querySelector("#nowVisibilityButton"),
  visibilityStatus: document.querySelector("#visibilityStatus"),
  timeStepButtons: [...document.querySelectorAll("[data-time-step-minutes], [data-time-step-days]")],
  timePlaybackButton: document.querySelector("#timePlaybackButton"),
  timePlaybackStep: document.querySelector("#timePlaybackStep"),
  timeTimeline: document.querySelector("#timeTimeline"),
  timeWindowTrack: document.querySelector("#timeWindowTrack"),
  timeWindowPrimary: document.querySelector("#timeWindowPrimary"),
  timeWindowOverflow: document.querySelector("#timeWindowOverflow"),
  timeWindowOutput: document.querySelector("#timeWindowOutput"),
  orientationHud: document.querySelector("#orientationHud"),
  orientationHudToggle: document.querySelector("#orientationHudToggle"),
  mapPositionReadout: document.querySelector("#mapPositionReadout"),
  orientationDirections: document.querySelector(".orientation-directions"),
  meridianLegend: document.querySelector(".orientation-legend .is-meridian")?.closest("span"),
  zenithLegend: document.querySelector(".orientation-legend .legend-zenith")?.closest("span"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  visibleCount: document.querySelector("#visibleCount"),
  placedCount: document.querySelector("#placedCount"),
  catalogMapCount: document.querySelector("#catalogMapCount"),
  recommendationMapCount: document.querySelector("#recommendationMapCount"),
  solarMapCount: document.querySelector("#solarMapCount"),
  listCount: document.querySelector("#listCount"),
  photoListTitle: document.querySelector("#photoListTitle"),
  clearPhotoTargetFilterButton: document.querySelector("#clearPhotoTargetFilterButton"),
  objectList: document.querySelector("#objectList"),
  detailPanel: document.querySelector("#detailPanel"),
  sidebarTabs: [...document.querySelectorAll("[data-sidebar-mode]")],
  photoResultsWrap: document.querySelector("#photoResultsWrap"),
  catalogResultsWrap: document.querySelector("#catalogResultsWrap"),
  recommendationResultsWrap: document.querySelector("#recommendationResultsWrap"),
  solarResultsWrap: document.querySelector("#solarResultsWrap"),
  catalogResultsCount: document.querySelector("#catalogResultsCount"),
  catalogResultsList: document.querySelector("#catalogResultsList"),
  recommendationResultsCount: document.querySelector("#recommendationResultsCount"),
  recommendationResultsList: document.querySelector("#recommendationResultsList"),
  recommendationFilterButton: document.querySelector("#recommendationFilterButton"),
  recommendationPlaceLabel: document.querySelector("#recommendationPlaceLabel"),
  recommendationTimeLabel: document.querySelector("#recommendationTimeLabel"),
  recommendationWindowLabel: document.querySelector("#recommendationWindowLabel"),
  recommendationPhotoStatusInputs: [...document.querySelectorAll('input[name="recommendationPhotoStatus"]')],
  recommendationLimit: document.querySelector("#recommendationLimit"),
  recommendationLimitOutput: document.querySelector("#recommendationLimitOutput"),
  recommendationActiveFilters: document.querySelector("#recommendationActiveFilters"),
  solarResultsCount: document.querySelector("#solarResultsCount"),
  solarResultsList: document.querySelector("#solarResultsList"),
  solarPlaceLabel: document.querySelector("#solarPlaceLabel"),
  solarTimeLabel: document.querySelector("#solarTimeLabel"),
  catalogSearchInput: document.querySelector("#catalogSearchInput"),
  catalogActiveFilters: document.querySelector("#catalogActiveFilters"),
  catalogResultsFilterButton: document.querySelector("#catalogResultsFilterButton"),
  catalogResultsResetButton: document.querySelector("#catalogResultsResetButton"),
  catalogFiltersDialog: document.querySelector("#catalogFiltersDialog"),
  catalogFiltersForm: document.querySelector("#catalogFiltersForm"),
  catalogFiltersCloseButton: document.querySelector("#catalogFiltersCloseButton"),
  catalogFiltersCancelButton: document.querySelector("#catalogFiltersCancelButton"),
  catalogFiltersResetButton: document.querySelector("#catalogFiltersResetButton"),
  catalogGroupFilter: document.querySelector("#catalogGroupFilter"),
  catalogTypeFilter: document.querySelector("#catalogTypeFilter"),
  catalogPriorityInputs: [...document.querySelectorAll('input[name="catalogPriority"]')],
  catalogMembershipInputs: [...document.querySelectorAll('input[name="catalogMembership"]')],
  catalogFramingInputs: [...document.querySelectorAll('input[name="catalogFraming"]')],
  catalogCaptureFilter: document.querySelector("#catalogCaptureFilter"),
  catalogDifficultyFilter: document.querySelector("#catalogDifficultyFilter"),
  catalogDifficultyOutput: document.querySelector("#catalogDifficultyOutput"),
  catalogSuitabilityFilter: document.querySelector("#catalogSuitabilityFilter"),
  catalogSuitabilityOutput: document.querySelector("#catalogSuitabilityOutput"),
  catalogIntegrationFilter: document.querySelector("#catalogIntegrationFilter"),
  catalogIntegrationOutput: document.querySelector("#catalogIntegrationOutput"),
  catalogAngularMinFilter: document.querySelector("#catalogAngularMinFilter"),
  catalogAngularMaxFilter: document.querySelector("#catalogAngularMaxFilter"),
  catalogVisibilityMode: document.querySelector("#catalogVisibilityMode"),
  catalogMinimumAltitude: document.querySelector("#catalogMinimumAltitude"),
  catalogMinimumAltitudeOutput: document.querySelector("#catalogMinimumAltitudeOutput"),
  catalogWindowHours: document.querySelector("#catalogWindowHours"),
  catalogWindowHoursOutput: document.querySelector("#catalogWindowHoursOutput"),
  catalogMinimumDuration: document.querySelector("#catalogMinimumDuration"),
  catalogMinimumDurationOutput: document.querySelector("#catalogMinimumDurationOutput"),
  catalogDurationSetting: document.querySelector("[data-duration-setting]"),
  catalogDirectionMode: document.querySelector("#catalogDirectionMode"),
  catalogCustomAzimuth: document.querySelector("#catalogCustomAzimuth"),
  catalogAzimuthStart: document.querySelector("#catalogAzimuthStart"),
  catalogAzimuthEnd: document.querySelector("#catalogAzimuthEnd"),
  catalogHorizonEnabled: document.querySelector("#catalogHorizonEnabled"),
  catalogHorizonProfile: document.querySelector("#catalogHorizonProfile"),
  catalogHorizonInputs: [...document.querySelectorAll("[data-horizon-direction]")],
  catalogPolarVisibilityStatus: document.querySelector("#catalogPolarVisibilityStatus"),
  dialog: document.querySelector("#objectDialog"),
  form: document.querySelector("#objectForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogMode: document.querySelector("#dialogMode"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
  cancelButton: document.querySelector("#cancelButton"),
  deleteButton: document.querySelector("#deleteButton"),
  fileField: document.querySelector("#fileField"),
  photoInput: document.querySelector("#photoInput"),
  constellationOptions: document.querySelector("#constellationOptions"),
};

const fields = {
  catalogTargetId: document.querySelector("#catalogTargetIdInput"),
  title: document.querySelector("#titleInput"),
  objectId: document.querySelector("#objectIdInput"),
  commonName: document.querySelector("#commonNameInput"),
  type: document.querySelector("#typeInput"),
  constellation: document.querySelector("#constellationInput"),
  ra: document.querySelector("#raInput"),
  dec: document.querySelector("#decInput"),
  date: document.querySelector("#dateInput"),
  equipment: document.querySelector("#equipmentInput"),
  exposure: document.querySelector("#exposureInput"),
  location: document.querySelector("#locationInput"),
  notes: document.querySelector("#notesInput"),
};

function readPanelCollapsedPreference(key) {
  const value = readLocationStorage(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function setMapPanelCollapsed(panel, button, collapsed, labels) {
  panel.classList.toggle("is-collapsed", collapsed);
  button.setAttribute("aria-expanded", String(!collapsed));
  const actionLabel = collapsed ? labels.show : labels.hide;
  button.setAttribute("aria-label", actionLabel);
  button.title = actionLabel;
  button.querySelector("span").textContent = collapsed ? "+" : "\u2212";
}

function setupCollapsibleMapPanels() {
  const mobileLayout = window.matchMedia(MOBILE_LAYOUT_QUERY);
  const panels = [
    {
      panel: elements.visibilityPanel,
      button: elements.visibilityPanelToggle,
      storageKey: MOBILE_VISIBILITY_PANEL_KEY,
      mobileGroup: "top",
      labels: { show: "Zobrazit nastavení mapy", hide: "Skrýt nastavení mapy" },
    },
    {
      panel: elements.orientationHud,
      button: elements.orientationHudToggle,
      storageKey: MOBILE_ORIENTATION_PANEL_KEY,
      labels: { show: "Zobrazit legendu mapy", hide: "Skrýt legendu mapy" },
    },
    {
      panel: elements.layersPanel,
      button: elements.layersPanelToggle,
      storageKey: MOBILE_LAYERS_PANEL_KEY,
      mobileGroup: "top",
      labels: { show: "Zobrazit vrstvy mapy", hide: "Skrýt vrstvy mapy" },
    },
  ];

  function collapseOtherMobilePanels(activeConfig) {
    if (!mobileLayout.matches || !activeConfig.mobileGroup) return;
    for (const config of panels) {
      if (config === activeConfig || config.mobileGroup !== activeConfig.mobileGroup) continue;
      setMapPanelCollapsed(config.panel, config.button, true, config.labels);
      writeLocationStorage(config.storageKey, "true");
    }
  }

  for (const config of panels) {
    const preference = readPanelCollapsedPreference(config.storageKey);
    const initialCollapsed = mobileLayout.matches ? true : (preference ?? false);
    setMapPanelCollapsed(config.panel, config.button, initialCollapsed, config.labels);
    config.button.addEventListener("click", () => {
      const collapsed = !config.panel.classList.contains("is-collapsed");
      setMapPanelCollapsed(config.panel, config.button, collapsed, config.labels);
      writeLocationStorage(config.storageKey, String(collapsed));
      if (!collapsed) collapseOtherMobilePanels(config);
    });
  }

  if (mobileLayout.matches) {
    const expandedTopPanels = panels.filter((config) => config.mobileGroup === "top" && !config.panel.classList.contains("is-collapsed"));
    for (const config of expandedTopPanels.slice(1)) {
      setMapPanelCollapsed(config.panel, config.button, true, config.labels);
      writeLocationStorage(config.storageKey, "true");
    }
  }

  mobileLayout.addEventListener("change", (event) => {
    for (const config of panels) {
      const preference = readPanelCollapsedPreference(config.storageKey);
      if (event.matches) setMapPanelCollapsed(config.panel, config.button, true, config.labels);
      else if (preference === null) setMapPanelCollapsed(config.panel, config.button, false, config.labels);
    }
    if (event.matches) {
      const expandedTopPanel = panels.find((config) => config.mobileGroup === "top" && !config.panel.classList.contains("is-collapsed"));
      if (expandedTopPanel) collapseOtherMobilePanels(expandedTopPanel);
    }
  });
}

const ctx = elements.canvas.getContext("2d");
const visibilityMaskCanvas = document.createElement("canvas");
const visibilityMaskContext = visibilityMaskCanvas.getContext("2d");
visibilityMaskCanvas.width = VISIBILITY_MASK_WIDTH;
visibilityMaskCanvas.height = VISIBILITY_MASK_HEIGHT;
let visibilityMaskKey = "";
let altitudeContourCache = { key: "", segments: [] };

const STAR_CATALOG = [
  { name: "Sirius", ra: "06h 45m 08s", dec: "-16° 42' 58\"", mag: -1.46, con: "Canis Major" },
  { name: "Canopus", ra: "06h 23m 57s", dec: "-52° 41' 44\"", mag: -0.74, con: "Carina" },
  { name: "Arcturus", ra: "14h 15m 40s", dec: "+19° 10' 56\"", mag: -0.05, con: "Boötes" },
  { name: "Vega", ra: "18h 36m 56s", dec: "+38° 47' 01\"", mag: 0.03, con: "Lyra" },
  { name: "Capella", ra: "05h 16m 41s", dec: "+45° 59' 53\"", mag: 0.08, con: "Auriga" },
  { name: "Rigel", ra: "05h 14m 32s", dec: "-08° 12' 06\"", mag: 0.13, con: "Orion" },
  { name: "Procyon", ra: "07h 39m 18s", dec: "+05° 13' 30\"", mag: 0.34, con: "Canis Minor" },
  { name: "Betelgeuse", ra: "05h 55m 10s", dec: "+07° 24' 25\"", mag: 0.42, con: "Orion" },
  { name: "Altair", ra: "19h 50m 47s", dec: "+08° 52' 06\"", mag: 0.77, con: "Aquila" },
  { name: "Aldebaran", ra: "04h 35m 55s", dec: "+16° 30' 33\"", mag: 0.86, con: "Taurus" },
  { name: "Spica", ra: "13h 25m 12s", dec: "-11° 09' 41\"", mag: 0.98, con: "Virgo" },
  { name: "Antares", ra: "16h 29m 24s", dec: "-26° 25' 55\"", mag: 1.06, con: "Scorpius" },
  { name: "Pollux", ra: "07h 45m 19s", dec: "+28° 01' 34\"", mag: 1.14, con: "Gemini" },
  { name: "Fomalhaut", ra: "22h 57m 39s", dec: "-29° 37' 20\"", mag: 1.16, con: "Piscis Austrinus" },
  { name: "Deneb", ra: "20h 41m 26s", dec: "+45° 16' 49\"", mag: 1.25, con: "Cygnus" },
  { name: "Regulus", ra: "10h 08m 22s", dec: "+11° 58' 02\"", mag: 1.35, con: "Leo" },
  { name: "Castor", ra: "07h 34m 36s", dec: "+31° 53' 18\"", mag: 1.58, con: "Gemini" },
  { name: "Bellatrix", ra: "05h 25m 08s", dec: "+06° 20' 59\"", mag: 1.64, con: "Orion" },
  { name: "Elnath", ra: "05h 26m 18s", dec: "+28° 36' 27\"", mag: 1.65, con: "Taurus" },
  { name: "Alnilam", ra: "05h 36m 12s", dec: "-01° 12' 07\"", mag: 1.69, con: "Orion" },
  { name: "Alnitak", ra: "05h 40m 45s", dec: "-01° 56' 34\"", mag: 1.74, con: "Orion" },
  { name: "Alioth", ra: "12h 54m 02s", dec: "+55° 57' 35\"", mag: 1.77, con: "Ursa Major" },
  { name: "Mirfak", ra: "03h 24m 19s", dec: "+49° 51' 40\"", mag: 1.79, con: "Perseus" },
  { name: "Dubhe", ra: "11h 03m 44s", dec: "+61° 45' 04\"", mag: 1.79, con: "Ursa Major" },
  { name: "Mirzam", ra: "06h 22m 42s", dec: "-17° 57' 21\"", mag: 1.98, con: "Canis Major" },
  { name: "Alkaid", ra: "13h 47m 32s", dec: "+49° 18' 48\"", mag: 1.86, con: "Ursa Major" },
  { name: "Sadr", ra: "20h 22m 14s", dec: "+40° 15' 24\"", mag: 2.23, con: "Cygnus" },
  { name: "Mizar", ra: "13h 23m 56s", dec: "+54° 55' 31\"", mag: 2.23, con: "Ursa Major" },
  { name: "Merak", ra: "11h 01m 51s", dec: "+56° 22' 57\"", mag: 2.37, con: "Ursa Major" },
  { name: "Phecda", ra: "11h 53m 49s", dec: "+53° 41' 41\"", mag: 2.44, con: "Ursa Major" },
  { name: "Megrez", ra: "12h 15m 25s", dec: "+57° 01' 57\"", mag: 3.31, con: "Ursa Major" },
  { name: "Alpheratz", ra: "00h 08m 23s", dec: "+29° 05' 26\"", mag: 2.06, con: "Andromeda" },
  { name: "Mirach", ra: "01h 09m 44s", dec: "+35° 37' 14\"", mag: 2.07, con: "Andromeda" },
  { name: "Almach", ra: "02h 03m 54s", dec: "+42° 19' 47\"", mag: 2.1, con: "Andromeda" },
  { name: "Markab", ra: "23h 04m 45s", dec: "+15° 12' 19\"", mag: 2.49, con: "Pegasus" },
  { name: "Scheat", ra: "23h 03m 46s", dec: "+28° 04' 58\"", mag: 2.42, con: "Pegasus" },
  { name: "Algenib", ra: "00h 13m 14s", dec: "+15° 11' 01\"", mag: 2.83, con: "Pegasus" },
  { name: "Caph", ra: "00h 09m 10s", dec: "+59° 08' 59\"", mag: 2.27, con: "Cassiopeia" },
  { name: "Schedar", ra: "00h 40m 30s", dec: "+56° 32' 14\"", mag: 2.24, con: "Cassiopeia" },
  { name: "Cih", ra: "00h 56m 42s", dec: "+60° 43' 00\"", mag: 2.15, con: "Cassiopeia" },
  { name: "Ruchbah", ra: "01h 25m 49s", dec: "+60° 14' 07\"", mag: 2.68, con: "Cassiopeia" },
  { name: "Segin", ra: "01h 54m 23s", dec: "+63° 40' 12\"", mag: 3.35, con: "Cassiopeia" },
  { name: "Alhena", ra: "06h 37m 43s", dec: "+16° 23' 57\"", mag: 1.93, con: "Gemini" },
  { name: "Mintaka", ra: "05h 32m 00s", dec: "-00° 17' 57\"", mag: 2.23, con: "Orion" },
  { name: "Saiph", ra: "05h 47m 45s", dec: "-09° 40' 11\"", mag: 2.07, con: "Orion" },
  { name: "Meissa", ra: "05h 35m 08s", dec: "+09° 56' 03\"", mag: 3.39, con: "Orion" },
  { name: "Maia", ra: "03h 45m 49s", dec: "+24° 22' 03\"", mag: 3.87, con: "Taurus" },
  { name: "Alcyone", ra: "03h 47m 29s", dec: "+24° 06' 18\"", mag: 2.87, con: "Taurus" },
  { name: "Electra", ra: "03h 44m 52s", dec: "+24° 06' 48\"", mag: 3.7, con: "Taurus" },
  { name: "Merope", ra: "03h 46m 19s", dec: "+23° 56' 54\"", mag: 4.18, con: "Taurus" },
  { name: "Kornephoros", ra: "16h 30m 13s", dec: "+21° 29' 22\"", mag: 2.78, con: "Hercules" },
  { name: "Ras Algethi", ra: "17h 14m 38s", dec: "+14° 23' 25\"", mag: 3.48, con: "Hercules" },
  { name: "Sarin", ra: "17h 15m 02s", dec: "+24° 50' 21\"", mag: 3.12, con: "Hercules" },
  { name: "Pi Her", ra: "17h 15m 02s", dec: "+36° 48' 33\"", mag: 3.16, con: "Hercules" },
  { name: "Eta Her", ra: "16h 42m 54s", dec: "+38° 55' 20\"", mag: 3.49, con: "Hercules" },
  { name: "Zeta Her", ra: "16h 41m 17s", dec: "+31° 36' 09\"", mag: 2.81, con: "Hercules" },
  { name: "Epsilon Her", ra: "17h 00m 17s", dec: "+30° 55' 35\"", mag: 3.92, con: "Hercules" },
  { name: "Nekkar", ra: "15h 01m 57s", dec: "+40° 23' 26\"", mag: 3.49, con: "Boötes" },
  { name: "Seginus", ra: "14h 32m 04s", dec: "+38° 18' 29\"", mag: 3.03, con: "Boötes" },
  { name: "Izar", ra: "14h 44m 59s", dec: "+27° 04' 27\"", mag: 2.37, con: "Boötes" },
  { name: "Muphrid", ra: "13h 54m 41s", dec: "+18° 23' 51\"", mag: 2.68, con: "Boötes" },
  { name: "Delta Boo", ra: "15h 15m 30s", dec: "+33° 18' 54\"", mag: 3.47, con: "Boötes" },
  { name: "Porrima", ra: "12h 41m 40s", dec: "-01° 26' 58\"", mag: 2.74, con: "Virgo" },
  { name: "Vindemiatrix", ra: "13h 02m 10s", dec: "+10° 57' 33\"", mag: 2.85, con: "Virgo" },
  { name: "Zavijava", ra: "11h 50m 41s", dec: "+01° 45' 53\"", mag: 3.61, con: "Virgo" },
  { name: "Auva", ra: "12h 55m 36s", dec: "+03° 23' 51\"", mag: 3.38, con: "Virgo" },
  { name: "Heze", ra: "13h 34m 42s", dec: "-00° 35' 45\"", mag: 3.38, con: "Virgo" },
  { name: "Syrma", ra: "14h 16m 00s", dec: "-06° 00' 02\"", mag: 4.08, con: "Virgo" },
  { name: "Alphecca", ra: "15h 34m 41s", dec: "+26° 42' 53\"", mag: 2.23, con: "Corona Borealis" },
  { name: "Nusakan", ra: "15h 27m 49s", dec: "+29° 06' 20\"", mag: 3.68, con: "Corona Borealis" },
  { name: "Gienah", ra: "20h 46m 12s", dec: "+33° 58' 13\"", mag: 2.48, con: "Cygnus" },
  { name: "Albireo", ra: "19h 30m 43s", dec: "+27° 57' 35\"", mag: 3.05, con: "Cygnus" },
  { name: "Eltanin", ra: "17h 56m 36s", dec: "+51° 29' 20\"", mag: 2.24, con: "Draco" },
  { name: "Shaula", ra: "17h 33m 37s", dec: "-37° 06' 13\"", mag: 1.62, con: "Scorpius" },
  { name: "Sargas", ra: "17h 37m 19s", dec: "-42° 59' 52\"", mag: 1.86, con: "Scorpius" },
  { name: "Kaus Australis", ra: "18h 24m 10s", dec: "-34° 23' 05\"", mag: 1.79, con: "Sagittarius" },
  { name: "Nunki", ra: "18h 55m 16s", dec: "-26° 17' 48\"", mag: 2.05, con: "Sagittarius" },
];

const CONSTELLATION_LINES = [
  { name: "Orion", stars: ["Betelgeuse", "Bellatrix", "Mintaka", "Alnilam", "Alnitak", "Saiph", "Rigel", "Mintaka", "Meissa", "Betelgeuse"] },
  { name: "Ursa Major", stars: ["Dubhe", "Merak", "Phecda", "Megrez", "Alioth", "Mizar", "Alkaid"] },
  { name: "Cassiopeia", stars: ["Caph", "Schedar", "Cih", "Ruchbah", "Segin"] },
  { name: "Andromeda", stars: ["Alpheratz", "Mirach", "Almach"] },
  { name: "Pegasus", stars: ["Alpheratz", "Algenib", "Markab", "Scheat", "Alpheratz"] },
  { name: "Taurus", stars: ["Elnath", "Aldebaran", "Alcyone", "Maia", "Electra", "Merope"] },
  { name: "Gemini", stars: ["Castor", "Pollux", "Alhena"] },
  { name: "Hercules", stars: ["Kornephoros", "Zeta Her", "Eta Her", "Pi Her", "Epsilon Her", "Sarin", "Ras Algethi", "Kornephoros"] },
  { name: "Boötes", stars: ["Nekkar", "Seginus", "Izar", "Arcturus", "Muphrid", "Arcturus", "Delta Boo", "Nekkar"] },
  { name: "Virgo", stars: ["Zavijava", "Porrima", "Spica", "Heze", "Auva", "Vindemiatrix", "Syrma"] },
  { name: "Corona Borealis", stars: ["Nusakan", "Alphecca"] },
  { name: "Cygnus", stars: ["Deneb", "Sadr", "Gienah", "Sadr", "Albireo"] },
  { name: "Aquila", stars: ["Altair"] },
  { name: "Lyra", stars: ["Vega"] },
  { name: "Scorpius", stars: ["Antares", "Shaula", "Sargas"] },
  { name: "Sagittarius", stars: ["Kaus Australis", "Nunki"] },
];

const CONSTELLATION_LABELS = [
  { name: "Boötes", ra: "14h 35m", dec: "+31°" },
  { name: "Hercules", ra: "16h 55m", dec: "+30°" },
  { name: "Virgo", ra: "13h 05m", dec: "+1°" },
  { name: "Orion", ra: "05h 35m", dec: "+1°" },
  { name: "Ursa Major", ra: "12h 25m", dec: "+56°" },
  { name: "Cassiopeia", ra: "01h 00m", dec: "+60°" },
  { name: "Cygnus", ra: "20h 20m", dec: "+39°" },
  { name: "Lyra", ra: "18h 45m", dec: "+38°" },
  { name: "Andromeda", ra: "01h 00m", dec: "+38°" },
  { name: "Pegasus", ra: "23h 20m", dec: "+22°" },
  { name: "Taurus", ra: "04h 20m", dec: "+22°" },
  { name: "Gemini", ra: "07h 15m", dec: "+25°" },
  { name: "Scorpius", ra: "16h 55m", dec: "-31°" },
  { name: "Sagittarius", ra: "18h 40m", dec: "-29°" },
];

const starByName = new Map();
for (const star of STAR_CATALOG) {
  star.raDeg = parseRA(star.ra);
  star.decDeg = parseDec(star.dec);
  starByName.set(star.name, star);
}

const backgroundStars = createBackgroundStars();

function createBackgroundStars() {
  let seed = 20260620;
  const stars = [];
  function random() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 900; i += 1) {
    const raDeg = random() * 360;
    const decDeg = Math.asin(random() * 2 - 1) * (180 / Math.PI);
    const tone = random();
    stars.push({
      raDeg,
      decDeg,
      size: 0.45 + random() * 1.2,
      alpha: 0.16 + tone * 0.52,
    });
  }
  return stars;
}

function parseRA(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw
    .replace(",", ".")
    .replace(/[−–]/g, "-")
    .replace(/[hms]/gi, " ")
    .replace(/[°º]/g, " ")
    .replace(/[:]/g, " ");
  const numbers = normalized.match(/[+-]?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length === 0 || numbers.some(Number.isNaN)) return null;
  if (numbers.length === 1) {
    const single = numbers[0];
    const deg = Math.abs(single) <= 24 ? single * 15 : single;
    return normalizeDegrees(deg);
  }
  const sign = numbers[0] < 0 ? -1 : 1;
  const hours = Math.abs(numbers[0]) + (numbers[1] || 0) / 60 + (numbers[2] || 0) / 3600;
  return normalizeDegrees(sign * hours * 15);
}

function parseDec(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw
    .replace(",", ".")
    .replace(/[−–]/g, "-")
    .replace(/[d°º'"]/gi, " ")
    .replace(/[:]/g, " ");
  const numbers = normalized.match(/[+-]?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (numbers.length === 0 || numbers.some(Number.isNaN)) return null;
  const sign = raw.trim().startsWith("-") || numbers[0] < 0 ? -1 : 1;
  const degrees = Math.abs(numbers[0]) + (numbers[1] || 0) / 60 + (numbers[2] || 0) / 3600;
  return Math.max(-90, Math.min(90, sign * degrees));
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function normalizeSignedDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeInput(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function greenwichSiderealTimeDeg(date) {
  return catalogVisibilityApi.greenwichSiderealTimeDeg(date);
}

function localSiderealTimeDeg(date, lonDeg) {
  return catalogVisibilityApi.localSiderealTimeDeg(date, lonDeg);
}

function formatSiderealTime(deg) {
  const totalMinutes = Math.round((normalizeDegrees(deg) / 15) * 60) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function getSelectedPlace() {
  return AstroLocation.getPlace(state.visibility.placeId);
}

function getVisibilityDate() {
  return timeControlsApi.parseLocal(elements.visibilityDate.value, elements.visibilityTime.value || "00:00");
}

function getAtlasCalculationContext() {
  const place = getSelectedPlace();
  const date = getVisibilityDate();
  return date ? { place, date } : null;
}

function getVisibilityContext() {
  if (!state.visibility.enabled) return null;
  const calculationContext = getAtlasCalculationContext();
  if (!calculationContext) return null;
  const { place, date } = calculationContext;
  const lstDeg = localSiderealTimeDeg(date, place.lon);
  return {
    place,
    date,
    lstDeg,
    latRad: place.lat * DEG_TO_RAD,
  };
}

function altitudeSine(raDeg, decDeg, visibilityContext) {
  return catalogVisibilityApi.altitudeSineFromLst(
    raDeg,
    decDeg,
    visibilityContext.lstDeg,
    visibilityContext.place.lat,
  );
}

function horizontalCoordinates(raDeg, decDeg, visibilityContext) {
  const horizontal = catalogVisibilityApi.horizontalFromLst(
    raDeg,
    decDeg,
    visibilityContext.lstDeg,
    visibilityContext.place.lat,
  );
  return {
    alt: horizontal.altitudeDeg,
    az: horizontal.azimuthDeg,
  };
}

function equatorialFromHorizontal(altDeg, azDeg, visibilityContext) {
  const altitudeRad = altDeg * DEG_TO_RAD;
  const azimuthRad = azDeg * DEG_TO_RAD;
  const sinLatitude = Math.sin(visibilityContext.latRad);
  const rawCosLatitude = Math.cos(visibilityContext.latRad);
  const cosLatitude = Math.abs(rawCosLatitude) < 1e-12 ? 0 : rawCosLatitude;
  const sinDec =
    Math.sin(altitudeRad) * sinLatitude +
    Math.cos(altitudeRad) * cosLatitude * Math.cos(azimuthRad);
  const decRad = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const hourAngleRad = Math.atan2(
    -Math.sin(azimuthRad) * Math.cos(altitudeRad),
    Math.sin(altitudeRad) * cosLatitude -
      Math.cos(altitudeRad) * sinLatitude * Math.cos(azimuthRad),
  );
  return {
    raDeg: normalizeDegrees(visibilityContext.lstDeg - hourAngleRad * RAD_TO_DEG),
    decDeg: decRad * RAD_TO_DEG,
  };
}

function altitudeDeg(raDeg, decDeg, visibilityContext) {
  return horizontalCoordinates(raDeg, decDeg, visibilityContext).alt;
}

function isSkyPositionVisible(raDeg, decDeg, visibilityContext) {
  return altitudeSine(raDeg, decDeg, visibilityContext) >= 0;
}

function hasStableCardinalDirections(visibilityContext) {
  return Math.abs(visibilityContext.place.lat) < POLAR_DIRECTION_LIMIT;
}

function project(raDeg, decDeg) {
  return {
    x: ((360 - normalizeDegrees(raDeg)) / 360) * BASE_WIDTH,
    y: ((90 - decDeg) / 180) * BASE_HEIGHT,
  };
}

function toScreen(point) {
  return {
    x: point.x * state.view.scale + state.view.x,
    y: point.y * state.view.scale + state.view.y,
  };
}

function toWorld(point) {
  return {
    x: (point.x - state.view.x) / state.view.scale,
    y: (point.y - state.view.y) / state.view.scale,
  };
}

function compassDirectionName(azimuthDeg) {
  const directions = ["sever", "severovýchod", "východ", "jihovýchod", "jih", "jihozápad", "západ", "severozápad"];
  return directions[Math.round(normalizeDegrees(azimuthDeg) / 45) % directions.length];
}

function skyPositionAtScreenPoint(point) {
  const world = toWorld(point);
  if (world.x < 0 || world.x > BASE_WIDTH || world.y < 0 || world.y > BASE_HEIGHT) return null;
  return {
    raDeg: normalizeDegrees(360 - (world.x / BASE_WIDTH) * 360),
    decDeg: 90 - (world.y / BASE_HEIGHT) * 180,
  };
}

function updateMapPositionReadout(point = null) {
  const visibilityContext = getVisibilityContext();
  elements.orientationHud.hidden = !visibilityContext;
  const stableDirections = visibilityContext ? hasStableCardinalDirections(visibilityContext) : true;
  elements.orientationDirections.hidden = !stableDirections;
  if (elements.meridianLegend) elements.meridianLegend.hidden = !stableDirections;
  if (elements.zenithLegend) elements.zenithLegend.hidden = !stableDirections;
  if (!visibilityContext || !point) {
    elements.mapPositionReadout.textContent = "Výška — · azimut —";
    elements.mapPositionReadout.classList.remove("is-below");
    return;
  }

  const skyPosition = skyPositionAtScreenPoint(point);
  if (!skyPosition) {
    elements.mapPositionReadout.textContent = "Výška — · azimut —";
    elements.mapPositionReadout.classList.remove("is-below");
    return;
  }

  const horizontal = horizontalCoordinates(skyPosition.raDeg, skyPosition.decDeg, visibilityContext);
  const altitude = Math.round(horizontal.alt);
  const azimuth = Math.round(horizontal.az) % 360;
  const altitudeLabel = `${altitude > 0 ? "+" : ""}${altitude}°`;
  elements.mapPositionReadout.textContent = stableDirections
    ? `Výška ${altitudeLabel} · azimut ${azimuth}° · ${compassDirectionName(horizontal.az)}`
    : `Výška ${altitudeLabel} · světové strany na pólu neurčité`;
  elements.mapPositionReadout.classList.toggle("is-below", horizontal.alt < 0);
}

function imageSrc(path) {
  return `/${String(path || "").split("/").map(encodeURIComponent).join("/")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatDecimal(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("cs-CZ", { maximumFractionDigits: digits });
}

function getObjectPosition(record) {
  const raDeg = parseRA(record.ra);
  const decDeg = parseDec(record.dec);
  if (raDeg === null || decDeg === null) {
    return null;
  }
  return { raDeg, decDeg, ...project(raDeg, decDeg) };
}

function getYear(record) {
  const match = String(record.date || "").match(/^(\d{4})/);
  return match ? match[1] : "";
}

function validateCatalogPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.targets)) {
    throw new Error("Katalog objektů nemá očekávanou strukturu.");
  }
  if (!Number.isInteger(payload.targetCount) || payload.targetCount !== payload.targets.length) {
    throw new Error("Nesouhlasí počet objektů v katalogu.");
  }

  const targetIds = new Set();
  for (const target of payload.targets) {
    const targetId = String(target?.targetId || "");
    const raDeg = target?.coordinates?.raDeg;
    const decDeg = target?.coordinates?.decDeg;
    if (!targetId || targetIds.has(targetId)) {
      throw new Error(`Katalog obsahuje neplatné nebo duplicitní ID: ${targetId || "—"}.`);
    }
    if (!Number.isFinite(raDeg) || raDeg < 0 || raDeg >= 360 || !Number.isFinite(decDeg) || decDeg < -90 || decDeg > 90) {
      throw new Error(`Katalogový cíl ${targetId} má neplatné souřadnice.`);
    }
    targetIds.add(targetId);
  }
}

async function loadCatalog() {
  const response = await fetch("data/catalog.json");
  if (!response.ok) {
    throw new Error("Nepovedlo se načíst katalog objektů.");
  }
  const payload = await response.json();
  validateCatalogPayload(payload);
  const { targets, ...metadata } = payload;
  state.catalog.metadata = metadata;
  state.catalog.targets = targets;
  state.catalog.filtered = targets;
  state.catalog.byId = new Map(targets.map((target) => [target.targetId, target]));
  refreshPhotoLinkIndex();
  populateCatalogTargetSelect();
  populateCatalogFilterOptions();
  syncCatalogFilterControls();
  applyCatalogFilters({ preserveSelection: true, render: false });
  updateLayerPanel();
}

async function loadObjects() {
  const response = await fetch("data/objects.json");
  if (!response.ok) {
    throw new Error("Nepovedlo se načíst data atlasu.");
  }
  state.objects = await response.json();
  refreshPhotoLinkIndex();
  if (!state.selectedId && state.objects.length) {
    state.selectedId = state.objects[0].id;
  }
  rebuildFilters();
  applyFilters();
  renderConstellationOptions();
  applyCatalogFilters({ preserveSelection: true, render: false });
  updateLayerPanel();
}

function refreshPhotoLinkIndex() {
  state.catalog.photoLinks = catalogMapApi.buildPhotoLinkIndex(
    state.objects,
    new Set(state.catalog.byId.keys()),
  );
}

function populateCatalogTargetSelect() {
  const select = fields.catalogTargetId;
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Bez vazby na katalog</option>';
  const targets = [...state.catalog.targets].sort((left, right) =>
    String(left.displayName || left.targetId).localeCompare(String(right.displayName || right.targetId), "cs"),
  );
  for (const target of targets) {
    const option = document.createElement("option");
    option.value = target.targetId;
    option.textContent = target.displayName === target.targetId
      ? target.targetId
      : `${target.displayName} · ${target.targetId}`;
    select.append(option);
  }
  select.value = state.catalog.byId.has(current) ? current : "";
}

function populateCatalogFilterOptions() {
  elements.catalogGroupFilter.innerHTML = '<option value="">Všechny skupiny</option>';
  for (const group of state.catalog.metadata?.mapGroups || []) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = `${group.label} (${group.count})`;
    elements.catalogGroupFilter.append(option);
  }

  const typeCounts = new Map();
  for (const target of state.catalog.targets) {
    const code = String(target.objectType?.code || "");
    if (!code) continue;
    const entry = typeCounts.get(code) || { code, label: target.objectType.label, count: 0 };
    entry.count += 1;
    typeCounts.set(code, entry);
  }
  elements.catalogTypeFilter.innerHTML = '<option value="">Všechny typy</option>';
  for (const entry of [...typeCounts.values()].sort((left, right) => left.label.localeCompare(right.label, "cs"))) {
    const option = document.createElement("option");
    option.value = entry.code;
    option.textContent = `${entry.label} (${entry.count})`;
    elements.catalogTypeFilter.append(option);
  }
}

function checkedValues(inputs) {
  return inputs.filter((input) => input.checked).map((input) => input.value);
}

function updateCatalogFilterOutputs() {
  elements.catalogDifficultyOutput.textContent = `${elements.catalogDifficultyFilter.value} / 5`;
  elements.catalogSuitabilityOutput.textContent = `${formatDecimal(elements.catalogSuitabilityFilter.value)} / 5`;
  elements.catalogIntegrationOutput.textContent = `${elements.catalogIntegrationFilter.value} min`;
  elements.catalogMinimumAltitudeOutput.textContent = `${elements.catalogMinimumAltitude.value}°`;
  elements.catalogWindowHoursOutput.textContent = `${elements.catalogWindowHours.value} h`;
  const maximumDuration = Number(elements.catalogWindowHours.value) * 60;
  elements.catalogMinimumDuration.max = String(maximumDuration);
  if (Number(elements.catalogMinimumDuration.value) > maximumDuration) {
    elements.catalogMinimumDuration.value = String(maximumDuration);
  }
  elements.catalogMinimumDurationOutput.textContent = formatDurationMinutes(elements.catalogMinimumDuration.value);
  updateCatalogVisibilityControlState();
}

function formatDurationMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} h`;
  return `${hours} h ${remainder} min`;
}

function updateCatalogVisibilityControlState() {
  const mode = elements.catalogVisibilityMode.value;
  const belowNow = mode === "below-now";
  const durationMode = mode === "window-duration";
  const customDirection = elements.catalogDirectionMode.value === "custom";
  const stableDirections = catalogVisibilityApi.hasStableCardinalDirections(getSelectedPlace());

  elements.catalogDurationSetting.classList.toggle("is-setting-disabled", !durationMode);
  elements.catalogMinimumDuration.disabled = !durationMode;
  elements.catalogCustomAzimuth.hidden = !customDirection;
  for (const input of [elements.catalogAzimuthStart, elements.catalogAzimuthEnd]) {
    input.disabled = !customDirection || !stableDirections || belowNow;
  }
  elements.catalogDirectionMode.disabled = !stableDirections || belowNow;
  elements.catalogMinimumAltitude.disabled = belowNow;
  elements.catalogHorizonEnabled.disabled = !stableDirections || belowNow;
  elements.catalogHorizonProfile.hidden = !elements.catalogHorizonEnabled.checked;
  for (const input of elements.catalogHorizonInputs) {
    input.disabled = !elements.catalogHorizonEnabled.checked || !stableDirections || belowNow;
  }
  elements.catalogPolarVisibilityStatus.hidden = stableDirections;
}

function syncCatalogFilterControls() {
  const filters = state.catalog.filters;
  elements.catalogSearchInput.value = filters.query;
  elements.catalogGroupFilter.value = filters.groupId;
  elements.catalogTypeFilter.value = filters.typeCode;
  for (const input of elements.catalogPriorityInputs) input.checked = filters.priorities.includes(input.value);
  for (const input of elements.catalogMembershipInputs) input.checked = filters.memberships.includes(input.value);
  for (const input of elements.catalogFramingInputs) input.checked = filters.framings.includes(input.value);
  elements.catalogCaptureFilter.value = filters.captureMode;
  elements.catalogDifficultyFilter.value = String(filters.difficultyMax);
  elements.catalogSuitabilityFilter.value = String(filters.suitabilityMin);
  elements.catalogIntegrationFilter.value = String(filters.integrationMax);
  elements.catalogAngularMinFilter.value = filters.angularSizeMin ?? "";
  elements.catalogAngularMaxFilter.value = filters.angularSizeMax ?? "";
  const visibility = catalogVisibilityApi.normalizeSettings(filters.visibility);
  elements.catalogVisibilityMode.value = visibility.mode;
  elements.catalogMinimumAltitude.value = String(visibility.minimumAltitudeDeg);
  elements.catalogWindowHours.value = String(visibility.windowHours);
  elements.catalogMinimumDuration.value = String(visibility.minimumDurationMinutes);
  elements.catalogDirectionMode.value = visibility.directionMode;
  elements.catalogAzimuthStart.value = String(visibility.azimuthStartDeg);
  elements.catalogAzimuthEnd.value = String(visibility.azimuthEndDeg);
  elements.catalogHorizonEnabled.checked = visibility.horizonEnabled;
  for (const input of elements.catalogHorizonInputs) {
    input.value = String(visibility.horizonProfile[input.dataset.horizonDirection] || 0);
  }
  for (const input of elements.catalogPhotoStatusInputs) input.checked = input.value === filters.photoStatus;
  for (const input of elements.recommendationPhotoStatusInputs) input.checked = input.value === filters.photoStatus;
  updateCatalogFilterOutputs();
}

function readCatalogDialogFilters() {
  const horizonProfile = Object.fromEntries(
    elements.catalogHorizonInputs.map((input) => [input.dataset.horizonDirection, input.value]),
  );
  return catalogMapApi.normalizeCatalogFilters({
    ...state.catalog.filters,
    angularSizeMax: elements.catalogAngularMaxFilter.value,
    angularSizeMin: elements.catalogAngularMinFilter.value,
    captureMode: elements.catalogCaptureFilter.value,
    difficultyMax: elements.catalogDifficultyFilter.value,
    framings: checkedValues(elements.catalogFramingInputs),
    groupId: elements.catalogGroupFilter.value,
    integrationMax: elements.catalogIntegrationFilter.value,
    memberships: checkedValues(elements.catalogMembershipInputs),
    priorities: checkedValues(elements.catalogPriorityInputs),
    suitabilityMin: elements.catalogSuitabilityFilter.value,
    typeCode: elements.catalogTypeFilter.value,
    visibility: {
      mode: elements.catalogVisibilityMode.value,
      minimumAltitudeDeg: elements.catalogMinimumAltitude.value,
      windowHours: elements.catalogWindowHours.value,
      minimumDurationMinutes: elements.catalogMinimumDuration.value,
      directionMode: elements.catalogDirectionMode.value,
      azimuthStartDeg: elements.catalogAzimuthStart.value,
      azimuthEndDeg: elements.catalogAzimuthEnd.value,
      horizonEnabled: elements.catalogHorizonEnabled.checked,
      horizonProfile,
    },
  });
}

function catalogFilterDescriptions(filters = state.catalog.filters) {
  const descriptions = [];
  if (filters.query) descriptions.push(`Hledání: ${filters.query}`);
  if (filters.groupId) {
    descriptions.push(state.catalog.metadata?.mapGroups?.find((group) => group.id === filters.groupId)?.label || filters.groupId);
  }
  if (filters.typeCode) {
    descriptions.push(state.catalog.targets.find((target) => target.objectType.code === filters.typeCode)?.objectType.label || filters.typeCode);
  }
  if (filters.priorities.length !== catalogMapApi.CATALOG_PRIORITIES.length) {
    descriptions.push(filters.priorities.length ? `Priorita ${filters.priorities.join("+")}` : "Žádná priorita");
  }
  if (filters.memberships.length) descriptions.push(filters.memberships.join(" + "));
  if (filters.framings.length !== catalogMapApi.CATALOG_FRAMINGS.length) {
    descriptions.push(filters.framings.length ? `Rámování ${filters.framings.length}/5` : "Žádné rámování");
  }
  if (filters.captureMode === "astro") descriptions.push("Astro / VIS");
  if (filters.captureMode === "dual-band") descriptions.push("Dual-band");
  if (filters.difficultyMax < 5) descriptions.push(`Obtížnost ≤ ${filters.difficultyMax}`);
  if (filters.suitabilityMin > 2) descriptions.push(`Vhodnost ≥ ${formatDecimal(filters.suitabilityMin)}`);
  if (filters.integrationMax < 150) descriptions.push(`Integrace ≤ ${filters.integrationMax} min`);
  if (filters.angularSizeMin !== null || filters.angularSizeMax !== null) {
    descriptions.push(`Velikost ${filters.angularSizeMin ?? 0}–${filters.angularSizeMax ?? "∞"}′`);
  }
  if (filters.photoStatus === "photographed") descriptions.push("Vyfocené");
  if (filters.photoStatus === "unphotographed") descriptions.push("Dosud nevyfocené");
  const visibility = catalogVisibilityApi.normalizeSettings(filters.visibility);
  const visibilityLabels = {
    "above-now": "Nad limitem nyní",
    "below-now": "Pod horizontem nyní",
    "window-any": "Viditelný v okně",
    "window-duration": "Minimální doba viditelnosti",
  };
  if (visibility.mode !== "all") {
    descriptions.push(visibilityLabels[visibility.mode]);
    if (visibility.mode !== "below-now") descriptions.push(`Výška ≥ ${formatDecimal(visibility.minimumAltitudeDeg)}°`);
    if (["window-any", "window-duration"].includes(visibility.mode)) descriptions.push(`Okno ${formatDecimal(visibility.windowHours)} h`);
    if (visibility.mode === "window-duration") descriptions.push(`Doba ≥ ${formatDurationMinutes(visibility.minimumDurationMinutes)}`);
    if (visibility.directionMode !== "all" && visibility.mode !== "below-now") {
      const directionLabels = { north: "sever", east: "východ", south: "jih", west: "západ" };
      descriptions.push(visibility.directionMode === "custom"
        ? `Azimut ${formatDecimal(visibility.azimuthStartDeg)}–${formatDecimal(visibility.azimuthEndDeg)}°`
        : `Směr ${directionLabels[visibility.directionMode]}`);
    }
    if (visibility.horizonEnabled && visibility.mode !== "below-now") descriptions.push("Profil horizontu");
  }
  return descriptions;
}

function renderCatalogFilterStatus() {
  const activeCount = catalogMapApi.activeCatalogFilterCount(state.catalog.filters);
  const visibility = catalogVisibilityApi.normalizeSettings(state.catalog.filters.visibility);
  let recommendationActiveCount = activeCount;
  if (visibility.mode === "all") {
    if (visibility.minimumAltitudeDeg !== 20) recommendationActiveCount += 1;
    if (visibility.windowHours !== 10) recommendationActiveCount += 1;
    if (visibility.directionMode !== "all") recommendationActiveCount += 1;
    if (visibility.horizonEnabled) recommendationActiveCount += 1;
  }
  const descriptions = catalogFilterDescriptions();
  elements.catalogFiltersButton.textContent = activeCount ? `Filtry katalogu · ${activeCount}` : "Filtry katalogu";
  elements.catalogResultsFilterButton.textContent = activeCount ? `Filtry · ${activeCount}` : "Filtry";
  elements.recommendationFilterButton.textContent = recommendationActiveCount ? `Filtry · ${recommendationActiveCount}` : "Filtry";
  elements.catalogFilterSummary.textContent = activeCount
    ? `${activeCount} aktivní · ${state.catalog.filtered.length} shod`
    : "Bez dalších filtrů";
  elements.catalogQuickResetButton.hidden = activeCount === 0;
  elements.catalogResultsResetButton.hidden = activeCount === 0;
  elements.catalogResultsCount.textContent = String(state.catalog.filtered.length);
  elements.catalogActiveFilters.innerHTML = descriptions.length
    ? descriptions.map((description) => `<span>${escapeHtml(description)}</span>`).join("")
    : '<span class="is-empty">Bez omezení katalogu</span>';
}

function updateCatalogVisibility() {
  const context = getAtlasCalculationContext();
  const settings = catalogVisibilityApi.normalizeSettings(state.catalog.filters.visibility);
  state.catalog.filters.visibility = settings;
  if (!context || !state.catalog.targets.length) {
    const changed = state.catalog.visibility.byId.size > 0 || state.catalog.visibility.calculationKey !== "";
    state.catalog.visibility.byId = new Map();
    state.catalog.visibility.calculationKey = "";
    state.catalog.visibility.error = context ? null : "Neplatné datum nebo čas.";
    return changed;
  }

  const key = [
    context.date.getTime(),
    context.place.lat.toFixed(6),
    context.place.lon.toFixed(6),
    state.catalog.targets.length,
    JSON.stringify(settings),
  ].join(":");
  if (key === state.catalog.visibility.calculationKey) return false;

  try {
    const moon = state.solar.byId.get("Moon");
    const moonPosition = moon ? { raDeg: moon.raDeg, decDeg: moon.decDeg } : null;
    state.catalog.visibility.byId = catalogVisibilityApi.buildVisibilityIndex(
      state.catalog.targets,
      context.date,
      context.place,
      settings,
      moonPosition,
    );
    state.catalog.visibility.calculationKey = key;
    state.catalog.visibility.error = null;
  } catch (error) {
    state.catalog.visibility.byId = new Map();
    state.catalog.visibility.calculationKey = key;
    state.catalog.visibility.error = error instanceof Error ? error.message : "Výpočet viditelnosti se nepovedl.";
  }
  return true;
}

function buildRecommendationSkyTimeline(context, visibilitySettings) {
  const sampleMinutes = catalogVisibilityApi.SAMPLE_MINUTES;
  const durationMinutes = visibilitySettings.windowHours * 60;
  const sampleCount = Math.ceil(durationMinutes / sampleMinutes);
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const startMinute = index * sampleMinutes;
    const endMinute = Math.min(durationMinutes, (index + 1) * sampleMinutes);
    const sampleDate = new Date(context.date.getTime() + ((startMinute + endMinute) / 2) * 60000);
    samples.push(solarSystemApi.calculatePlanningSample(sampleDate, context.place));
  }
  return {
    start: context.date,
    end: new Date(context.date.getTime() + durationMinutes * 60000),
    durationMinutes,
    sampleMinutes,
    samples,
  };
}

function updateRecommendations() {
  const context = getAtlasCalculationContext();
  const visibilitySettings = catalogVisibilityApi.normalizeSettings(state.catalog.filters.visibility);
  if (!context || !state.catalog.targets.length || !state.catalog.visibility.byId.size) {
    state.recommendations.items = [];
    state.recommendations.byTargetId = new Map();
    state.recommendations.eligibleCount = 0;
    state.recommendations.consideredCount = 0;
    state.recommendations.calculationKey = "";
    state.recommendations.error = context ? state.catalog.visibility.error : "Neplatné datum nebo čas.";
    return;
  }

  const skyKey = [
    context.date.getTime(),
    context.place.lat.toFixed(6),
    context.place.lon.toFixed(6),
    visibilitySettings.windowHours,
  ].join(":");

  try {
    if (skyKey !== state.recommendations.skyKey) {
      state.recommendations.skyTimeline = buildRecommendationSkyTimeline(context, visibilitySettings);
      state.recommendations.skyKey = skyKey;
    }
    const filteredIds = state.catalog.filtered.map((target) => target.targetId).join("|");
    const linkedIds = [...state.catalog.photoLinks.byTargetId.entries()]
      .map(([targetId, photos]) => `${targetId}:${photos.length}`)
      .sort()
      .join("|");
    const calculationKey = [
      skyKey,
      state.catalog.visibility.calculationKey,
      state.recommendations.limit,
      state.catalog.filters.photoStatus,
      filteredIds,
      linkedIds,
    ].join(":");
    if (calculationKey === state.recommendations.calculationKey) return;

    const result = catalogRecommendationsApi.buildRecommendations(
      state.catalog.filtered,
      state.catalog.visibility.byId,
      state.recommendations.skyTimeline,
      state.catalog.photoLinks,
      {
        limit: state.recommendations.limit,
        minimumAltitudeDeg: visibilitySettings.minimumAltitudeDeg,
        photoStatus: state.catalog.filters.photoStatus,
      },
    );
    state.recommendations.items = result.items;
    state.recommendations.byTargetId = new Map(result.items.map((item) => [item.targetId, item]));
    state.recommendations.eligibleCount = result.eligibleCount;
    state.recommendations.consideredCount = result.consideredCount;
    state.recommendations.calculationKey = calculationKey;
    state.recommendations.error = null;
    if (state.sidebarMode === "recommendations" && !state.recommendations.byTargetId.has(state.selectedCatalogId)) {
      state.selectedCatalogId = state.recommendations.items[0]?.targetId || null;
    }
  } catch (error) {
    state.recommendations.items = [];
    state.recommendations.byTargetId = new Map();
    state.recommendations.eligibleCount = 0;
    state.recommendations.consideredCount = 0;
    state.recommendations.calculationKey = skyKey;
    state.recommendations.error = error instanceof Error ? error.message : "Výpočet doporučení se nepovedl.";
  }
}

function applyCatalogFilters(options = {}) {
  const preserveSelection = options.preserveSelection === true;
  const shouldRender = options.render !== false;
  state.catalog.filters = catalogMapApi.normalizeCatalogFilters(state.catalog.filters);
  updateCatalogVisibility();
  state.catalog.filtered = catalogMapApi.filterCatalogTargets(
    state.catalog.targets,
    state.catalog.filters,
    state.catalog.photoLinks,
    state.catalog.visibility.byId,
  );
  writeLocationStorage(CATALOG_FILTERS_STORAGE_KEY, JSON.stringify(state.catalog.filters));
  writeLocationStorage(CATALOG_PHOTO_STATUS_STORAGE_KEY, state.catalog.filters.photoStatus);

  const selectedStillVisible = state.catalog.filtered.some((target) => target.targetId === state.selectedCatalogId);
  if (!selectedStillVisible && (!preserveSelection || state.selectedCatalogId)) {
    state.selectedCatalogId = state.sidebarMode === "catalog" ? state.catalog.filtered[0]?.targetId || null : null;
  }
  syncCatalogFilterControls();
  renderCatalogFilterStatus();
  if (shouldRender) renderAll();
}

function resetCatalogFilters() {
  state.catalog.filters = catalogMapApi.defaultCatalogFilters();
  applyCatalogFilters();
}

function openCatalogFiltersDialog() {
  syncCatalogFilterControls();
  elements.catalogFiltersDialog.showModal();
}

function formatPhotoCount(count) {
  if (count === 1) return "1 snímek";
  if (count >= 2 && count <= 4) return `${count} snímky`;
  return `${count} snímků`;
}

function solarBodiesByAltitude() {
  return [...state.solar.bodies].sort((first, second) => second.altitudeDeg - first.altitudeDeg);
}

function updateSolarSystem() {
  const context = getAtlasCalculationContext();
  if (!context) {
    state.solar.bodies = [];
    state.solar.byId = new Map();
    state.solar.rendered = [];
    state.solar.calculationKey = "";
    state.solar.error = "Neplatné datum nebo čas.";
    return;
  }

  const key = `${context.date.getTime()}:${context.place.lat.toFixed(6)}:${context.place.lon.toFixed(6)}`;
  if (state.solar.calculationKey === key) return;

  try {
    const bodies = solarSystemApi.calculate(context.date, context.place);
    state.solar.bodies = bodies;
    state.solar.byId = new Map(bodies.map((body) => [body.id, body]));
    state.solar.calculationKey = key;
    state.solar.error = null;
    if (state.selectedSolarId && !state.solar.byId.has(state.selectedSolarId)) state.selectedSolarId = null;
  } catch (error) {
    state.solar.bodies = [];
    state.solar.byId = new Map();
    state.solar.rendered = [];
    state.solar.calculationKey = key;
    state.solar.error = error instanceof Error ? error.message : "Výpočet poloh se nepovedl.";
  }
}

function currentCatalogDensity() {
  const showAll = state.layers.catalogShowAll || state.catalog.filters.photoStatus === "photographed";
  return catalogMapApi.densityForScale(state.view.scale, state.view.fitScale, showAll);
}

function catalogTargetsForCurrentView(density = currentCatalogDensity()) {
  if (!state.layers.catalog) return [];
  const targets = catalogMapApi.targetsForDensity(state.catalog.filtered, density, state.selectedCatalogId);
  if (state.sidebarMode !== "recommendations") return targets;
  const byId = new Map(targets.map((target) => [target.targetId, target]));
  for (const recommendation of state.recommendations.items.slice(0, RECOMMENDATION_MAP_LIMIT)) {
    byId.set(recommendation.targetId, recommendation.target);
  }
  return [...byId.values()];
}

function updateLayerPanel(density = currentCatalogDensity(), renderedCount = null) {
  const total = state.catalog.metadata?.targetCount || state.catalog.targets.length || 650;
  const photographedCount = state.catalog.photoLinks.photographedTargetCount;
  const filteredTotal = state.catalog.filtered.length;
  const targetCount = renderedCount ?? catalogTargetsForCurrentView(density).length;
  elements.photoLayerToggle.checked = state.layers.photos;
  elements.catalogLayerToggle.checked = state.layers.catalog;
  elements.solarLayerToggle.checked = state.layers.solar;
  elements.catalogShowAllToggle.checked = state.layers.catalogShowAll;
  elements.catalogShowAllToggle.disabled = !state.layers.catalog;
  for (const input of elements.catalogPhotoStatusInputs) {
    input.checked = input.value === state.catalog.filters.photoStatus;
  }
  for (const input of elements.recommendationPhotoStatusInputs) {
    input.checked = input.value === state.catalog.filters.photoStatus;
  }
  elements.catalogAllCount.textContent = String(total);
  elements.catalogPhotographedCount.textContent = String(photographedCount);
  elements.catalogUnphotographedCount.textContent = String(Math.max(0, total - photographedCount));
  const unlinkedCount = state.catalog.photoLinks.unlinked.length + state.catalog.photoLinks.invalidLinks.length;
  elements.photoLayerCount.textContent = unlinkedCount
    ? `${formatPhotoCount(state.objects.length)} · ${unlinkedCount} bez vazby`
    : formatPhotoCount(state.objects.length);

  elements.catalogLayerStatus.textContent = state.layers.catalog ? `${targetCount} / ${filteredTotal}` : "Katalog vypnut";
  elements.catalogLayerStatus.dataset.renderedCount = String(targetCount);
  elements.catalogLayerStatus.dataset.totalCount = String(filteredTotal);
  elements.catalogLayerStatus.dataset.density = density.id;
  elements.catalogDensityStatus.textContent = state.catalog.filters.photoStatus === "photographed"
    ? `${formatPhotoCount(state.catalog.photoLinks.linkedPhotoCount)} u ${photographedCount} cílů`
    : state.layers.catalogShowAll
      ? `Všechny shody · ${filteredTotal}`
      : `Automaticky · ${density.shortLabel}`;
  elements.catalogMapCount.textContent = state.layers.catalog ? `${targetCount}/${filteredTotal} katalog` : "katalog vypnut";
  elements.recommendationMapCount.hidden = state.sidebarMode !== "recommendations";
  elements.recommendationMapCount.textContent = `${Math.min(RECOMMENDATION_MAP_LIMIT, state.recommendations.items.length)} doporučení`;
  const solarAboveCount = state.solar.bodies.filter((body) => body.aboveHorizon).length;
  elements.solarLayerCount.textContent = state.solar.error
    ? "Výpočet není dostupný"
    : `${solarAboveCount} z ${state.solar.bodies.length || 9} nad horizontem`;
  elements.solarMapCount.textContent = state.layers.solar
    ? `${solarAboveCount}/${state.solar.bodies.length || 9} soustava`
    : "soustava vypnuta";
  elements.catalogShowAllLabel.textContent = filteredTotal === total
    ? `Zobrazit všech ${total}`
    : `Zobrazit všechny shody (${filteredTotal})`;

  const selectedTarget = state.catalog.byId.get(state.selectedCatalogId);
  const selectedPhotos = selectedTarget
    ? state.catalog.photoLinks.byTargetId.get(selectedTarget.targetId) || []
    : [];
  elements.catalogSelectionPanel.hidden = !selectedTarget;
  if (selectedTarget) {
    elements.catalogSelectionName.textContent = selectedTarget.displayName;
    elements.catalogSelectionStatus.textContent = [
      selectedTarget.objectType.label,
      `priorita ${selectedTarget.dwarf3.priority.level}`,
      selectedPhotos.length ? formatPhotoCount(selectedPhotos.length) : "dosud bez snímku",
    ].join(" · ");
    elements.catalogOpenPhotosButton.hidden = selectedPhotos.length === 0;
    elements.catalogOpenPhotosButton.textContent = selectedPhotos.length === 1
      ? "Otevřít vlastní snímek"
      : `Otevřít vlastní snímky (${selectedPhotos.length})`;
  }
}

function updateLayerSettings() {
  state.layers.photos = elements.photoLayerToggle.checked;
  state.layers.catalog = elements.catalogLayerToggle.checked;
  state.layers.solar = elements.solarLayerToggle.checked;
  state.layers.catalogShowAll = elements.catalogShowAllToggle.checked;
  const nextPhotoStatus = catalogMapApi.normalizePhotoStatus(
    elements.catalogPhotoStatusInputs.find((input) => input.checked)?.value,
  );
  writeLocationStorage(PHOTO_LAYER_STORAGE_KEY, String(state.layers.photos));
  writeLocationStorage(CATALOG_LAYER_STORAGE_KEY, String(state.layers.catalog));
  writeLocationStorage(SOLAR_LAYER_STORAGE_KEY, String(state.layers.solar));
  writeLocationStorage(CATALOG_SHOW_ALL_STORAGE_KEY, String(state.layers.catalogShowAll));
  writeLocationStorage(CATALOG_PHOTO_STATUS_STORAGE_KEY, nextPhotoStatus);
  if (nextPhotoStatus !== state.catalog.filters.photoStatus) {
    state.catalog.filters = catalogMapApi.normalizeCatalogFilters({
      ...state.catalog.filters,
      photoStatus: nextPhotoStatus,
    });
    applyCatalogFilters();
    return;
  }
  state.hoveredId = null;
  state.hoveredCatalogId = null;
  state.hoveredSolarId = null;
  updateLayerPanel();
  drawSky();
}

function updateRecommendationPhotoStatus() {
  const nextPhotoStatus = catalogMapApi.normalizePhotoStatus(
    elements.recommendationPhotoStatusInputs.find((input) => input.checked)?.value,
  );
  if (nextPhotoStatus === state.catalog.filters.photoStatus) return;
  state.catalog.filters = catalogMapApi.normalizeCatalogFilters({
    ...state.catalog.filters,
    photoStatus: nextPhotoStatus,
  });
  applyCatalogFilters();
}

function rebuildFilters() {
  fillSelect(elements.constellationFilter, uniqueValues("constellation"), "Všechna");
  fillSelect(elements.typeFilter, uniqueValues("type"), "Všechny");
  fillSelect(elements.yearFilter, [...new Set(state.objects.map(getYear).filter(Boolean))].sort().reverse(), "Všechny");
  fillSelect(elements.equipmentFilter, uniqueValues("equipment"), "Všechno");
}

function uniqueValues(field) {
  return [...new Set(state.objects.map((item) => String(item[field] || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "cs"),
  );
}

function fillSelect(select, values, label) {
  const current = select.value;
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = label;
  select.append(allOption);
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  if (values.includes(current)) {
    select.value = current;
  }
}

function setupVisibilityControls() {
  populateAtlasPlaceSelect();
  syncAtlasLocationControls();
  elements.visibilityToggle.checked = state.visibility.enabled;
  setVisibilityToNow(false);
  updateVisibilityState();
}

function populateAtlasPlaceSelect() {
  elements.placeSelect.replaceChildren();
  for (const place of OBSERVING_PLACES) {
    const option = document.createElement("option");
    option.value = place.id;
    option.textContent = place.name;
    elements.placeSelect.append(option);
  }
  const customOption = document.createElement("option");
  customOption.value = CUSTOM_PLACE_ID;
  customOption.textContent = AstroLocation.customOptionLabel();
  elements.placeSelect.append(customOption);
}

function fillAtlasCoordinateInputs(place) {
  elements.atlasLatitudeInput.value = Number(place.lat).toFixed(4);
  elements.atlasLongitudeInput.value = Number(place.lon).toFixed(4);
}

function syncAtlasLocationControls() {
  const custom = AstroLocation.getCustomPlace();
  const option = elements.placeSelect.querySelector(`option[value="${CUSTOM_PLACE_ID}"]`);
  if (option) option.textContent = AstroLocation.customOptionLabel();
  elements.placeSelect.value = state.visibility.placeId;
  const customSelected = state.visibility.placeId === CUSTOM_PLACE_ID;
  elements.atlasCoordinateEditor.hidden = !customSelected;
  if (customSelected && custom) fillAtlasCoordinateInputs(custom);
}

function handleAtlasPlaceSelection() {
  elements.atlasCoordinateError.textContent = "";
  if (elements.placeSelect.value === CUSTOM_PLACE_ID) {
    elements.atlasCoordinateEditor.hidden = false;
    const custom = AstroLocation.getCustomPlace();
    fillAtlasCoordinateInputs(custom || getSelectedPlace());
    if (custom) AstroLocation.select(CUSTOM_PLACE_ID, "atlas");
    return;
  }
  elements.atlasCoordinateEditor.hidden = true;
  AstroLocation.select(elements.placeSelect.value, "atlas");
}

function applyAtlasCoordinates() {
  const result = AstroLocation.saveCustom(
    elements.atlasLatitudeInput.value,
    elements.atlasLongitudeInput.value,
    "atlas",
  );
  elements.atlasCoordinateError.textContent = result.error || "";
  if (result.place) fillAtlasCoordinateInputs(result.place);
}

function handleSharedAtlasLocation(event) {
  state.visibility.placeId = event.detail?.id || AstroLocation.getSelectedId();
  syncAtlasLocationControls();
  updateVisibilityState();
}

function formatTimelineMoment(date, includeDate = true) {
  return date.toLocaleString("cs-CZ", includeDate
    ? { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });
}

function syncTimeControls() {
  const date = getVisibilityDate();
  const playbackLabel = state.time.playing ? "Pozastavit pohyb oblohy" : "Spustit pohyb oblohy";
  elements.timePlaybackButton.setAttribute("aria-pressed", String(state.time.playing));
  elements.timePlaybackButton.setAttribute("aria-label", playbackLabel);
  elements.timePlaybackButton.title = playbackLabel;
  elements.timePlaybackButton.classList.toggle("is-playing", state.time.playing);
  elements.timePlaybackButton.querySelector("span").textContent = state.time.playing ? "Ⅱ" : "▶";
  elements.timePlaybackStep.value = String(state.time.playbackStepMinutes);
  elements.timeTimeline.disabled = !date;
  elements.timePlaybackButton.disabled = !date;

  if (!date) {
    elements.timeWindowPrimary.style.width = "0%";
    elements.timeWindowOverflow.style.width = "0%";
    elements.timeWindowOverflow.hidden = true;
    elements.timeWindowOutput.textContent = "Neplatný čas";
    return;
  }

  const startMinute = timeControlsApi.minuteOfDay(date);
  const visibilitySettings = catalogVisibilityApi.normalizeSettings(state.catalog.filters.visibility);
  const durationMinutes = visibilitySettings.windowHours * 60;
  const segments = timeControlsApi.windowSegments(startMinute, durationMinutes);
  const endDate = timeControlsApi.addElapsedMinutes(date, durationMinutes);
  const sameDay = endDate.getFullYear() === date.getFullYear()
    && endDate.getMonth() === date.getMonth()
    && endDate.getDate() === date.getDate();

  elements.timeTimeline.value = String(startMinute);
  elements.timeWindowPrimary.style.left = `${segments.primary.leftPercent}%`;
  elements.timeWindowPrimary.style.width = `${segments.primary.widthPercent}%`;
  elements.timeWindowOverflow.style.left = `${segments.overflow.leftPercent}%`;
  elements.timeWindowOverflow.style.width = `${segments.overflow.widthPercent}%`;
  elements.timeWindowOverflow.hidden = !segments.crossesMidnight;
  elements.timeWindowTrack.classList.toggle("crosses-midnight", segments.crossesMidnight);
  elements.timeWindowOutput.textContent = `Plán ${formatTimelineMoment(date)} → ${formatTimelineMoment(endDate, !sameDay)}`;
  elements.timeWindowTrack.title = `Okno doporučení: ${formatDecimal(visibilitySettings.windowHours)} h`;
}

function setAtlasDateTime(date, shouldDraw = true) {
  const values = timeControlsApi.toInputValues(date);
  if (!values) return false;
  elements.visibilityDate.value = values.date;
  elements.visibilityTime.value = values.time;
  syncTimeControls();
  if (shouldDraw) updateVisibilityState();
  return true;
}

function stopTimePlayback() {
  if (state.time.timerId !== null) {
    window.clearTimeout(state.time.timerId);
    state.time.timerId = null;
  }
  if (!state.time.playing) return;
  state.time.playing = false;
  syncTimeControls();
}

function scheduleTimePlaybackTick() {
  if (!state.time.playing) return;
  state.time.timerId = window.setTimeout(() => {
    state.time.timerId = null;
    if (!state.time.playing) return;
    const currentDate = getVisibilityDate();
    const nextDate = timeControlsApi.addElapsedMinutes(currentDate, state.time.playbackStepMinutes);
    if (!nextDate || !setAtlasDateTime(nextDate, true)) {
      stopTimePlayback();
      return;
    }
    scheduleTimePlaybackTick();
  }, TIME_PLAYBACK_INTERVAL_MS);
}

function toggleTimePlayback() {
  if (state.time.playing) {
    stopTimePlayback();
    return;
  }
  if (!getVisibilityDate()) return;
  state.time.playing = true;
  syncTimeControls();
  scheduleTimePlaybackTick();
}

function shiftAtlasTime({ minutes = 0, days = 0 }) {
  stopTimePlayback();
  let date = getVisibilityDate() || new Date();
  if (days) date = timeControlsApi.addCalendarDays(date, days);
  if (minutes) date = timeControlsApi.addElapsedMinutes(date, minutes);
  setAtlasDateTime(date, true);
}

function clearTimelineRender() {
  if (state.time.timelineRenderId === null) return;
  window.clearTimeout(state.time.timelineRenderId);
  state.time.timelineRenderId = null;
}

function applyTimelineValue(shouldDraw) {
  const currentDate = getVisibilityDate() || new Date();
  const nextDate = timeControlsApi.atMinuteOfDay(currentDate, elements.timeTimeline.value);
  setAtlasDateTime(nextDate, false);
  if (shouldDraw) updateVisibilityState();
}

function handleTimelineInput() {
  stopTimePlayback();
  applyTimelineValue(false);
  clearTimelineRender();
  state.time.timelineRenderId = window.setTimeout(() => {
    state.time.timelineRenderId = null;
    updateVisibilityState();
  }, TIMELINE_RENDER_DELAY_MS);
}

function handleTimelineChange() {
  clearTimelineRender();
  applyTimelineValue(true);
}

function setVisibilityToNow(shouldDraw = true) {
  stopTimePlayback();
  setAtlasDateTime(new Date(), shouldDraw);
}

function updateVisibilityState() {
  state.visibility.enabled = elements.visibilityToggle.checked;
  const context = getVisibilityContext();
  if (!state.visibility.enabled) {
    elements.visibilityStatus.textContent = "vrstva vypnuta";
  } else if (!context) {
    elements.visibilityStatus.textContent = "neplatný čas";
  } else {
    elements.visibilityStatus.textContent = `${AstroLocation.formatPlace(context.place, true)} · LST ${formatSiderealTime(context.lstDeg)}`;
  }
  syncTimeControls();
  updateMapPositionReadout();
  renderAll();
}

function renderConstellationOptions() {
  const values = new Set([
    ...uniqueValues("constellation"),
    ...CONSTELLATION_LABELS.map((item) => item.name),
    ...STAR_CATALOG.map((item) => item.con),
  ]);
  elements.constellationOptions.innerHTML = "";
  for (const value of [...values].filter(Boolean).sort((a, b) => a.localeCompare(b, "cs"))) {
    const option = document.createElement("option");
    option.value = value;
    elements.constellationOptions.append(option);
  }
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase("cs");
  const constellation = elements.constellationFilter.value;
  const type = elements.typeFilter.value;
  const year = elements.yearFilter.value;
  const equipment = elements.equipmentFilter.value;

  state.filtered = state.objects.filter((record) => {
    const text = [record.title, record.objectId, record.commonName, record.constellation, record.type, record.equipment, record.notes]
      .join(" ")
      .toLocaleLowerCase("cs");
    return (
      (!state.photoTargetFilterId || record.catalogTargetId === state.photoTargetFilterId) &&
      (!query || text.includes(query)) &&
      (!constellation || record.constellation === constellation) &&
      (!type || record.type === type) &&
      (!year || getYear(record) === year) &&
      (!equipment || record.equipment === equipment)
    );
  });

  if (!state.filtered.some((item) => item.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || null;
  }

  renderAll();
}

function renderAll() {
  syncTimeControls();
  updateSolarSystem();
  if (updateCatalogVisibility()) {
    applyCatalogFilters({ preserveSelection: true, render: false });
  }
  updateRecommendations();
  syncSidebarMode();
  renderCounts();
  renderDetail();
  renderObjectList();
  renderCatalogResults();
  renderRecommendationResults();
  renderSolarResults();
  drawSky();
}

function syncSidebarMode() {
  const catalogMode = state.sidebarMode === "catalog";
  const recommendationMode = state.sidebarMode === "recommendations";
  const solarMode = state.sidebarMode === "solar";
  document.body.classList.toggle("is-catalog-mode", catalogMode);
  document.body.classList.toggle("is-recommendation-mode", recommendationMode);
  document.body.classList.toggle("is-solar-mode", solarMode);
  elements.photoResultsWrap.hidden = catalogMode || recommendationMode || solarMode;
  elements.catalogResultsWrap.hidden = !catalogMode;
  elements.recommendationResultsWrap.hidden = !recommendationMode;
  elements.solarResultsWrap.hidden = !solarMode;
  for (const tab of elements.sidebarTabs) {
    const active = tab.dataset.sidebarMode === state.sidebarMode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

function setSidebarMode(mode) {
  state.sidebarMode = ["photos", "catalog", "recommendations", "solar"].includes(mode) ? mode : "photos";
  if (state.sidebarMode === "photos") {
    state.selectedCatalogId = null;
    state.selectedSolarId = null;
  }
  if (state.sidebarMode === "catalog" && !state.catalog.byId.has(state.selectedCatalogId)) {
    state.selectedSolarId = null;
    state.selectedCatalogId = state.catalog.filtered[0]?.targetId || null;
  }
  if (state.sidebarMode === "recommendations" && !state.recommendations.byTargetId.has(state.selectedCatalogId)) {
    state.selectedSolarId = null;
    state.selectedCatalogId = state.recommendations.items[0]?.targetId || null;
  }
  if (state.sidebarMode === "solar" && !state.solar.byId.has(state.selectedSolarId)) {
    state.selectedCatalogId = null;
    state.selectedSolarId = solarBodiesByAltitude()[0]?.id || null;
  }
  renderAll();
}

function renderCounts() {
  const positions = state.filtered.map((record) => getObjectPosition(record)).filter(Boolean);
  const visibilityContext = getVisibilityContext();
  const visiblePositions = visibilityContext
    ? positions.filter((position) => isSkyPositionVisible(position.raDeg, position.decDeg, visibilityContext)).length
    : null;
  elements.visibleCount.textContent = formatPhotoCount(state.filtered.length);
  elements.placedCount.textContent =
    visiblePositions === null ? `${positions.length} pozic` : `${visiblePositions}/${positions.length} nad horizontem`;
  elements.listCount.textContent = String(state.filtered.length);
  const target = state.catalog.byId.get(state.photoTargetFilterId);
  elements.photoListTitle.textContent = target ? `Snímky · ${target.displayName}` : "Snímky";
  elements.clearPhotoTargetFilterButton.hidden = !target;
}

function renderDetail() {
  if (state.sidebarMode === "recommendations") {
    renderRecommendationDetail();
    return;
  }
  if (state.sidebarMode === "catalog") {
    renderCatalogDetail();
    return;
  }
  if (state.sidebarMode === "solar") {
    renderSolarDetail();
    return;
  }
  const record = state.objects.find((item) => item.id === state.selectedId);
  if (!record) {
    elements.detailPanel.innerHTML = `
      <div class="empty-detail">
        <strong>Žádný snímek</strong>
        <span>0 položek</span>
      </div>
    `;
    return;
  }

  const position = getObjectPosition(record);
  const coords = position ? `${display(record.ra)} / ${display(record.dec)}` : "Bez pozice";
  const visibilityContext = getVisibilityContext();
  const positionStatus =
    position && visibilityContext
      ? isSkyPositionVisible(position.raDeg, position.decDeg, visibilityContext)
        ? "nad horizontem"
        : "pod horizontem"
      : position
        ? "připnuto"
        : "bez RA/Dec";
  elements.detailPanel.innerHTML = `
    <img class="selected-photo" src="${imageSrc(record.image)}" alt="${escapeHtml(record.title)}" loading="eager" />
    <div class="selected-meta">
      <div class="selected-title-row">
        <div>
          <h1>${escapeHtml(display(record.title, "Snímek"))}</h1>
          <p>${escapeHtml(display(record.commonName || record.objectId || record.constellation))}</p>
        </div>
        <span class="status-pill">${positionStatus}</span>
      </div>
      <div class="meta-grid">
        ${metaItem("Objekt", record.objectId)}
        ${metaItem("Typ", record.type)}
        ${metaItem("Souhvězdí", record.constellation)}
        ${metaItem("Souřadnice", coords)}
        ${metaItem("Datum", record.date)}
        ${metaItem("Vybavení", record.equipment)}
        ${metaItem("Expozice", record.exposure)}
        ${metaItem("Místo", record.location)}
      </div>
      ${record.notes ? `<div class="notes-box">${escapeHtml(record.notes)}</div>` : ""}
      ${record.catalogTargetId ? `<div class="catalog-link-note">Katalogový cíl · ${escapeHtml(state.catalog.byId.get(record.catalogTargetId)?.displayName || record.catalogTargetId)}</div>` : ""}
      <div class="detail-actions">
        ${position ? `<button class="ghost-button" type="button" data-action="center">Vycentrovat</button>` : ""}
      </div>
    </div>
  `;
}

function metaItem(label, value) {
  return `
    <div class="meta-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(display(value))}</strong>
    </div>
  `;
}

const SOLAR_GLYPHS = Object.freeze({
  Sun: "☉",
  Moon: "☾",
  Mercury: "☿",
  Venus: "♀",
  Mars: "♂",
  Jupiter: "♃",
  Saturn: "♄",
  Uranus: "⛢",
  Neptune: "♆",
});

function formatSolarRa(hoursValue) {
  let totalSeconds = Math.round(normalizeDegrees(Number(hoursValue) * 15) / 15 * 3600) % 86400;
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds -= hours * 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function formatSolarDec(degreesValue) {
  const degreesNumber = Number(degreesValue);
  if (!Number.isFinite(degreesNumber)) return "—";
  let totalSeconds = Math.round(Math.abs(degreesNumber) * 3600);
  const degrees = Math.floor(totalSeconds / 3600);
  totalSeconds -= degrees * 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${degreesNumber >= 0 ? "+" : "−"}${String(degrees).padStart(2, "0")}° ${String(minutes).padStart(2, "0")}′ ${String(seconds).padStart(2, "0")}″`;
}

function formatSignedDegrees(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}${Math.abs(number).toLocaleString("cs-CZ", { maximumFractionDigits: digits })}°`;
}

function formatSolarAngularDiameter(arcsecValue) {
  const arcsec = Number(arcsecValue);
  if (!Number.isFinite(arcsec)) return "—";
  if (arcsec >= 60) return `${formatDecimal(arcsec / 60, 2)}′`;
  return `${formatDecimal(arcsec, 2)}″`;
}

function formatSolarDistance(body) {
  if (!Number.isFinite(body.distanceAu)) return "—";
  if (body.id === "Moon") {
    const kilometers = Math.round(body.distanceAu * solarSystemApi.AU_KM);
    return `${kilometers.toLocaleString("cs-CZ")} km`;
  }
  return `${formatDecimal(body.distanceAu, body.distanceAu < 0.1 ? 5 : 3)} AU`;
}

function formatSolarEvent(dateValue) {
  if (!dateValue) return "není v následujících 48 h";
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSolarDateTime(date) {
  return date.toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function solarAzimuthText(body) {
  const basic = `${formatDecimal(body.azimuthDeg, 1)}°`;
  const context = getAtlasCalculationContext();
  return context && Math.abs(context.place.lat) < POLAR_DIRECTION_LIMIT
    ? `${basic} · ${compassDirectionName(body.azimuthDeg)}`
    : basic;
}

function solarStatusText(body) {
  return body.aboveHorizon ? "nad horizontem" : "pod horizontem";
}

function renderSolarResults() {
  const context = getAtlasCalculationContext();
  const bodies = solarBodiesByAltitude();
  const aboveCount = bodies.filter((body) => body.aboveHorizon).length;
  elements.solarResultsCount.textContent = state.solar.error ? "—" : `${aboveCount}/9 nad`;
  elements.solarPlaceLabel.textContent = context ? AstroLocation.formatPlace(context.place, true) : "Neplatné místo";
  elements.solarTimeLabel.textContent = context ? formatSolarDateTime(context.date) : "";
  elements.solarTimeLabel.dateTime = context?.date.toISOString() || "";

  if (state.solar.error) {
    elements.solarResultsList.innerHTML = `
      <div class="empty-detail"><strong>Výpočet není dostupný</strong><span>${escapeHtml(state.solar.error)}</span></div>
    `;
    return;
  }

  elements.solarResultsList.innerHTML = bodies.map((body) => {
    const active = body.id === state.selectedSolarId ? " is-active" : "";
    const below = body.aboveHorizon ? "" : " is-below";
    const direction = Math.abs(context.place.lat) < POLAR_DIRECTION_LIMIT
      ? compassDirectionName(body.azimuthDeg)
      : `${formatDecimal(body.azimuthDeg, 0)}° azimut`;
    return `
      <button class="solar-result${active}${below}" type="button" data-solar-id="${body.id}">
        <span class="solar-result-symbol" style="--solar-color: ${body.color}" title="${escapeHtml(body.name)}" aria-hidden="true">${SOLAR_GLYPHS[body.id]}</span>
        <span class="solar-result-copy">
          <strong>${escapeHtml(body.name)}</strong>
          <small>${escapeHtml(body.constellationName)} · mag ${escapeHtml(formatDecimal(body.magnitude, 1))}</small>
        </span>
        <span class="solar-result-position">
          <b>${escapeHtml(formatSignedDegrees(body.altitudeDeg, 1))}</b>
          <small>${escapeHtml(direction)}</small>
        </span>
      </button>
    `;
  }).join("");
}

function renderSolarDetail() {
  const body = state.solar.byId.get(state.selectedSolarId);
  const context = getAtlasCalculationContext();
  if (!body || !context) {
    elements.detailPanel.innerHTML = `
      <div class="empty-detail">
        <strong>${state.solar.error ? "Výpočet není dostupný" : "Vyber těleso"}</strong>
        <span>${escapeHtml(state.solar.error || "9 dynamických objektů")}</span>
      </div>
    `;
    return;
  }

  const constellation = [body.constellationName, body.constellation].filter(Boolean).join(" · ");
  const moonFacts = body.id === "Moon" ? `
    ${catalogFact("Fáze", body.moonPhaseName)}
    ${catalogFact("Fázový úhel", `${formatDecimal(body.moonPhaseDeg, 1)}°`)}
  ` : "";
  const saturnFacts = body.id === "Saturn" && Number.isFinite(body.ringTiltDeg)
    ? catalogFact("Náklon prstenců", formatSignedDegrees(body.ringTiltDeg, 1))
    : "";
  const safetyWarning = body.id === "Sun" ? `
    <aside class="solar-safety-warning">
      <strong>Bezpečné pozorování Slunce</strong>
      <span>Nikdy nemiř teleskopem na Slunce bez bezpečného solárního filtru určeného pro celý objektiv.</span>
    </aside>
  ` : "";

  elements.detailPanel.innerHTML = `
    <article class="solar-detail">
      <header class="solar-detail-head">
        <span class="solar-detail-symbol" style="--solar-color: ${body.color}" aria-hidden="true">${SOLAR_GLYPHS[body.id]}</span>
        <div>
          <span>Sluneční soustava · ${escapeHtml(constellation)}</span>
          <h1>${escapeHtml(body.name)}</h1>
          <p>${escapeHtml(AstroLocation.formatPlace(context.place, true))} · ${escapeHtml(formatSolarDateTime(context.date))}</p>
        </div>
        <span class="status-pill${body.aboveHorizon ? "" : " is-below"}">${solarStatusText(body)}</span>
      </header>

      ${safetyWarning}

      <section class="catalog-detail-section">
        <h2>Aktuální poloha</h2>
        <dl class="catalog-facts solar-facts">
          ${catalogFact("RA / Dec (datum)", `${formatSolarRa(body.raOfDateHours)} / ${formatSolarDec(body.decOfDateDeg)}`)}
          ${catalogFact("Výška", formatSignedDegrees(body.altitudeDeg, 2))}
          ${catalogFact("Azimut", solarAzimuthText(body))}
          ${catalogFact("Souhvězdí", constellation)}
          ${catalogFact("Vzdálenost od Země", formatSolarDistance(body))}
          ${catalogFact("Úhlový průměr", formatSolarAngularDiameter(body.angularDiameterArcsec))}
        </dl>
      </section>

      <section class="catalog-detail-section">
        <h2>Jas a fáze</h2>
        <dl class="catalog-facts solar-facts">
          ${catalogFact("Zdánlivá magnituda", `${formatDecimal(body.magnitude, 2)} mag`)}
          ${catalogFact("Osvětlená část", `${formatDecimal(body.illuminatedFraction * 100, 1)} %`)}
          ${body.id === "Sun" ? "" : catalogFact("Úhlová vzdálenost od Slunce", `${formatDecimal(body.elongationDeg, 1)}°`)}
          ${moonFacts}
          ${saturnFacts}
        </dl>
      </section>

      <section class="catalog-detail-section">
        <h2>Následující události</h2>
        <dl class="catalog-facts solar-facts">
          ${catalogFact("Východ", formatSolarEvent(body.events.rise))}
          ${catalogFact("Kulminace", `${formatSolarEvent(body.events.transit)}${Number.isFinite(body.events.transitAltitude) ? ` · ${formatSignedDegrees(body.events.transitAltitude, 1)}` : ""}`)}
          ${catalogFact("Západ", formatSolarEvent(body.events.set))}
        </dl>
      </section>

      <div class="solar-calculation-note">Topocentrický výpočet · refrakce u horizontu · Astronomy Engine 2.1.19</div>
      <div class="detail-actions catalog-detail-actions">
        <button class="ghost-button" type="button" data-solar-action="center">Vycentrovat</button>
      </div>
    </article>
  `;
}

function catalogFact(label, value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function catalogIdentifierRows(target) {
  const rows = [];
  const catalogs = target.catalogs || {};
  if (catalogs.messier) rows.push(["Messier", catalogs.messier]);
  if (catalogs.caldwell) rows.push(["Caldwell", catalogs.caldwell]);
  if (target.memberships?.includes("Herschel 400")) {
    rows.push(["Herschel 400", (catalogs.herschel400 || []).join(", ") || "ano"]);
  }
  if (catalogs.ngc?.length) rows.push(["NGC", catalogs.ngc.join(", ")]);
  if (catalogs.ic?.length) rows.push(["IC", catalogs.ic.join(", ")]);
  if (catalogs.other?.length) rows.push(["Další", catalogs.other.join(", ")]);
  return rows;
}

function formatAngularSize(target) {
  const rawMajor = target.angularSizeArcmin?.major;
  const rawMinor = target.angularSizeArcmin?.minor;
  const major = rawMajor === null || rawMajor === undefined ? Number.NaN : Number(rawMajor);
  const minor = rawMinor === null || rawMinor === undefined ? Number.NaN : Number(rawMinor);
  if (!Number.isFinite(major)) return "—";
  return Number.isFinite(minor)
    ? `${formatDecimal(major)}′ × ${formatDecimal(minor)}′`
    : `${formatDecimal(major)}′`;
}

function ratingMeter(value, label) {
  const rating = Math.max(0, Math.min(5, Number(value) || 0));
  const cells = Array.from({ length: 5 }, (_, index) => `<i class="${index < Math.round(rating) ? "is-filled" : ""}"></i>`).join("");
  return `<span class="catalog-rating" title="${escapeHtml(label)} ${formatDecimal(rating)} z 5"><span>${cells}</span><strong>${formatDecimal(rating)} / 5</strong></span>`;
}

function catalogVisibilityFor(target) {
  return state.catalog.visibility.byId.get(target?.targetId) || null;
}

function formatCatalogAzimuth(analysis, azimuthDegValue) {
  const basic = `${formatDecimal(azimuthDegValue, 1)}°`;
  return analysis?.stableDirections ? `${basic} · ${compassDirectionName(azimuthDegValue)}` : basic;
}

function formatCatalogEvent(dateValue, horizonState) {
  if (dateValue) return formatSolarEvent(dateValue);
  if (horizonState === "always-above") return "cirkumpolární";
  if (horizonState === "always-below") return "nevychází";
  return "—";
}

function formatVisibilityMoment(dateValue, referenceDate) {
  if (!dateValue) return "—";
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const sameDay = referenceDate &&
    date.getFullYear() === referenceDate.getFullYear() &&
    date.getMonth() === referenceDate.getMonth() &&
    date.getDate() === referenceDate.getDate();
  return date.toLocaleString("cs-CZ", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatBestVisibilityInterval(interval, referenceDate) {
  if (!interval) return "—";
  return `${formatVisibilityMoment(interval.start, referenceDate)}–${formatVisibilityMoment(interval.end, referenceDate)} · ${formatDurationMinutes(interval.durationMinutes)}`;
}

function renderCatalogVisibilityTimeline(analysis) {
  if (!analysis?.window?.timeline?.length) return "";
  const cells = analysis.window.timeline.map((usable, index) => {
    const time = new Date(analysis.window.start.getTime() + index * analysis.window.sampleMinutes * 60000);
    const label = `${formatVisibilityMoment(time, analysis.window.start)} · ${formatSignedDegrees(analysis.window.timelineAltitudes[index], 1)}`;
    return `<i class="${usable ? "is-usable" : ""}" title="${escapeHtml(label)}"></i>`;
  }).join("");
  const accessibleLabel = `Použitelné ${formatDurationMinutes(analysis.window.usableMinutes)} z ${formatDurationMinutes(analysis.window.durationMinutes)}`;
  return `
    <div class="catalog-visibility-chart" role="img" aria-label="${escapeHtml(accessibleLabel)}">
      <div class="catalog-visibility-strip" style="--visibility-samples: ${analysis.window.timeline.length}">${cells}</div>
      <div class="catalog-visibility-axis">
        <time>${escapeHtml(formatVisibilityMoment(analysis.window.start, analysis.window.start))}</time>
        <span>${escapeHtml(accessibleLabel)}</span>
        <time>${escapeHtml(formatVisibilityMoment(analysis.window.end, analysis.window.start))}</time>
      </div>
    </div>
  `;
}

function renderCatalogDetail() {
  const target = state.catalog.byId.get(state.selectedCatalogId);
  if (!target) {
    elements.detailPanel.innerHTML = `
      <div class="empty-detail">
        <strong>Žádný katalogový cíl</strong>
        <span>${state.catalog.filtered.length} výsledků</span>
      </div>
    `;
    return;
  }

  const commonNames = [...new Set([target.names?.curated, ...(target.names?.common || [])].filter(Boolean))];
  const identifiers = catalogIdentifierRows(target);
  const photos = state.catalog.photoLinks.byTargetId.get(target.targetId) || [];
  const visibility = catalogVisibilityFor(target);
  const visibilityDate = getVisibilityDate();
  const sameFrameTargets = target.sameFrameGroup
    ? state.catalog.targets.filter((candidate) => candidate.sameFrameGroup === target.sameFrameGroup && candidate.targetId !== target.targetId)
    : [];
  const photometry = [
    target.photometry?.vMag !== null ? catalogFact("V magnituda", formatDecimal(target.photometry.vMag, 2)) : "",
    target.photometry?.bMag !== null ? catalogFact("B magnituda", formatDecimal(target.photometry.bMag, 2)) : "",
    target.photometry?.surfaceBrightnessB !== null
      ? catalogFact("Plošný jas B", `${formatDecimal(target.photometry.surfaceBrightnessB, 2)} mag/arcmin²`)
      : "",
  ].join("");

  elements.detailPanel.innerHTML = `
    <article class="catalog-detail">
      <header class="catalog-detail-head">
        <span>${escapeHtml(target.mapGroup.label)} · ${escapeHtml(target.constellation)}</span>
        <h1>${escapeHtml(target.displayName)}</h1>
        <p>${escapeHtml(commonNames.join(" · ") || target.targetId)}</p>
        <div class="catalog-detail-badges">
          <span class="is-priority-${target.dwarf3.priority.level.toLowerCase()}">Priorita ${escapeHtml(target.dwarf3.priority.level)}</span>
          <span>Skóre ${escapeHtml(target.dwarf3.score)} / 100</span>
          ${photos.length ? `<span class="is-photographed">${escapeHtml(formatPhotoCount(photos.length))}</span>` : ""}
          ${visibility ? `<span class="${visibility.current.aboveHorizon ? "is-visible-now" : "is-below-now"}">${escapeHtml(formatSignedDegrees(visibility.current.altitudeDeg, 1))} nyní</span>` : ""}
        </div>
      </header>

      ${identifiers.length ? `
        <section class="catalog-detail-section">
          <h2>Identifikátory</h2>
          <dl class="catalog-facts">${identifiers.map(([label, value]) => catalogFact(label, value)).join("")}</dl>
        </section>
      ` : ""}

      <section class="catalog-detail-section">
        <h2>Objekt</h2>
        <dl class="catalog-facts">
          ${catalogFact("Přesný typ", target.objectType.label)}
          ${catalogFact("Mapová skupina", target.mapGroup.label)}
          ${catalogFact("Souhvězdí", target.constellation)}
          ${catalogFact("RA / Dec (J2000)", `${target.coordinates.raText} / ${target.coordinates.decText}`)}
          ${catalogFact("Úhlový rozměr", formatAngularSize(target))}
          ${photometry}
        </dl>
      </section>

      <section class="catalog-detail-section catalog-visibility-detail">
        <div class="catalog-section-heading">
          <h2>Dynamická viditelnost</h2>
          <span>${escapeHtml(AstroLocation.formatPlace(getSelectedPlace(), true))}${visibilityDate ? ` · ${escapeHtml(formatSolarDateTime(visibilityDate))}` : ""}</span>
        </div>
        ${visibility ? `
          ${renderCatalogVisibilityTimeline(visibility)}
          <dl class="catalog-facts catalog-dynamic-facts">
            ${catalogFact("Nyní", `${formatSignedDegrees(visibility.current.altitudeDeg, 2)} · az ${formatCatalogAzimuth(visibility, visibility.current.azimuthDeg)}`)}
            ${catalogFact("Aktuální limit", `${formatDecimal(visibility.current.thresholdDeg, 1)}°${visibility.current.directionMatch ? "" : " · mimo zvolený směr"}`)}
            ${catalogFact("Východ (0°)", formatCatalogEvent(visibility.events.rise, visibility.events.horizonState))}
            ${catalogFact("Kulminace", visibility.events.transit
              ? `${formatSolarEvent(visibility.events.transit)} · ${formatSignedDegrees(visibility.events.transitAltitudeDeg, 1)}`
              : formatCatalogEvent(null, visibility.events.horizonState))}
            ${catalogFact("Západ (0°)", formatCatalogEvent(visibility.events.set, visibility.events.horizonState))}
            ${catalogFact(`Maximum v okně ${formatDecimal(state.catalog.filters.visibility.windowHours)} h`, `${formatSignedDegrees(visibility.window.maximum.altitudeDeg, 1)} · ${formatVisibilityMoment(visibility.window.maximum.date, visibility.window.start)} · ${formatCatalogAzimuth(visibility, visibility.window.maximum.azimuthDeg)}`)}
            ${catalogFact("Doba nad limitem", `${formatDurationMinutes(visibility.window.usableMinutes)} / ${formatDurationMinutes(visibility.window.durationMinutes)}`)}
            ${catalogFact("Nejlepší souvislý interval", formatBestVisibilityInterval(visibility.window.bestInterval, visibility.window.start))}
            ${catalogFact("Vzdálenost od Měsíce", Number.isFinite(visibility.moonSeparationDeg) ? `${formatDecimal(visibility.moonSeparationDeg, 1)}°` : "—")}
            ${catalogFact("Vlastní fotografie", formatPhotoCount(photos.length))}
          </dl>
        ` : `<div class="catalog-visibility-error">${escapeHtml(state.catalog.visibility.error || "Výpočet není dostupný.")}</div>`}
      </section>

      <section class="catalog-detail-section catalog-dwarf-section">
        <div class="catalog-section-heading">
          <h2>DWARF 3</h2>
          <span>${escapeHtml(target.dwarf3.filter)}</span>
        </div>
        <div class="catalog-rating-grid">
          <div><span>Vhodnost</span>${ratingMeter(target.dwarf3.suitability, "Vhodnost")}</div>
          <div><span>Obtížnost</span>${ratingMeter(target.dwarf3.difficulty, "Obtížnost")}</div>
        </div>
        <dl class="catalog-facts">
          ${catalogFact("Rámování", target.dwarf3.framing)}
          ${catalogFact("Dual-band", target.dwarf3.dualBandUse)}
          ${catalogFact("Minimální integrace", `${target.dwarf3.minimumIntegrationMinutes} min`)}
          ${catalogFact("Priorita", target.dwarf3.priority.label)}
        </dl>
      </section>

      ${sameFrameTargets.length ? `
        <section class="catalog-detail-section">
          <h2>Stejný záběr · ${escapeHtml(target.sameFrameGroup)}</h2>
          <div class="same-frame-targets">
            ${sameFrameTargets.map((candidate) => `<button type="button" data-catalog-target-id="${escapeHtml(candidate.targetId)}">${escapeHtml(candidate.displayName)}</button>`).join("")}
          </div>
        </section>
      ` : ""}

      <div class="detail-actions catalog-detail-actions">
        <button class="ghost-button" type="button" data-catalog-action="center">Vycentrovat</button>
        ${photos.length ? `<button class="ghost-button" type="button" data-catalog-action="photos">${photos.length === 1 ? "Otevřít snímek" : `Otevřít snímky (${photos.length})`}</button>` : ""}
      </div>
    </article>
  `;
}

function catalogSymbolClass(target) {
  const symbol = catalogMapApi.GROUP_STYLES[target.mapGroup.id]?.symbol || "other";
  return `is-${symbol}`;
}

function renderCatalogResults() {
  const html = state.catalog.filtered.map((target) => {
    const active = target.targetId === state.selectedCatalogId ? " is-active" : "";
    const photographed = state.catalog.photoLinks.byTargetId.has(target.targetId);
    const visibility = catalogVisibilityFor(target);
    const below = visibility && !visibility.current.aboveHorizon ? " is-below-horizon" : "";
    return `
      <button class="catalog-result${active}${below}" type="button" data-target-id="${escapeHtml(target.targetId)}">
        <i class="catalog-symbol ${catalogSymbolClass(target)}" aria-hidden="true"></i>
        <span class="catalog-result-copy">
          <strong>${escapeHtml(target.displayName)}</strong>
          <small>${escapeHtml([target.targetId, target.constellation, target.objectType.label].filter((value, index, values) => value && values.indexOf(value) === index).join(" · "))}</small>
        </span>
        <span class="catalog-result-score">
          <b>${escapeHtml(target.dwarf3.priority.level)}</b>
          <small title="Skóre ${escapeHtml(target.dwarf3.score)} / 100">${visibility ? escapeHtml(formatSignedDegrees(visibility.current.altitudeDeg, 0)) : escapeHtml(target.dwarf3.score)}</small>
          ${photographed ? '<i title="Vyfotografováno" aria-label="Vyfotografováno"></i>' : ""}
        </span>
      </button>
    `;
  }).join("");
  elements.catalogResultsList.innerHTML = html || `
    <div class="empty-detail">
      <strong>Žádné katalogové cíle</strong>
      <span>Uprav filtry nebo hledání</span>
    </div>
  `;
}

function recommendationMoonLabel(recommendation) {
  if (!recommendation.moonAboveMinutes) return "Měsíc pod obzorem";
  if (Number.isFinite(recommendation.minimumMoonSeparationDeg)) {
    return `nejméně ${formatDecimal(recommendation.minimumMoonSeparationDeg, 1)}°`;
  }
  return "bez souřadnic Měsíce";
}

function recommendationScoreRows(recommendation) {
  return recommendation.components.map((component) => {
    const percentage = Math.max(0, Math.min(100, component.points / component.maximum * 100));
    return `
      <div class="recommendation-score-row">
        <div><span>${escapeHtml(component.label)}</span><small>${escapeHtml(component.detail)}</small></div>
        <div class="recommendation-score-track" aria-hidden="true"><i style="width:${percentage.toFixed(1)}%"></i></div>
        <strong>${escapeHtml(formatDecimal(component.points, 1))}<small>/${escapeHtml(component.maximum)}</small></strong>
      </div>
    `;
  }).join("");
}

function renderRecommendationDetail() {
  const recommendation = state.recommendations.byTargetId.get(state.selectedCatalogId);
  if (!recommendation) {
    const message = state.recommendations.error || (state.recommendations.consideredCount
      ? "V nastaveném okně není žádný cíl alespoň 20 minut za tmy."
      : "Aktuální filtry neobsahují žádné katalogové cíle.");
    elements.detailPanel.innerHTML = `
      <div class="empty-detail">
        <strong>Žádné doporučení</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
    return;
  }

  const target = recommendation.target;
  const photos = state.catalog.photoLinks.byTargetId.get(target.targetId) || [];
  const visibilitySettings = catalogVisibilityApi.normalizeSettings(state.catalog.filters.visibility);
  elements.detailPanel.innerHTML = `
    <article class="recommendation-detail">
      <header class="recommendation-detail-head">
        <span class="recommendation-rank">${escapeHtml(recommendation.rank)}</span>
        <div>
          <span>${escapeHtml(target.mapGroup.label)} · ${escapeHtml(target.constellation)}</span>
          <h1>${escapeHtml(target.displayName)}</h1>
          <p>${escapeHtml(target.targetId)} · ${escapeHtml(target.objectType.label)}</p>
        </div>
        <strong class="recommendation-total-score">${escapeHtml(recommendation.score)}<small>/100</small></strong>
      </header>

      <div class="recommendation-detail-badges">
        <span>Priorita ${escapeHtml(target.dwarf3.priority.level)}</span>
        <span>${escapeHtml(target.dwarf3.filter)}</span>
        <span>${escapeHtml(target.dwarf3.framing)}</span>
        ${photos.length ? `<span class="is-photographed">${escapeHtml(formatPhotoCount(photos.length))}</span>` : '<span>dosud bez snímku</span>'}
      </div>

      <section class="recommendation-primary-metrics">
        <div><span>Nejlepší interval</span><strong>${escapeHtml(formatBestVisibilityInterval(recommendation.bestInterval, state.recommendations.skyTimeline?.start))}</strong></div>
        <div><span>Maximum za tmy</span><strong>${escapeHtml(formatSignedDegrees(recommendation.maximumAltitudeDeg, 1))} · ${escapeHtml(formatVisibilityMoment(recommendation.maximumAltitudeDate, state.recommendations.skyTimeline?.start))}</strong></div>
        <div><span>Použitelná tma</span><strong>${escapeHtml(formatDurationMinutes(recommendation.darkUsableMinutes))}</strong><small>${escapeHtml(formatDurationMinutes(recommendation.astronomicalDarkMinutes))} astronomická</small></div>
        <div><span>Měsíc</span><strong>${escapeHtml(recommendationMoonLabel(recommendation))}</strong><small>${escapeHtml(formatDurationMinutes(recommendation.moonAboveMinutes))} nad obzorem</small></div>
      </section>

      <section class="recommendation-score-section">
        <div class="catalog-section-heading">
          <h2>Bodování</h2>
          <span>${escapeHtml(formatDecimal(visibilitySettings.windowHours))} h · ≥${escapeHtml(formatDecimal(visibilitySettings.minimumAltitudeDeg))}° · Slunce ≤−12°</span>
        </div>
        <div class="recommendation-score-table">${recommendationScoreRows(recommendation)}</div>
      </section>

      <section class="catalog-detail-section">
        <div class="catalog-section-heading">
          <h2>DWARF 3</h2>
          <span>${escapeHtml(target.dwarf3.priority.label)}</span>
        </div>
        <dl class="catalog-facts">
          ${catalogFact("Vhodnost", `${formatDecimal(target.dwarf3.suitability)} / 5`)}
          ${catalogFact("Obtížnost", `${formatDecimal(target.dwarf3.difficulty)} / 5`)}
          ${catalogFact("Minimální integrace", `${target.dwarf3.minimumIntegrationMinutes} min`)}
          ${catalogFact("Rámování", target.dwarf3.framing)}
          ${catalogFact("Filtr", target.dwarf3.filter)}
        </dl>
      </section>

      <div class="detail-actions catalog-detail-actions">
        <button class="ghost-button" type="button" data-recommendation-action="center">Vycentrovat</button>
        <button class="ghost-button" type="button" data-recommendation-action="catalog">Otevřít katalog</button>
        ${photos.length ? `<button class="ghost-button" type="button" data-recommendation-action="photos">${photos.length === 1 ? "Otevřít snímek" : `Otevřít snímky (${photos.length})`}</button>` : ""}
      </div>
    </article>
  `;
}

function renderRecommendationResults() {
  const context = getAtlasCalculationContext();
  const visibilitySettings = catalogVisibilityApi.normalizeSettings(state.catalog.filters.visibility);
  elements.recommendationLimit.value = String(state.recommendations.limit);
  elements.recommendationLimitOutput.textContent = String(state.recommendations.limit);
  for (const input of elements.recommendationPhotoStatusInputs) {
    input.checked = input.value === state.catalog.filters.photoStatus;
  }
  elements.recommendationResultsCount.textContent = state.recommendations.eligibleCount > state.recommendations.items.length
    ? `${state.recommendations.items.length}/${state.recommendations.eligibleCount}`
    : String(state.recommendations.items.length);
  elements.recommendationPlaceLabel.textContent = AstroLocation.formatPlace(getSelectedPlace(), true);
  elements.recommendationTimeLabel.textContent = context
    ? `${formatVisibilityMoment(context.date, context.date)}–${formatVisibilityMoment(state.recommendations.skyTimeline?.end, context.date)}`
    : "—";
  elements.recommendationWindowLabel.textContent = `${formatDecimal(visibilitySettings.windowHours)} h · ≥${formatDecimal(visibilitySettings.minimumAltitudeDeg)}° · Slunce ≤−12°`;
  const descriptions = catalogFilterDescriptions();
  if (visibilitySettings.mode === "all" && visibilitySettings.minimumAltitudeDeg !== 20) {
    descriptions.push(`Výška ≥ ${formatDecimal(visibilitySettings.minimumAltitudeDeg)}°`);
  }
  if (visibilitySettings.mode === "all" && visibilitySettings.windowHours !== 10) {
    descriptions.push(`Okno ${formatDecimal(visibilitySettings.windowHours)} h`);
  }
  if (visibilitySettings.mode === "all" && visibilitySettings.directionMode !== "all") {
    const directionLabels = { north: "sever", east: "východ", south: "jih", west: "západ" };
    descriptions.push(visibilitySettings.directionMode === "custom"
      ? `Azimut ${formatDecimal(visibilitySettings.azimuthStartDeg)}–${formatDecimal(visibilitySettings.azimuthEndDeg)}°`
      : `Směr ${directionLabels[visibilitySettings.directionMode]}`);
  }
  if (visibilitySettings.mode === "all" && visibilitySettings.horizonEnabled) descriptions.push("Profil horizontu");
  elements.recommendationActiveFilters.innerHTML = descriptions.length
    ? descriptions.map((description) => `<span>${escapeHtml(description)}</span>`).join("")
    : '<span class="is-empty">Katalog bez dalších omezení</span>';

  elements.recommendationResultsList.innerHTML = state.recommendations.items.map((recommendation) => {
    const target = recommendation.target;
    const active = recommendation.targetId === state.selectedCatalogId ? " is-active" : "";
    const photographed = recommendation.photoCount > 0;
    return `
      <button class="recommendation-result${active}" type="button" data-recommendation-target-id="${escapeHtml(recommendation.targetId)}">
        <span class="recommendation-result-rank">${escapeHtml(recommendation.rank)}</span>
        <span class="recommendation-result-copy">
          <strong>${escapeHtml(target.displayName)}</strong>
          <small>${escapeHtml([target.targetId, target.constellation, target.objectType.label].join(" · "))}</small>
          <span><b>${escapeHtml(formatVisibilityMoment(recommendation.bestInterval?.start, state.recommendations.skyTimeline?.start))}–${escapeHtml(formatVisibilityMoment(recommendation.bestInterval?.end, state.recommendations.skyTimeline?.start))}</b><small>${escapeHtml(formatSignedDegrees(recommendation.maximumAltitudeDeg, 0))} · ${escapeHtml(formatDurationMinutes(recommendation.darkUsableMinutes))}</small></span>
        </span>
        <span class="recommendation-result-score"><strong>${escapeHtml(recommendation.score)}</strong><small>/100</small>${photographed ? '<i title="Vyfotografováno" aria-label="Vyfotografováno"></i>' : ""}</span>
      </button>
    `;
  }).join("") || `
    <div class="empty-detail">
      <strong>Žádné cíle za tmy</strong>
      <span>${escapeHtml(state.recommendations.error || "Uprav časové okno, výšku nebo katalogové filtry.")}</span>
    </div>
  `;
}

function renderObjectList() {
  const html = state.filtered
    .map((record) => {
      const position = getObjectPosition(record);
      const active = record.id === state.selectedId ? " is-active" : "";
      const subtitle = [record.objectId, record.commonName].filter(Boolean).join(" · ");
      const facts = [record.constellation, record.type, getYear(record) || record.equipment, position ? "RA/Dec" : "bez pozice"]
        .filter(Boolean)
        .join(" · ");
      const catalogTarget = state.catalog.byId.get(record.catalogTargetId);
      return `
        <button class="object-card${active}" type="button" data-id="${escapeHtml(record.id)}">
          <img src="${imageSrc(record.thumbnail || record.image)}" alt="${escapeHtml(record.title)}" loading="lazy" />
          <span class="card-text">
            <span class="card-title">${escapeHtml(display(record.title, "Snímek"))}</span>
            <span class="card-subtitle">${escapeHtml(display(subtitle))}</span>
            <span class="card-facts">${escapeHtml(display(facts))}</span>
            ${catalogTarget ? `<span class="card-catalog-link">Katalog · ${escapeHtml(catalogTarget.displayName)}</span>` : ""}
          </span>
        </button>
      `;
    })
    .join("");
  elements.objectList.innerHTML = html || `<div class="empty-detail"><strong>Žádné výsledky</strong><span>0 položek</span></div>`;
}

function drawSky() {
  const { width, height } = state.size;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#050706";
  ctx.fillRect(0, 0, width, height);

  drawBackgroundStars();
  drawVisibilityLayer();
  drawGrid();
  drawConstellations();
  drawVisibilityGuides();
  drawCatalogTargets();
  drawRecommendationOverlay();
  drawSolarSystem();
  drawObjects();
  drawFrame();
  drawCatalogInteractionOverlay();
  drawSolarInteractionOverlay();
}

function drawBackgroundStars() {
  ctx.save();
  for (const star of backgroundStars) {
    const p = toScreen(project(star.raDeg, star.decDeg));
    if (p.x < -4 || p.y < -4 || p.x > state.size.width + 4 || p.y > state.size.height + 4) continue;
    ctx.globalAlpha = star.alpha;
    ctx.fillStyle = "#dfe8df";
    ctx.beginPath();
    ctx.arc(p.x, p.y, star.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawVisibilityLayer() {
  const visibilityContext = getVisibilityContext();
  if (!visibilityContext) return;
  updateVisibilityMask(visibilityContext);
  const origin = toScreen({ x: 0, y: 0 });
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    visibilityMaskCanvas,
    origin.x,
    origin.y,
    BASE_WIDTH * state.view.scale,
    BASE_HEIGHT * state.view.scale,
  );
  ctx.restore();
}

function updateVisibilityMask(visibilityContext) {
  const key = `${visibilityContext.place.lat.toFixed(6)}:${visibilityContext.lstDeg.toFixed(6)}`;
  if (visibilityMaskKey === key) return;

  const image = visibilityMaskContext.createImageData(VISIBILITY_MASK_WIDTH, VISIBILITY_MASK_HEIGHT);
  const data = image.data;
  const sinLatitude = Math.sin(visibilityContext.latRad);
  const rawCosLatitude = Math.cos(visibilityContext.latRad);
  const cosLatitude = Math.abs(rawCosLatitude) < 1e-12 ? 0 : rawCosLatitude;
  const cosHourAngles = new Float64Array(VISIBILITY_MASK_WIDTH);
  const edgeSine = Math.sin(0.45 * DEG_TO_RAD);

  for (let x = 0; x < VISIBILITY_MASK_WIDTH; x += 1) {
    const raDeg = 360 - ((x + 0.5) / VISIBILITY_MASK_WIDTH) * 360;
    const hourAngle = normalizeSignedDegrees(visibilityContext.lstDeg - raDeg) * DEG_TO_RAD;
    cosHourAngles[x] = Math.cos(hourAngle);
  }

  for (let y = 0; y < VISIBILITY_MASK_HEIGHT; y += 1) {
    const decRad = (90 - ((y + 0.5) / VISIBILITY_MASK_HEIGHT) * 180) * DEG_TO_RAD;
    const latitudeTerm = sinLatitude * Math.sin(decRad);
    const hourAngleTerm = cosLatitude * Math.cos(decRad);
    for (let x = 0; x < VISIBILITY_MASK_WIDTH; x += 1) {
      const sinAltitude = latitudeTerm + hourAngleTerm * cosHourAngles[x];
      const visibleBlend = Math.max(0, Math.min(1, 0.5 + sinAltitude / (2 * edgeSine)));
      const offset = (y * VISIBILITY_MASK_WIDTH + x) * 4;
      data[offset] = Math.round(92 * visibleBlend);
      data[offset + 1] = Math.round(169 * visibleBlend);
      data[offset + 2] = Math.round(113 * visibleBlend);
      data[offset + 3] = Math.round(92 + (34 - 92) * visibleBlend);
    }
  }

  visibilityMaskContext.putImageData(image, 0, 0);
  visibilityMaskKey = key;
}

function drawProjectedGuide(points, strokeStyle, lineWidth, dash = []) {
  const wrapDistance = (BASE_WIDTH * state.view.scale) / 2;
  let previous = null;
  ctx.beginPath();
  for (const coordinates of points) {
    const point = toScreen(project(coordinates.raDeg, coordinates.decDeg));
    if (!previous || Math.abs(point.x - previous.x) > wrapDistance) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
    previous = point;
  }
  ctx.setLineDash(dash);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.setLineDash([]);
}

function altitudeContourSegments(visibilityContext, altitudeDegValue) {
  const cacheKey = `${visibilityContext.place.lat.toFixed(6)}:${visibilityContext.lstDeg.toFixed(6)}:${altitudeDegValue}`;
  if (altitudeContourCache.key === cacheKey) return altitudeContourCache.segments;
  const columns = ALTITUDE_CONTOUR_COLUMNS;
  const rows = ALTITUDE_CONTOUR_ROWS;
  const values = new Float32Array((columns + 1) * (rows + 1));
  const sinLatitude = Math.sin(visibilityContext.latRad);
  const rawCosLatitude = Math.cos(visibilityContext.latRad);
  const cosLatitude = Math.abs(rawCosLatitude) < 1e-12 ? 0 : rawCosLatitude;
  const target = Math.sin(altitudeDegValue * DEG_TO_RAD);
  const cosHourAngles = new Float64Array(columns + 1);

  for (let x = 0; x <= columns; x += 1) {
    const raDeg = 360 - (x / columns) * 360;
    cosHourAngles[x] = Math.cos(normalizeSignedDegrees(visibilityContext.lstDeg - raDeg) * DEG_TO_RAD);
  }
  for (let y = 0; y <= rows; y += 1) {
    const decRad = (90 - (y / rows) * 180) * DEG_TO_RAD;
    const latitudeTerm = sinLatitude * Math.sin(decRad);
    const hourAngleTerm = cosLatitude * Math.cos(decRad);
    for (let x = 0; x <= columns; x += 1) {
      values[y * (columns + 1) + x] = latitudeTerm + hourAngleTerm * cosHourAngles[x] - target;
    }
  }

  function edgePoint(edge, x, y, topLeft, topRight, bottomRight, bottomLeft) {
    let gridX = x;
    let gridY = y;
    if (edge === 0) {
      gridX += crossingFraction(topLeft, topRight);
    } else if (edge === 1) {
      gridX += 1;
      gridY += crossingFraction(topRight, bottomRight);
    } else if (edge === 2) {
      gridX += crossingFraction(bottomLeft, bottomRight);
      gridY += 1;
    } else {
      gridY += crossingFraction(topLeft, bottomLeft);
    }
    return {
      x: (gridX / columns) * BASE_WIDTH,
      y: (gridY / rows) * BASE_HEIGHT,
    };
  }

  const segments = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const topLeft = values[y * (columns + 1) + x];
      const topRight = values[y * (columns + 1) + x + 1];
      const bottomLeft = values[(y + 1) * (columns + 1) + x];
      const bottomRight = values[(y + 1) * (columns + 1) + x + 1];
      const edges = [];
      if ((topLeft >= 0) !== (topRight >= 0)) edges.push(0);
      if ((topRight >= 0) !== (bottomRight >= 0)) edges.push(1);
      if ((bottomLeft >= 0) !== (bottomRight >= 0)) edges.push(2);
      if ((topLeft >= 0) !== (bottomLeft >= 0)) edges.push(3);
      if (edges.length === 2) {
        segments.push([
          edgePoint(edges[0], x, y, topLeft, topRight, bottomRight, bottomLeft),
          edgePoint(edges[1], x, y, topLeft, topRight, bottomRight, bottomLeft),
        ]);
      } else if (edges.length === 4) {
        const centerPositive = (topLeft + topRight + bottomRight + bottomLeft) / 4 >= 0;
        const pairs = centerPositive === (topLeft >= 0)
          ? [[0, 1], [2, 3]]
          : [[0, 3], [1, 2]];
        for (const [first, second] of pairs) {
          segments.push([
            edgePoint(first, x, y, topLeft, topRight, bottomRight, bottomLeft),
            edgePoint(second, x, y, topLeft, topRight, bottomRight, bottomLeft),
          ]);
        }
      }
    }
  }
  altitudeContourCache = { key: cacheKey, segments };
  return segments;
}

function crossingFraction(first, second) {
  const distance = first - second;
  return Math.abs(distance) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, first / distance));
}

function drawAltitudeContour(visibilityContext, altitude, strokeStyle, lineWidth, dash = []) {
  const segments = altitudeContourSegments(visibilityContext, altitude);
  ctx.beginPath();
  for (const [fromWorld, toWorld] of segments) {
    const from = toScreen(fromWorld);
    const to = toScreen(toWorld);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.setLineDash(dash);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGuideLabel(coordinates, text, color = "#dce8dc", offsetX = 0, offsetY = 0) {
  const projected = toScreen(project(coordinates.raDeg, coordinates.decDeg));
  const point = { x: projected.x + offsetX, y: projected.y + offsetY };
  if (point.x < -80 || point.y < -30 || point.x > state.size.width + 80 || point.y > state.size.height + 30) return;
  ctx.font = "700 10px Inter, system-ui, sans-serif";
  const width = Math.ceil(ctx.measureText(text).width) + 10;
  const x = point.x - width / 2;
  const y = point.y - 9;
  ctx.fillStyle = "rgba(7, 11, 8, 0.88)";
  ctx.fillRect(x, y, width, 18);
  ctx.strokeStyle = "rgba(67, 86, 72, 0.92)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 17);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, point.x, point.y + 0.5);
}

function drawCardinalMarker(visibilityContext, code, azimuthDeg) {
  const coordinates = equatorialFromHorizontal(0, azimuthDeg, visibilityContext);
  const point = toScreen(project(coordinates.raDeg, coordinates.decDeg));
  if (point.x < -20 || point.y < -20 || point.x > state.size.width + 20 || point.y > state.size.height + 20) return;
  ctx.shadowColor = "rgba(226, 189, 104, 0.48)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 12, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(9, 13, 10, 0.96)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(226, 189, 104, 0.94)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#f3d991";
  ctx.font = "700 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(code, point.x, point.y + 0.5);
}

function drawVisibilityGuides() {
  const visibilityContext = getVisibilityContext();
  if (!visibilityContext) return;
  const stableDirections = hasStableCardinalDirections(visibilityContext);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const altitude of [30, 60]) {
    const contour = [];
    for (let azimuth = 0; azimuth <= 360; azimuth += 2) {
      contour.push(equatorialFromHorizontal(altitude, azimuth, visibilityContext));
    }
    drawProjectedGuide(contour, "rgba(143, 227, 170, 0.38)", 1, [5, 7]);
    drawGuideLabel(equatorialFromHorizontal(altitude, 135, visibilityContext), `${altitude}°`, "#a9ddb7");
  }

  if (stableDirections) {
    const meridian = [];
    for (let altitude = 0; altitude <= 90; altitude += 2) {
      meridian.push(equatorialFromHorizontal(altitude, 180, visibilityContext));
    }
    for (let altitude = 88; altitude >= 0; altitude -= 2) {
      meridian.push(equatorialFromHorizontal(altitude, 0, visibilityContext));
    }
    drawProjectedGuide(meridian, "rgba(226, 189, 104, 0.48)", 1.2, [2, 5]);
  }

  ctx.shadowColor = "rgba(226, 189, 104, 0.46)";
  ctx.shadowBlur = 8;
  drawAltitudeContour(visibilityContext, 0, "rgba(226, 189, 104, 0.96)", 2);
  ctx.shadowBlur = 0;

  if (stableDirections) {
    drawCardinalMarker(visibilityContext, "S", 0);
    drawCardinalMarker(visibilityContext, "V", 90);
    drawCardinalMarker(visibilityContext, "J", 180);
    drawCardinalMarker(visibilityContext, "Z", 270);
  }

  if (stableDirections) {
    const zenith = equatorialFromHorizontal(90, 0, visibilityContext);
    const zenithPoint = toScreen(project(zenith.raDeg, zenith.decDeg));
    if (zenithPoint.x >= -80 && zenithPoint.y >= -30 && zenithPoint.x <= state.size.width + 80 && zenithPoint.y <= state.size.height + 30) {
      ctx.strokeStyle = "#8fe3aa";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(zenithPoint.x, zenithPoint.y, 8, 0, Math.PI * 2);
      ctx.moveTo(zenithPoint.x - 13, zenithPoint.y);
      ctx.lineTo(zenithPoint.x + 13, zenithPoint.y);
      ctx.moveTo(zenithPoint.x, zenithPoint.y - 13);
      ctx.lineTo(zenithPoint.x, zenithPoint.y + 13);
      ctx.stroke();
      drawGuideLabel(zenith, "ZENIT · NAD HLAVOU", "#b9edc6", 78, -18);
    }
  }

  if (stableDirections) {
    const meridianCoordinates = equatorialFromHorizontal(44, 180, visibilityContext);
    const meridianLabel = toScreen(project(meridianCoordinates.raDeg, meridianCoordinates.decDeg));
    if (meridianLabel.x >= 0 && meridianLabel.y >= 50 && meridianLabel.x <= state.size.width && meridianLabel.y <= state.size.height) {
      ctx.save();
      ctx.translate(meridianLabel.x + 10, meridianLabel.y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "rgba(231, 210, 160, 0.68)";
      ctx.font = "700 9px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("MÍSTNÍ POLEDNÍK", 0, 0);
      ctx.restore();
    }
  }

  drawGuideLabel(equatorialFromHorizontal(-52, 270, visibilityContext), "POD HORIZONTEM", "rgba(170, 181, 172, 0.72)");
  ctx.restore();
}

function drawGrid() {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(143, 227, 170, 0.14)";
  ctx.fillStyle = "rgba(154, 168, 158, 0.72)";
  ctx.font = "12px Inter, system-ui, sans-serif";

  for (let dec = -60; dec <= 60; dec += 30) {
    const start = toScreen(project(0, dec));
    const y = start.y;
    ctx.beginPath();
    ctx.moveTo(state.view.x, y);
    ctx.lineTo(state.view.x + BASE_WIDTH * state.view.scale, y);
    ctx.stroke();
    ctx.fillText(`${dec > 0 ? "+" : ""}${dec}°`, state.view.x + 10, y - 7);
  }

  for (let hour = 0; hour < 24; hour += 2) {
    const x = toScreen(project(hour * 15, 0)).x;
    ctx.beginPath();
    ctx.moveTo(x, state.view.y);
    ctx.lineTo(x, state.view.y + BASE_HEIGHT * state.view.scale);
    ctx.stroke();
    ctx.fillText(`${hour}h`, x + 6, state.view.y + 18);
  }
  ctx.restore();
}

function drawConstellations() {
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(143, 227, 170, 0.32)";
  ctx.fillStyle = "rgba(238, 245, 236, 0.82)";

  for (const line of CONSTELLATION_LINES) {
    const points = line.stars
      .map((name) => starByName.get(name))
      .filter(Boolean)
      .map((star) => toScreen(project(star.raDeg, star.decDeg)));
    if (points.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      const previous = points[index - 1];
      if (previous && Math.abs(point.x - previous.x) > (BASE_WIDTH * state.view.scale) / 2) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
  }

  for (const star of STAR_CATALOG) {
    const p = toScreen(project(star.raDeg, star.decDeg));
    if (p.x < -20 || p.y < -20 || p.x > state.size.width + 20 || p.y > state.size.height + 20) continue;
    const radius = Math.max(1.3, 4.2 - star.mag * 0.6);
    ctx.fillStyle = star.mag < 1 ? "#f0d58c" : "#e6efe5";
    ctx.globalAlpha = star.mag < 2 ? 0.95 : 0.74;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (star.mag <= 1.2 || ["Arcturus", "Vega", "Spica", "Deneb", "Altair"].includes(star.name)) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#cdd9cf";
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.fillText(star.name, p.x + 8, p.y - 7);
    }
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(226, 189, 104, 0.5)";
  ctx.font = "12px Inter, system-ui, sans-serif";
  for (const label of CONSTELLATION_LABELS) {
    const ra = parseRA(label.ra);
    const dec = parseDec(label.dec);
    if (ra === null || dec === null) continue;
    const p = toScreen(project(ra, dec));
    if (p.x < -40 || p.y < -20 || p.x > state.size.width + 40 || p.y > state.size.height + 20) continue;
    ctx.fillText(label.name, p.x, p.y);
  }

  ctx.restore();
}

function catalogTargetPosition(target) {
  const raDeg = target?.coordinates?.raDeg;
  const decDeg = target?.coordinates?.decDeg;
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null;
  return { raDeg, decDeg, ...project(raDeg, decDeg) };
}

function isPointOnMap(point, margin = 28) {
  return (
    point.x >= -margin &&
    point.y >= -margin &&
    point.x <= state.size.width + margin &&
    point.y <= state.size.height + margin
  );
}

function catalogSymbolSize(target, emphasized = false) {
  if (emphasized) return 7;
  const priority = catalogMapApi.priorityOf(target);
  if (priority === "A") return 4.5;
  if (priority === "B") return 4;
  return 3.5;
}

function drawCatalogSymbol(item, options = {}) {
  const { target, point } = item;
  const style = catalogMapApi.GROUP_STYLES[target.mapGroup.id] || catalogMapApi.GROUP_STYLES.other;
  const selected = options.selected === true;
  const hovered = options.hovered === true;
  const emphasized = selected || hovered;
  const size = catalogSymbolSize(target, emphasized);
  const alpha = options.alpha ?? item.alpha ?? 1;

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (emphasized) {
    ctx.strokeStyle = selected ? "rgba(245, 217, 138, 0.42)" : "rgba(238, 245, 236, 0.32)";
    ctx.lineWidth = selected ? 7 : 5;
    ctx.beginPath();
    ctx.arc(0, 0, size + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = selected ? "#f5d98a" : style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = selected ? 1.8 : 1.25;
  ctx.setLineDash([]);

  ctx.save();
  if (style.symbol === "galaxy") {
    ctx.rotate(-0.38);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.45, size * 0.65, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 1.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (style.symbol === "open-cluster") {
    ctx.setLineDash([1.4, 2.2]);
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [[-1.8, -1.2], [1.8, -0.4], [0.2, 2]]) {
      ctx.beginPath();
      ctx.arc(x, y, 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style.symbol === "globular-cluster") {
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(size, 0);
    ctx.moveTo(0, -size);
    ctx.lineTo(0, size);
    ctx.stroke();
  } else if (style.symbol === "planetary-nebula") {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 1.35, 0);
    ctx.lineTo(-size * 0.72, 0);
    ctx.moveTo(size * 0.72, 0);
    ctx.lineTo(size * 1.35, 0);
    ctx.moveTo(0, -size * 1.35);
    ctx.lineTo(0, -size * 0.72);
    ctx.moveTo(0, size * 0.72);
    ctx.lineTo(0, size * 1.35);
    ctx.stroke();
  } else if (style.symbol === "nebula") {
    ctx.strokeRect(-size, -size, size * 2, size * 2);
  } else if (style.symbol === "cluster-nebula") {
    ctx.strokeRect(-size, -size, size * 2, size * 2);
    ctx.beginPath();
    ctx.arc(0, 0, 1.35, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.15);
    ctx.lineTo(size, size * 0.85);
    ctx.lineTo(-size, size * 0.85);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();

  if (item.photoCount > 0) {
    ctx.fillStyle = "#e2bd68";
    ctx.strokeStyle = "#071008";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(size + 2.8, size + 2.8, emphasized ? 3.4 : 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function catalogLabelCandidate(target, density) {
  const priority = catalogMapApi.priorityOf(target);
  const score = Number(target?.dwarf3?.score || 0);
  const isMessier = Boolean(target?.catalogs?.messier);
  if (density.id === "priority-a") return priority === "A" && score >= 97;
  if (density.id === "priority-ab") return priority === "A";
  return priority === "A" || (priority === "B" && isMessier);
}

function labelRectangle(item, fontSize = 11) {
  const text = item.target.displayName || item.target.targetId;
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const width = ctx.measureText(text).width;
  return {
    x: item.point.x + 9 - CATALOG_LABEL_PADDING,
    y: item.point.y - fontSize - 8 - CATALOG_LABEL_PADDING,
    width: width + CATALOG_LABEL_PADDING * 2,
    height: fontSize + CATALOG_LABEL_PADDING * 2,
    text,
  };
}

function rectanglesOverlap(left, right) {
  return !(
    left.x + left.width < right.x ||
    right.x + right.width < left.x ||
    left.y + left.height < right.y ||
    right.y + right.height < left.y
  );
}

function drawCatalogLabel(item, options = {}) {
  const selected = options.selected === true;
  const hovered = options.hovered === true;
  const fontSize = selected ? 13 : hovered ? 12 : 10;
  const rectangle = options.rectangle || labelRectangle(item, fontSize);
  const style = catalogMapApi.GROUP_STYLES[item.target.mapGroup.id] || catalogMapApi.GROUP_STYLES.other;

  ctx.save();
  ctx.globalAlpha = options.alpha ?? item.alpha ?? 1;
  ctx.fillStyle = selected ? "rgba(18, 17, 11, 0.94)" : "rgba(5, 7, 6, 0.82)";
  ctx.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  ctx.font = `${selected || hovered ? 700 : 600} ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = selected ? "#f5d98a" : hovered ? "#edf5eb" : style.color;
  ctx.textBaseline = "top";
  ctx.fillText(rectangle.text, rectangle.x + CATALOG_LABEL_PADDING, rectangle.y + CATALOG_LABEL_PADDING);
  ctx.restore();
}

function drawCatalogLabels(rendered, density) {
  const occupied = [];
  const area = state.size.width * state.size.height;
  const labelLimit = Math.max(8, Math.min(32, Math.floor(area / 36000)));
  const candidates = [...rendered]
    .reverse()
    .filter((item) =>
      item.target.targetId !== state.selectedCatalogId &&
      item.target.targetId !== state.hoveredCatalogId &&
      catalogLabelCandidate(item.target, density),
    );

  let drawn = 0;
  for (const item of candidates) {
    if (drawn >= labelLimit) break;
    const rectangle = labelRectangle(item, 10);
    if (
      rectangle.x < 2 ||
      rectangle.y < 2 ||
      rectangle.x + rectangle.width > state.size.width - 2 ||
      rectangle.y + rectangle.height > state.size.height - 2 ||
      occupied.some((other) => rectanglesOverlap(rectangle, other))
    ) {
      continue;
    }
    occupied.push(rectangle);
    drawCatalogLabel(item, { rectangle, alpha: Math.min(0.88, item.alpha + 0.12) });
    drawn += 1;
  }
}

function drawCatalogTargets() {
  const density = currentCatalogDensity();
  const targets = catalogTargetsForCurrentView(density);
  if (!state.layers.catalog || !targets.length) {
    state.catalog.rendered = [];
    updateLayerPanel(density, 0);
    return;
  }

  const rendered = [];
  ctx.save();
  for (const target of targets) {
    const position = catalogTargetPosition(target);
    if (!position) continue;
    const point = toScreen(position);
    if (!isPointOnMap(point)) continue;
    const visibility = catalogVisibilityFor(target);
    const aboveHorizon = visibility ? visibility.current.aboveHorizon : true;
    const usable = visibility ? visibility.current.usable : aboveHorizon;
    const priority = catalogMapApi.priorityOf(target);
    const baseAlpha = priority === "A" ? 0.9 : priority === "B" ? 0.72 : 0.56;
    const recommended = state.sidebarMode === "recommendations" && state.recommendations.byTargetId.has(target.targetId);
    const alpha = recommended ? 1 : aboveHorizon ? baseAlpha * (usable ? 1 : 0.62) : 0.25;
    const photoCount = state.catalog.photoLinks.byTargetId.get(target.targetId)?.length || 0;
    const item = { target, position, point, alpha, aboveHorizon, usable, visibility, photoCount, recommended };
    rendered.push(item);
    if (target.targetId !== state.selectedCatalogId && target.targetId !== state.hoveredCatalogId) {
      drawCatalogSymbol(item);
    }
  }
  drawCatalogLabels(rendered, density);
  ctx.restore();

  state.catalog.rendered = rendered;
  updateLayerPanel(density, targets.length);
}

function drawRecommendationOverlay() {
  if (!state.layers.catalog || state.sidebarMode !== "recommendations") return;
  const occupied = [];
  for (const recommendation of state.recommendations.items.slice(0, RECOMMENDATION_MAP_LIMIT)) {
    const item = state.catalog.rendered.find((candidate) => candidate.target.targetId === recommendation.targetId);
    if (!item) continue;
    const selected = recommendation.targetId === state.selectedCatalogId;
    const radius = selected ? 13 : 10.5;
    ctx.save();
    ctx.translate(item.point.x, item.point.y);
    ctx.strokeStyle = selected ? "#f5d98a" : "rgba(226, 189, 104, 0.78)";
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.setLineDash(selected ? [] : [2.5, 2.5]);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const marker = { x: item.point.x - 26, y: item.point.y - 20, width: 18, height: 14 };
    if (
      marker.x < 2 || marker.y < 2 || marker.x + marker.width > state.size.width - 2 ||
      marker.y + marker.height > state.size.height - 2 || occupied.some((other) => rectanglesOverlap(marker, other))
    ) continue;
    occupied.push(marker);
    ctx.save();
    ctx.fillStyle = selected ? "#e2bd68" : "rgba(22, 26, 20, 0.94)";
    ctx.strokeStyle = "rgba(226, 189, 104, 0.82)";
    ctx.lineWidth = 1;
    ctx.fillRect(marker.x, marker.y, marker.width, marker.height);
    ctx.strokeRect(marker.x + 0.5, marker.y + 0.5, marker.width - 1, marker.height - 1);
    ctx.fillStyle = selected ? "#09100b" : "#f1d58d";
    ctx.font = "700 9px SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(recommendation.rank), marker.x + marker.width / 2, marker.y + marker.height / 2 + 0.5);
    ctx.restore();
  }
}

function drawCatalogInteractionOverlay() {
  if (!state.layers.catalog) return;
  const ids = [state.hoveredCatalogId, state.selectedCatalogId].filter(Boolean);
  const drawn = new Set();
  for (const targetId of ids) {
    if (drawn.has(targetId)) continue;
    const item = state.catalog.rendered.find((candidate) => candidate.target.targetId === targetId);
    if (!item) continue;
    const selected = targetId === state.selectedCatalogId;
    const hovered = targetId === state.hoveredCatalogId;
    drawCatalogSymbol(item, { selected, hovered, alpha: 1 });
    drawCatalogLabel(item, { selected, hovered, alpha: 1 });
    drawn.add(targetId);
  }
}

function solarSymbolSize(body, emphasized = false) {
  if (emphasized) return body.id === "Sun" || body.id === "Moon" ? 11 : 9;
  if (["Sun", "Moon", "Jupiter", "Saturn"].includes(body.id)) return 8;
  return 6.5;
}

function drawMoonPhaseGlyph(body, size) {
  const phase = normalizeDegrees(body.moonPhaseDeg || 0);
  ctx.fillStyle = "#202822";
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = body.color;
  ctx.lineWidth = 1.25;
  for (let y = -size; y <= size; y += 1) {
    const edge = Math.sqrt(Math.max(0, size * size - y * y));
    if (phase <= 180) {
      const terminator = Math.cos(phase * DEG_TO_RAD) * edge;
      ctx.beginPath();
      ctx.moveTo(terminator, y);
      ctx.lineTo(edge, y);
      ctx.stroke();
    } else {
      const terminator = -Math.cos(phase * DEG_TO_RAD) * edge;
      ctx.beginPath();
      ctx.moveTo(-edge, y);
      ctx.lineTo(terminator, y);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = "#f1f4ef";
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSolarGlyph(body, point, options = {}) {
  const selected = options.selected === true;
  const hovered = options.hovered === true;
  const emphasized = selected || hovered;
  const size = solarSymbolSize(body, emphasized);
  const alpha = options.alpha ?? (body.aboveHorizon ? 0.94 : 0.26);

  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (emphasized) {
    ctx.strokeStyle = selected ? "rgba(245, 217, 138, 0.5)" : "rgba(238, 245, 236, 0.35)";
    ctx.lineWidth = selected ? 8 : 6;
    ctx.beginPath();
    ctx.arc(0, 0, size + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = selected ? "#f5d98a" : body.color;
  ctx.fillStyle = body.color;
  ctx.lineWidth = emphasized ? 1.8 : 1.3;

  if (body.id === "Sun") {
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * (size + 2), Math.sin(angle) * (size + 2));
      ctx.lineTo(Math.cos(angle) * (size + 5), Math.sin(angle) * (size + 5));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6c561e";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
    ctx.stroke();
  } else if (body.id === "Moon") {
    drawMoonPhaseGlyph(body, size);
  } else if (body.id === "Mercury") {
    ctx.beginPath();
    ctx.arc(0, -1, size * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -size * 0.76, size * 0.42, Math.PI * 0.1, Math.PI * 0.9, true);
    ctx.moveTo(0, size * 0.1);
    ctx.lineTo(0, size);
    ctx.moveTo(-size * 0.4, size * 0.62);
    ctx.lineTo(size * 0.4, size * 0.62);
    ctx.stroke();
  } else if (body.id === "Venus") {
    ctx.beginPath();
    ctx.arc(0, -size * 0.2, size * 0.65, 0, Math.PI * 2);
    ctx.moveTo(0, size * 0.45);
    ctx.lineTo(0, size * 1.15);
    ctx.moveTo(-size * 0.4, size * 0.82);
    ctx.lineTo(size * 0.4, size * 0.82);
    ctx.stroke();
  } else if (body.id === "Mars") {
    ctx.beginPath();
    ctx.arc(-size * 0.15, size * 0.15, size * 0.62, 0, Math.PI * 2);
    ctx.moveTo(size * 0.3, -size * 0.3);
    ctx.lineTo(size, -size);
    ctx.moveTo(size * 0.55, -size);
    ctx.lineTo(size, -size);
    ctx.lineTo(size, -size * 0.55);
    ctx.stroke();
  } else if (body.id === "Jupiter") {
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(12, 16, 13, 0.9)";
    ctx.fill();
    ctx.stroke();
    for (const y of [-size * 0.34, size * 0.25]) {
      const edge = Math.sqrt(size * size - y * y);
      ctx.beginPath();
      ctx.moveTo(-edge, y);
      ctx.lineTo(edge, y);
      ctx.stroke();
    }
    ctx.fillStyle = body.color;
    ctx.beginPath();
    ctx.arc(size * 0.32, size * 0.02, 1.25, 0, Math.PI * 2);
    ctx.fill();
  } else if (body.id === "Saturn") {
    ctx.save();
    ctx.rotate(-0.25);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.65, size * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(12, 16, 13, 0.96)";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else if (body.id === "Uranus") {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.64, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 1.25, 0);
    ctx.lineTo(size * 1.25, 0);
    ctx.moveTo(-size, -size * 0.42);
    ctx.lineTo(-size, size * 0.42);
    ctx.moveTo(size, -size * 0.42);
    ctx.lineTo(size, size * 0.42);
    ctx.stroke();
  } else if (body.id === "Neptune") {
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(0, size);
    ctx.moveTo(-size, -size * 0.65);
    ctx.quadraticCurveTo(-size * 0.8, size * 0.05, 0, size * 0.05);
    ctx.quadraticCurveTo(size * 0.8, size * 0.05, size, -size * 0.65);
    ctx.moveTo(-size * 0.35, size * 0.62);
    ctx.lineTo(size * 0.35, size * 0.62);
    ctx.stroke();
  }
  ctx.restore();
}

function solarLabelRect(item, offset) {
  ctx.font = "650 11px Inter, system-ui, sans-serif";
  const width = Math.ceil(ctx.measureText(item.body.name).width) + 12;
  return {
    x: item.point.x + offset.x,
    y: item.point.y + offset.y - 9,
    width,
    height: 18,
  };
}

function drawSolarLabel(item, options = {}) {
  const selected = options.selected === true;
  const hovered = options.hovered === true;
  const rectangle = options.rectangle || solarLabelRect(item, { x: 14, y: -11 });
  ctx.save();
  ctx.globalAlpha = options.alpha ?? (item.body.aboveHorizon ? 0.9 : 0.32);
  ctx.fillStyle = selected ? "rgba(42, 35, 17, 0.96)" : "rgba(7, 11, 8, 0.9)";
  ctx.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  ctx.strokeStyle = selected ? "rgba(245, 217, 138, 0.82)" : hovered ? "rgba(238, 245, 236, 0.56)" : "rgba(77, 100, 84, 0.76)";
  ctx.strokeRect(rectangle.x + 0.5, rectangle.y + 0.5, rectangle.width - 1, rectangle.height - 1);
  ctx.fillStyle = selected ? "#f5d98a" : "#e7eee6";
  ctx.font = `${selected ? "750" : "650"} 11px Inter, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(item.body.name, rectangle.x + 6, rectangle.y + rectangle.height / 2 + 0.5);
  ctx.restore();
}

function drawSolarLabels(rendered) {
  const occupied = [];
  const offsets = [
    { x: 14, y: -11 },
    { x: 14, y: 12 },
    { x: -74, y: -11 },
    { x: -74, y: 12 },
    { x: 14, y: -30 },
    { x: 14, y: 31 },
  ];
  for (const item of rendered) {
    if (item.body.id === state.selectedSolarId || item.body.id === state.hoveredSolarId) continue;
    let rectangle = null;
    for (const offset of offsets) {
      const candidate = solarLabelRect(item, offset);
      if (
        candidate.x >= 2 &&
        candidate.y >= 2 &&
        candidate.x + candidate.width <= state.size.width - 2 &&
        candidate.y + candidate.height <= state.size.height - 2 &&
        !occupied.some((other) => rectanglesOverlap(candidate, other))
      ) {
        rectangle = candidate;
        break;
      }
    }
    if (!rectangle) continue;
    occupied.push(rectangle);
    drawSolarLabel(item, { rectangle });
  }
}

function drawSolarSystem() {
  if (!state.layers.solar || !state.solar.bodies.length) {
    state.solar.rendered = [];
    updateLayerPanel();
    return;
  }

  const rendered = [];
  for (const body of state.solar.bodies) {
    const position = { raDeg: body.raDeg, decDeg: body.decDeg, ...project(body.raDeg, body.decDeg) };
    const point = toScreen(position);
    if (!isPointOnMap(point, 40)) continue;
    const item = { body, position, point };
    rendered.push(item);
    if (body.id !== state.selectedSolarId && body.id !== state.hoveredSolarId) drawSolarGlyph(body, point);
  }
  drawSolarLabels(rendered);
  state.solar.rendered = rendered;
  updateLayerPanel();
}

function drawSolarInteractionOverlay() {
  if (!state.layers.solar) return;
  const ids = [state.hoveredSolarId, state.selectedSolarId].filter(Boolean);
  const drawn = new Set();
  for (const bodyId of ids) {
    if (drawn.has(bodyId)) continue;
    const item = state.solar.rendered.find((candidate) => candidate.body.id === bodyId);
    if (!item) continue;
    const selected = bodyId === state.selectedSolarId;
    const hovered = bodyId === state.hoveredSolarId;
    drawSolarGlyph(item.body, item.point, { selected, hovered, alpha: 1 });
    drawSolarLabel(item, { selected, hovered, alpha: 1 });
    drawn.add(bodyId);
  }
}

function drawObjects() {
  if (!state.layers.photos) return;
  const placed = state.filtered
    .map((record) => ({ record, position: getObjectPosition(record) }))
    .filter((item) => item.position);

  ctx.save();
  for (const item of placed) {
    const p = toScreen(item.position);
    if (p.x < -40 || p.y < -40 || p.x > state.size.width + 40 || p.y > state.size.height + 40) continue;
    const active = item.record.id === state.selectedId;
    const hovered = item.record.id === state.hoveredId;
    const radius = active ? 8 : hovered ? 7 : 6;

    ctx.fillStyle = active ? "#e2bd68" : "#8fe3aa";
    ctx.strokeStyle = active ? "rgba(226, 189, 104, 0.35)" : "rgba(143, 227, 170, 0.28)";
    ctx.lineWidth = active ? 10 : 7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#071008";
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = active ? "#f5d98a" : "#d9eadc";
    ctx.font = active ? "700 13px Inter, system-ui, sans-serif" : "12px Inter, system-ui, sans-serif";
    ctx.fillText(item.record.title || item.record.objectId || "Snímek", p.x + 12, p.y - 10);
  }
  ctx.restore();
}

function drawFrame() {
  ctx.save();
  ctx.strokeStyle = "rgba(143, 227, 170, 0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(state.view.x, state.view.y, BASE_WIDTH * state.view.scale, BASE_HEIGHT * state.view.scale);
  ctx.restore();
}

function fitView() {
  const scale = Math.min(state.size.width / BASE_WIDTH, state.size.height / BASE_HEIGHT) * 0.94;
  state.view.scale = Math.max(MIN_ZOOM, scale);
  state.view.fitScale = state.view.scale;
  state.view.x = (state.size.width - BASE_WIDTH * state.view.scale) / 2;
  state.view.y = (state.size.height - BASE_HEIGHT * state.view.scale) / 2;
  drawSky();
}

function zoomAt(screenPoint, factor) {
  const oldScale = state.view.scale;
  const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldScale * factor));
  if (nextScale === oldScale) return;
  const world = toWorld(screenPoint);
  state.view.scale = nextScale;
  state.view.x = screenPoint.x - world.x * nextScale;
  state.view.y = screenPoint.y - world.y * nextScale;
  drawSky();
}

function centerOnRecord(record) {
  const position = getObjectPosition(record);
  if (!position) return;
  state.view.scale = Math.max(state.view.scale, Math.min(MAX_ZOOM, 1.15));
  state.view.x = state.size.width / 2 - position.x * state.view.scale;
  state.view.y = state.size.height / 2 - position.y * state.view.scale;
  drawSky();
}

function centerOnCatalogTarget(target) {
  const position = catalogTargetPosition(target);
  if (!position) return;
  state.view.scale = Math.max(state.view.scale, Math.min(MAX_ZOOM, 1.15));
  state.view.x = state.size.width / 2 - position.x * state.view.scale;
  state.view.y = state.size.height / 2 - position.y * state.view.scale;
  drawSky();
}

function centerOnSolarBody(body) {
  if (!body) return;
  const position = project(body.raDeg, body.decDeg);
  state.view.scale = Math.max(state.view.scale, Math.min(MAX_ZOOM, 1.15));
  state.view.x = state.size.width / 2 - position.x * state.view.scale;
  state.view.y = state.size.height / 2 - position.y * state.view.scale;
  drawSky();
}

function findPinAt(point) {
  if (!state.layers.photos) return null;
  let nearest = null;
  let nearestDistance = 18;
  for (const record of state.filtered) {
    const position = getObjectPosition(record);
    if (!position) continue;
    const p = toScreen(position);
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = record;
    }
  }
  return nearest;
}

function findCatalogTargetAt(point) {
  if (!state.layers.catalog) return null;
  let nearest = null;
  let nearestDistance = 14;
  for (const item of [...state.catalog.rendered].reverse()) {
    const distance = Math.hypot(point.x - item.point.x, point.y - item.point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = item.target;
    }
  }
  return nearest;
}

function findSolarBodyAt(point) {
  if (!state.layers.solar) return null;
  let nearest = null;
  let nearestDistance = 18;
  for (const item of [...state.solar.rendered].reverse()) {
    const distance = Math.hypot(point.x - item.point.x, point.y - item.point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = item.body;
    }
  }
  return nearest;
}

function findMapTargetAt(point) {
  const photo = findPinAt(point);
  if (photo) return { kind: "photo", record: photo };
  const solarBody = findSolarBodyAt(point);
  if (solarBody) return { kind: "solar", body: solarBody };
  const catalogTarget = findCatalogTargetAt(point);
  return catalogTarget ? { kind: "catalog", target: catalogTarget } : null;
}

function resizeCanvas() {
  const rect = elements.canvas.getBoundingClientRect();
  state.size.width = Math.max(1, rect.width);
  state.size.height = Math.max(1, rect.height);
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  elements.canvas.width = Math.floor(state.size.width * state.dpr);
  elements.canvas.height = Math.floor(state.size.height * state.dpr);
  fitView();
}

function selectRecord(id, center = false) {
  state.selectedId = id;
  state.selectedCatalogId = null;
  state.selectedSolarId = null;
  state.sidebarMode = "photos";
  const record = state.objects.find((item) => item.id === id);
  renderAll();
  if (center && record) {
    centerOnRecord(record);
  }
}

function selectCatalogTarget(targetId) {
  if (!state.catalog.byId.has(targetId)) return;
  state.selectedCatalogId = targetId;
  state.selectedSolarId = null;
  state.sidebarMode = "catalog";
  renderAll();
  requestAnimationFrame(() => {
    elements.catalogResultsList.querySelector(`[data-target-id="${CSS.escape(targetId)}"]`)?.scrollIntoView({ block: "nearest" });
  });
}

function selectRecommendationTarget(targetId) {
  if (!state.recommendations.byTargetId.has(targetId)) return;
  state.selectedCatalogId = targetId;
  state.selectedSolarId = null;
  state.sidebarMode = "recommendations";
  renderAll();
  requestAnimationFrame(() => {
    elements.recommendationResultsList.querySelector(`[data-recommendation-target-id="${CSS.escape(targetId)}"]`)?.scrollIntoView({ block: "nearest" });
  });
}

function selectSolarBody(bodyId, center = false) {
  const body = state.solar.byId.get(bodyId);
  if (!body) return;
  state.selectedSolarId = bodyId;
  state.selectedCatalogId = null;
  state.sidebarMode = "solar";
  renderAll();
  requestAnimationFrame(() => {
    elements.solarResultsList.querySelector(`[data-solar-id="${CSS.escape(bodyId)}"]`)?.scrollIntoView({ block: "nearest" });
  });
  if (center) centerOnSolarBody(body);
}

function clearPhotoToolbarFilters() {
  elements.searchInput.value = "";
  elements.constellationFilter.value = "";
  elements.typeFilter.value = "";
  elements.yearFilter.value = "";
  elements.equipmentFilter.value = "";
}

function openSelectedCatalogPhotos() {
  const targetId = state.selectedCatalogId;
  const photos = state.catalog.photoLinks.byTargetId.get(targetId) || [];
  if (!targetId || !photos.length) return;
  clearPhotoToolbarFilters();
  state.photoTargetFilterId = targetId;
  state.selectedId = photos[0].id;
  state.selectedCatalogId = null;
  state.sidebarMode = "photos";
  applyFilters();
}

function clearPhotoTargetFilter() {
  state.photoTargetFilterId = null;
  applyFilters();
}

function openCreateDialog() {
  state.dialogMode = "create";
  state.editingId = null;
  elements.dialogTitle.textContent = "Nový snímek";
  elements.dialogMode.textContent = "Upload a metadata";
  elements.fileField.style.display = "grid";
  elements.photoInput.required = true;
  elements.photoInput.value = "";
  elements.deleteButton.hidden = true;
  fillForm({});
  elements.dialog.showModal();
  fields.title.focus();
}

function openEditDialog(record) {
  state.dialogMode = "edit";
  state.editingId = record.id;
  elements.dialogTitle.textContent = display(record.title, "Snímek");
  elements.dialogMode.textContent = "Editace metadat";
  elements.fileField.style.display = "none";
  elements.photoInput.required = false;
  elements.photoInput.value = "";
  elements.deleteButton.hidden = false;
  fillForm(record);
  elements.dialog.showModal();
  fields.title.focus();
}

function fillForm(record) {
  for (const [key, input] of Object.entries(fields)) {
    input.value = record[key] || "";
  }
}

function readForm() {
  const payload = {};
  for (const [key, input] of Object.entries(fields)) {
    payload[key] = input.value.trim();
  }
  return payload;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function saveForm(event) {
  event.preventDefault();
  const payload = readForm();
  if (state.dialogMode === "create") {
    const file = elements.photoInput.files?.[0];
    if (!file) return;
    payload.fileName = file.name;
    payload.fileData = await readFileAsDataUrl(file);
    const response = await fetch("/api/objects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      alert((await response.json()).error || "Upload se nepovedl.");
      return;
    }
    const record = await response.json();
    state.selectedId = record.id;
  } else {
    const response = await fetch(`/api/objects/${encodeURIComponent(state.editingId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      alert((await response.json()).error || "Uložení se nepovedlo.");
      return;
    }
  }
  elements.dialog.close();
  await loadObjects();
}

async function deleteCurrentRecord() {
  const record = state.objects.find((item) => item.id === state.editingId);
  if (!record) return;
  const ok = confirm(`Odebrat z atlasu: ${record.title || record.objectId || "snímek"}?`);
  if (!ok) return;
  const response = await fetch(`/api/objects/${encodeURIComponent(record.id)}`, { method: "DELETE" });
  if (!response.ok) {
    alert((await response.json()).error || "Odebrání se nepovedlo.");
    return;
  }
  elements.dialog.close();
  state.selectedId = null;
  await loadObjects();
}

function bindEvents() {
  for (const element of [
    elements.searchInput,
    elements.constellationFilter,
    elements.typeFilter,
    elements.yearFilter,
    elements.equipmentFilter,
  ]) {
    element.addEventListener("input", applyFilters);
  }

  for (const element of [
    elements.photoLayerToggle,
    elements.catalogLayerToggle,
    elements.solarLayerToggle,
    elements.catalogShowAllToggle,
    ...elements.catalogPhotoStatusInputs,
  ]) {
    element.addEventListener("change", updateLayerSettings);
  }

  elements.catalogOpenPhotosButton.addEventListener("click", openSelectedCatalogPhotos);
  elements.catalogClearSelectionButton.addEventListener("click", () => {
    state.selectedCatalogId = null;
    renderAll();
  });
  elements.clearPhotoTargetFilterButton.addEventListener("click", clearPhotoTargetFilter);

  for (const tab of elements.sidebarTabs) {
    tab.addEventListener("click", () => setSidebarMode(tab.dataset.sidebarMode));
  }

  for (const button of [elements.catalogFiltersButton, elements.catalogResultsFilterButton, elements.recommendationFilterButton]) {
    button.addEventListener("click", openCatalogFiltersDialog);
  }
  for (const button of [elements.catalogQuickResetButton, elements.catalogResultsResetButton]) {
    button.addEventListener("click", resetCatalogFilters);
  }
  elements.catalogFiltersCloseButton.addEventListener("click", () => elements.catalogFiltersDialog.close());
  elements.catalogFiltersCancelButton.addEventListener("click", () => elements.catalogFiltersDialog.close());
  elements.catalogFiltersResetButton.addEventListener("click", () => {
    resetCatalogFilters();
    elements.catalogFiltersDialog.close();
  });
  elements.catalogFiltersForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.catalog.filters = readCatalogDialogFilters();
    applyCatalogFilters();
    elements.catalogFiltersDialog.close();
  });
  for (const input of [
    elements.catalogDifficultyFilter,
    elements.catalogSuitabilityFilter,
    elements.catalogIntegrationFilter,
    elements.catalogMinimumAltitude,
    elements.catalogWindowHours,
    elements.catalogMinimumDuration,
  ]) {
    input.addEventListener("input", updateCatalogFilterOutputs);
  }
  for (const input of [
    elements.catalogVisibilityMode,
    elements.catalogDirectionMode,
    elements.catalogHorizonEnabled,
  ]) {
    input.addEventListener("change", updateCatalogFilterOutputs);
  }
  elements.catalogSearchInput.addEventListener("input", () => {
    state.catalog.filters = catalogMapApi.normalizeCatalogFilters({
      ...state.catalog.filters,
      query: elements.catalogSearchInput.value,
    });
    applyCatalogFilters();
  });
  elements.catalogResultsList.addEventListener("click", (event) => {
    const result = event.target.closest(".catalog-result");
    if (result) selectCatalogTarget(result.dataset.targetId);
  });
  for (const input of elements.recommendationPhotoStatusInputs) {
    input.addEventListener("change", updateRecommendationPhotoStatus);
  }
  elements.recommendationLimit.addEventListener("input", () => {
    state.recommendations.limit = Number(elements.recommendationLimit.value);
    elements.recommendationLimitOutput.textContent = elements.recommendationLimit.value;
    writeLocationStorage(RECOMMENDATION_LIMIT_STORAGE_KEY, String(state.recommendations.limit));
    state.recommendations.calculationKey = "";
    renderAll();
  });
  elements.recommendationResultsList.addEventListener("click", (event) => {
    const result = event.target.closest("[data-recommendation-target-id]");
    if (result) selectRecommendationTarget(result.dataset.recommendationTargetId);
  });
  elements.solarResultsList.addEventListener("click", (event) => {
    const result = event.target.closest("[data-solar-id]");
    if (result) selectSolarBody(result.dataset.solarId);
  });

  elements.resetViewButton.addEventListener("click", fitView);
  elements.visibilityToggle.addEventListener("change", updateVisibilityState);
  elements.placeSelect.addEventListener("change", handleAtlasPlaceSelection);
  elements.atlasApplyCoordinatesButton.addEventListener("click", applyAtlasCoordinates);
  for (const input of [elements.atlasLatitudeInput, elements.atlasLongitudeInput]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") applyAtlasCoordinates();
    });
  }
  for (const input of [elements.visibilityDate, elements.visibilityTime]) {
    input.addEventListener("input", () => {
      stopTimePlayback();
      updateVisibilityState();
    });
  }
  elements.nowVisibilityButton.addEventListener("click", () => setVisibilityToNow(true));
  for (const button of elements.timeStepButtons) {
    button.addEventListener("click", () => shiftAtlasTime({
      minutes: Number(button.dataset.timeStepMinutes || 0),
      days: Number(button.dataset.timeStepDays || 0),
    }));
  }
  elements.timePlaybackButton.addEventListener("click", toggleTimePlayback);
  elements.timePlaybackStep.addEventListener("change", () => {
    state.time.playbackStepMinutes = timeControlsApi.normalizePlaybackStep(elements.timePlaybackStep.value);
    writeLocationStorage(TIME_PLAYBACK_STEP_STORAGE_KEY, String(state.time.playbackStepMinutes));
    syncTimeControls();
  });
  elements.timeTimeline.addEventListener("input", handleTimelineInput);
  elements.timeTimeline.addEventListener("change", handleTimelineChange);
  elements.zoomInButton.addEventListener("click", () => zoomAt({ x: state.size.width / 2, y: state.size.height / 2 }, 1.25));
  elements.zoomOutButton.addEventListener("click", () => zoomAt({ x: state.size.width / 2, y: state.size.height / 2 }, 0.8));

  elements.objectList.addEventListener("click", (event) => {
    const card = event.target.closest(".object-card");
    if (!card) return;
    selectRecord(card.dataset.id, false);
  });

  elements.detailPanel.addEventListener("click", (event) => {
    const recommendationAction = event.target.closest("[data-recommendation-action]")?.dataset.recommendationAction;
    if (recommendationAction) {
      const target = state.catalog.byId.get(state.selectedCatalogId);
      if (!target) return;
      if (recommendationAction === "center") centerOnCatalogTarget(target);
      if (recommendationAction === "catalog") selectCatalogTarget(target.targetId);
      if (recommendationAction === "photos") openSelectedCatalogPhotos();
      return;
    }
    const relatedTargetButton = event.target.closest("[data-catalog-target-id]");
    if (relatedTargetButton) {
      selectCatalogTarget(relatedTargetButton.dataset.catalogTargetId);
      return;
    }
    const catalogAction = event.target.closest("[data-catalog-action]")?.dataset.catalogAction;
    if (catalogAction) {
      const target = state.catalog.byId.get(state.selectedCatalogId);
      if (!target) return;
      if (catalogAction === "center") centerOnCatalogTarget(target);
      if (catalogAction === "photos") openSelectedCatalogPhotos();
      return;
    }
    const solarAction = event.target.closest("[data-solar-action]")?.dataset.solarAction;
    if (solarAction) {
      const body = state.solar.byId.get(state.selectedSolarId);
      if (solarAction === "center" && body) centerOnSolarBody(body);
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    const record = state.objects.find((item) => item.id === state.selectedId);
    if (!record) return;
    if (action === "center") centerOnRecord(record);
  });

  elements.canvas.addEventListener("pointerdown", (event) => {
    const rect = elements.canvas.getBoundingClientRect();
    updateMapPositionReadout({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    elements.canvas.setPointerCapture(event.pointerId);
    state.dragging = true;
    state.dragMoved = false;
    state.dragStart = { x: event.clientX, y: event.clientY };
    state.viewStart = { x: state.view.x, y: state.view.y };
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    const rect = elements.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    updateMapPositionReadout(point);
    if (state.dragging) {
      const dx = event.clientX - state.dragStart.x;
      const dy = event.clientY - state.dragStart.y;
      if (Math.hypot(dx, dy) > 3) state.dragMoved = true;
      state.view.x = state.viewStart.x + dx;
      state.view.y = state.viewStart.y + dy;
      drawSky();
      return;
    }
    const hovered = findMapTargetAt(point);
    const nextPhotoId = hovered?.kind === "photo" ? hovered.record.id : null;
    const nextCatalogId = hovered?.kind === "catalog" ? hovered.target.targetId : null;
    const nextSolarId = hovered?.kind === "solar" ? hovered.body.id : null;
    if (
      nextPhotoId !== state.hoveredId ||
      nextCatalogId !== state.hoveredCatalogId ||
      nextSolarId !== state.hoveredSolarId
    ) {
      state.hoveredId = nextPhotoId;
      state.hoveredCatalogId = nextCatalogId;
      state.hoveredSolarId = nextSolarId;
      elements.canvas.style.cursor = hovered ? "pointer" : "grab";
      drawSky();
    }
  });

  elements.canvas.addEventListener("pointerup", (event) => {
    const rect = elements.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    state.dragging = false;
    elements.canvas.style.cursor = "grab";
    if (!state.dragMoved) {
      const target = findMapTargetAt(point);
      if (target?.kind === "photo") selectRecord(target.record.id, false);
      if (target?.kind === "catalog") {
        const targetId = target.target.targetId;
        if (state.sidebarMode === "recommendations" && state.recommendations.byTargetId.has(targetId)) {
          selectRecommendationTarget(targetId);
        } else {
          selectCatalogTarget(targetId);
        }
      }
      if (target?.kind === "solar") selectSolarBody(target.body.id, false);
    }
  });

  elements.canvas.addEventListener("pointerleave", () => {
    if (state.dragging) return;
    updateMapPositionReadout();
    if (state.hoveredId !== null || state.hoveredCatalogId !== null || state.hoveredSolarId !== null) {
      state.hoveredId = null;
      state.hoveredCatalogId = null;
      state.hoveredSolarId = null;
      drawSky();
    }
  });

  elements.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = elements.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    zoomAt(point, event.deltaY < 0 ? 1.14 : 0.88);
  }, { passive: false });

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener(LOCATION_CHANGE_EVENT, handleSharedAtlasLocation);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopTimePlayback();
  });
  window.addEventListener("beforeunload", () => {
    stopTimePlayback();
    clearTimelineRender();
  });
}

async function boot() {
  setupCollapsibleMapPanels();
  bindEvents();
  setupVisibilityControls();
  updateLayerPanel();
  resizeCanvas();
  try {
    await Promise.all([loadCatalog(), loadObjects()]);
    renderAll();
  } catch (error) {
    elements.detailPanel.innerHTML = `
      <div class="empty-detail">
        <strong>Data nenaběhla</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
  }
}

boot();
