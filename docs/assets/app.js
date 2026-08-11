const BASE_WIDTH = 2400;
const BASE_HEIGHT = 1200;
const MIN_ZOOM = 0.28;
const MAX_ZOOM = 8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const OBSERVING_PLACES = [
  { id: "praha", name: "Praha", lat: 50.0755, lon: 14.4378 },
  { id: "brno", name: "Brno", lat: 49.1951, lon: 16.6068 },
  { id: "ostrava", name: "Ostrava", lat: 49.8209, lon: 18.2625 },
  { id: "plzen", name: "Plzeň", lat: 49.7384, lon: 13.3736 },
  { id: "hradec-kralove", name: "Hradec Králové", lat: 50.2092, lon: 15.8328 },
];

const state = {
  objects: [],
  filtered: [],
  selectedId: null,
  hoveredId: null,
  dialogMode: "create",
  editingId: null,
  view: { scale: 1, x: 0, y: 0 },
  dragging: false,
  dragMoved: false,
  dragStart: { x: 0, y: 0 },
  viewStart: { x: 0, y: 0 },
  dpr: 1,
  size: { width: 0, height: 0 },
  visibility: {
    enabled: true,
    placeId: "praha",
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
  visibilityToggle: document.querySelector("#visibilityToggle"),
  placeSelect: document.querySelector("#placeSelect"),
  visibilityDate: document.querySelector("#visibilityDate"),
  visibilityTime: document.querySelector("#visibilityTime"),
  nowVisibilityButton: document.querySelector("#nowVisibilityButton"),
  visibilityStatus: document.querySelector("#visibilityStatus"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  visibleCount: document.querySelector("#visibleCount"),
  placedCount: document.querySelector("#placedCount"),
  listCount: document.querySelector("#listCount"),
  objectList: document.querySelector("#objectList"),
  detailPanel: document.querySelector("#detailPanel"),
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

const ctx = elements.canvas.getContext("2d");

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
  const jd = julianDate(date);
  const t = (jd - 2451545.0) / 36525;
  return normalizeDegrees(
    280.46061837 +
      360.98564736629 * (jd - 2451545.0) +
      0.000387933 * t * t -
      (t * t * t) / 38710000,
  );
}

function localSiderealTimeDeg(date, lonDeg) {
  return normalizeDegrees(greenwichSiderealTimeDeg(date) + lonDeg);
}

function formatSiderealTime(deg) {
  const totalMinutes = Math.round((normalizeDegrees(deg) / 15) * 60) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function getSelectedPlace() {
  return OBSERVING_PLACES.find((place) => place.id === state.visibility.placeId) || OBSERVING_PLACES[0];
}

function getVisibilityDate() {
  const dateValue = elements.visibilityDate.value;
  const timeValue = elements.visibilityTime.value || "00:00";
  if (!dateValue) return null;
  const date = new Date(`${dateValue}T${timeValue}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getVisibilityContext() {
  if (!state.visibility.enabled) return null;
  const place = getSelectedPlace();
  const date = getVisibilityDate();
  if (!date) return null;
  const lstDeg = localSiderealTimeDeg(date, place.lon);
  return {
    place,
    date,
    lstDeg,
    latRad: place.lat * DEG_TO_RAD,
  };
}

function altitudeDeg(raDeg, decDeg, visibilityContext) {
  const hourAngleRad = normalizeSignedDegrees(visibilityContext.lstDeg - raDeg) * DEG_TO_RAD;
  const decRad = decDeg * DEG_TO_RAD;
  const sinAlt =
    Math.sin(visibilityContext.latRad) * Math.sin(decRad) +
    Math.cos(visibilityContext.latRad) * Math.cos(decRad) * Math.cos(hourAngleRad);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD_TO_DEG;
}

function isSkyPositionVisible(raDeg, decDeg, visibilityContext) {
  return altitudeDeg(raDeg, decDeg, visibilityContext) >= 0;
}

function horizonDecDeg(raDeg, visibilityContext) {
  const hourAngleRad = normalizeSignedDegrees(visibilityContext.lstDeg - raDeg) * DEG_TO_RAD;
  const latRad = visibilityContext.latRad;
  if (Math.abs(Math.sin(latRad)) < 0.000001) {
    return 0;
  }
  return Math.atan2(-Math.cos(latRad) * Math.cos(hourAngleRad), Math.sin(latRad)) * RAD_TO_DEG;
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

async function loadObjects() {
  const response = await fetch("data/objects.json");
  if (!response.ok) {
    throw new Error("Nepovedlo se načíst data atlasu.");
  }
  state.objects = await response.json();
  if (!state.selectedId && state.objects.length) {
    state.selectedId = state.objects[0].id;
  }
  rebuildFilters();
  applyFilters();
  renderConstellationOptions();
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
  elements.placeSelect.innerHTML = "";
  for (const place of OBSERVING_PLACES) {
    const option = document.createElement("option");
    option.value = place.id;
    option.textContent = place.name;
    elements.placeSelect.append(option);
  }
  elements.placeSelect.value = state.visibility.placeId;
  elements.visibilityToggle.checked = state.visibility.enabled;
  setVisibilityToNow(false);
  updateVisibilityState();
}

function setVisibilityToNow(shouldDraw = true) {
  const now = new Date();
  elements.visibilityDate.value = formatDateInput(now);
  elements.visibilityTime.value = formatTimeInput(now);
  if (shouldDraw) {
    updateVisibilityState();
  }
}

function updateVisibilityState() {
  state.visibility.enabled = elements.visibilityToggle.checked;
  state.visibility.placeId = elements.placeSelect.value || "praha";
  const context = getVisibilityContext();
  if (!state.visibility.enabled) {
    elements.visibilityStatus.textContent = "vrstva vypnuta";
  } else if (!context) {
    elements.visibilityStatus.textContent = "neplatný čas";
  } else {
    elements.visibilityStatus.textContent = `${context.place.name} · LST ${formatSiderealTime(context.lstDeg)}`;
  }
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
      (!query || text.includes(query)) &&
      (!constellation || record.constellation === constellation) &&
      (!type || record.type === type) &&
      (!year || getYear(record) === year) &&
      (!equipment || record.equipment === equipment)
    );
  });

  if (state.filtered.length && !state.filtered.some((item) => item.id === state.selectedId)) {
    state.selectedId = state.filtered[0].id;
  }

  renderAll();
}

function renderAll() {
  renderCounts();
  renderDetail();
  renderObjectList();
  drawSky();
}

function renderCounts() {
  const positions = state.filtered.map((record) => getObjectPosition(record)).filter(Boolean);
  const visibilityContext = getVisibilityContext();
  const visiblePositions = visibilityContext
    ? positions.filter((position) => isSkyPositionVisible(position.raDeg, position.decDeg, visibilityContext)).length
    : null;
  elements.visibleCount.textContent = `${state.filtered.length} snímků`;
  elements.placedCount.textContent =
    visiblePositions === null ? `${positions.length} pozic` : `${visiblePositions}/${positions.length} nad horizontem`;
  elements.listCount.textContent = String(state.filtered.length);
}

function renderDetail() {
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

function renderObjectList() {
  const html = state.filtered
    .map((record) => {
      const position = getObjectPosition(record);
      const active = record.id === state.selectedId ? " is-active" : "";
      const subtitle = [record.objectId, record.commonName].filter(Boolean).join(" · ");
      const facts = [record.constellation, record.type, getYear(record) || record.equipment, position ? "RA/Dec" : "bez pozice"]
        .filter(Boolean)
        .join(" · ");
      return `
        <button class="object-card${active}" type="button" data-id="${escapeHtml(record.id)}">
          <img src="${imageSrc(record.thumbnail || record.image)}" alt="${escapeHtml(record.title)}" loading="lazy" />
          <span class="card-text">
            <span class="card-title">${escapeHtml(display(record.title, "Snímek"))}</span>
            <span class="card-subtitle">${escapeHtml(display(subtitle))}</span>
            <span class="card-facts">${escapeHtml(display(facts))}</span>
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
  drawObjects();
  drawFrame();
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

  const horizon = [];
  for (let ra = 0; ra <= 360; ra += 2) {
    horizon.push(toScreen(project(ra, horizonDecDeg(ra, visibilityContext))));
  }

  ctx.save();
  ctx.beginPath();
  if (visibilityContext.place.lat >= 0) {
    const topRight = toScreen(project(0, 90));
    const topLeft = toScreen(project(360, 90));
    ctx.moveTo(topRight.x, topRight.y);
    ctx.lineTo(topLeft.x, topLeft.y);
    for (let index = horizon.length - 1; index >= 0; index -= 1) {
      ctx.lineTo(horizon[index].x, horizon[index].y);
    }
  } else {
    const bottomRight = toScreen(project(0, -90));
    const bottomLeft = toScreen(project(360, -90));
    ctx.moveTo(bottomRight.x, bottomRight.y);
    ctx.lineTo(bottomLeft.x, bottomLeft.y);
    for (let index = horizon.length - 1; index >= 0; index -= 1) {
      ctx.lineTo(horizon[index].x, horizon[index].y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(143, 227, 170, 0.075)";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(horizon[0].x, horizon[0].y);
  for (const point of horizon.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.strokeStyle = "rgba(226, 189, 104, 0.78)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const meridianX = toScreen(project(visibilityContext.lstDeg, 0)).x;
  ctx.beginPath();
  ctx.moveTo(meridianX, state.view.y);
  ctx.lineTo(meridianX, state.view.y + BASE_HEIGHT * state.view.scale);
  ctx.strokeStyle = "rgba(226, 189, 104, 0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const labelPoint = toScreen(project(visibilityContext.lstDeg, horizonDecDeg(visibilityContext.lstDeg, visibilityContext)));
  ctx.fillStyle = "rgba(226, 189, 104, 0.85)";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillText("horizont", labelPoint.x + 8, labelPoint.y - 8);
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

function drawObjects() {
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

function findPinAt(point) {
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
  const record = state.objects.find((item) => item.id === id);
  renderAll();
  if (center && record) {
    centerOnRecord(record);
  }
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

  elements.resetViewButton.addEventListener("click", fitView);
  elements.visibilityToggle.addEventListener("change", updateVisibilityState);
  elements.placeSelect.addEventListener("input", updateVisibilityState);
  elements.visibilityDate.addEventListener("input", updateVisibilityState);
  elements.visibilityTime.addEventListener("input", updateVisibilityState);
  elements.nowVisibilityButton.addEventListener("click", () => setVisibilityToNow(true));
  elements.zoomInButton.addEventListener("click", () => zoomAt({ x: state.size.width / 2, y: state.size.height / 2 }, 1.25));
  elements.zoomOutButton.addEventListener("click", () => zoomAt({ x: state.size.width / 2, y: state.size.height / 2 }, 0.8));

  elements.objectList.addEventListener("click", (event) => {
    const card = event.target.closest(".object-card");
    if (!card) return;
    selectRecord(card.dataset.id, false);
  });

  elements.detailPanel.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (!action) return;
    const record = state.objects.find((item) => item.id === state.selectedId);
    if (!record) return;
    if (action === "center") centerOnRecord(record);
  });

  elements.canvas.addEventListener("pointerdown", (event) => {
    elements.canvas.setPointerCapture(event.pointerId);
    state.dragging = true;
    state.dragMoved = false;
    state.dragStart = { x: event.clientX, y: event.clientY };
    state.viewStart = { x: state.view.x, y: state.view.y };
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    const rect = elements.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (state.dragging) {
      const dx = event.clientX - state.dragStart.x;
      const dy = event.clientY - state.dragStart.y;
      if (Math.hypot(dx, dy) > 3) state.dragMoved = true;
      state.view.x = state.viewStart.x + dx;
      state.view.y = state.viewStart.y + dy;
      drawSky();
      return;
    }
    const hovered = findPinAt(point);
    const nextId = hovered?.id || null;
    if (nextId !== state.hoveredId) {
      state.hoveredId = nextId;
      elements.canvas.style.cursor = nextId ? "pointer" : "grab";
      drawSky();
    }
  });

  elements.canvas.addEventListener("pointerup", (event) => {
    const rect = elements.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    state.dragging = false;
    elements.canvas.style.cursor = "grab";
    if (!state.dragMoved) {
      const record = findPinAt(point);
      if (record) selectRecord(record.id, false);
    }
  });

  elements.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = elements.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    zoomAt(point, event.deltaY < 0 ? 1.14 : 0.88);
  }, { passive: false });

  window.addEventListener("resize", resizeCanvas);
}

async function boot() {
  bindEvents();
  setupVisibilityControls();
  resizeCanvas();
  try {
    await loadObjects();
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
