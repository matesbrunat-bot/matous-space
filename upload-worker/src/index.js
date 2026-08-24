const MIB = 1024 * 1024;
const PHOTO_PREFIX = "full/";
const THUMB_PREFIX = "thumb/";
const QUOTA_OBJECT_NAME = "atlas-uploads";
const METADATA_HEADER = "X-Atlas-Metadata";
const TURNSTILE_HEADER = "X-Turnstile-Token";
const RESERVATION_TTL_MS = 10 * 60 * 1000;
const PRAGUE_TIME_ZONE = "Europe/Prague";

export const LIMITS = Object.freeze({
  sourceBytes: 8 * MIB,
  requestBytes: Math.floor(5.5 * MIB),
  fullBytes: 4 * MIB,
  thumbnailBytes: 512 * 1024,
  fullMaxEdge: 4096,
  thumbnailMaxEdge: 900,
  maxPixels: 40_000_000,
  perIpDailyCount: 10,
  globalDailyCount: 25,
  globalDailyBytes: 100 * MIB,
  totalCount: 2000,
  totalBytes: 2 * 1024 * MIB,
  cooldownMs: 60_000,
});

const FIELD_LIMITS = Object.freeze({
  title: 80,
  objectId: 100,
  commonName: 100,
  type: 60,
  constellation: 40,
  equipment: 80,
  exposure: 80,
  location: 120,
  notes: 500,
  catalogTargetId: 48,
  ra: 40,
  dec: 40,
});

const ADMIN_EDITABLE_FIELDS = Object.freeze([
  "title",
  "objectId",
  "commonName",
  "type",
  "constellation",
  "ra",
  "dec",
  "date",
  "equipment",
  "exposure",
  "location",
  "notes",
  "catalogTargetId",
]);

function splitSetting(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function allowedOrigins(env) {
  return new Set(splitSetting(env.ALLOWED_ORIGINS));
}

function corsHeaders(origin, env) {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, ${METADATA_HEADER}, ${TURNSTILE_HEADER}`,
    "Access-Control-Max-Age": "86400",
  });
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(payload, status = 200, origin = "", env = {}) {
  const headers = corsHeaders(origin, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(payload), { status, headers });
}

function errorResponse(error, status, origin, env, code = "invalid_request") {
  return jsonResponse({ error, code }, status, origin, env);
}

function requirePublicOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  return origin && allowedOrigins(env).has(origin) ? origin : null;
}

function dateKeyForPrague(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRAGUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function datePath(dateKey) {
  return dateKey.replaceAll("-", "/");
}

async function hashIp(ip, salt) {
  const bytes = new TextEncoder().encode(`${salt || "unset"}:${ip || "unknown"}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function cleanText(source, field, required = false) {
  const text = String(source?.[field] ?? "").trim();
  if (required && !text) throw new Error(`Pole ${field} je povinné.`);
  const maximum = FIELD_LIMITS[field];
  if (maximum && text.length > maximum) {
    throw new Error(`Pole ${field} je příliš dlouhé.`);
  }
  return text;
}

function formatRa(hoursValue) {
  const totalSeconds = Math.round(hoursValue * 3600 * 10) / 10;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds - hours * 3600 - minutes * 60;
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${seconds.toFixed(1).padStart(4, "0")}s`;
}

function formatDec(degreesValue) {
  const sign = degreesValue < 0 ? "−" : "+";
  const absolute = Math.abs(degreesValue);
  const totalSeconds = Math.round(absolute * 3600);
  const degrees = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds - degrees * 3600 - minutes * 60;
  return `${sign}${String(degrees).padStart(2, "0")}° ${String(minutes).padStart(2, "0")}' ${String(seconds).padStart(2, "0")}"`;
}

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function applyAdminRecordPatch(record, patch, updatedAt = new Date().toISOString()) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Původní metadata nemají platný formát.");
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Oprava metadat nemá platný formát.");
  }
  const fields = Object.keys(patch);
  if (!fields.length) throw new Error("Chybí oprava metadat.");
  const unsupported = fields.find((field) => !ADMIN_EDITABLE_FIELDS.includes(field));
  if (unsupported) throw new Error(`Pole ${unsupported} nelze administrativně upravit.`);

  const updated = { ...record };
  for (const field of fields) {
    const value = String(patch[field] ?? "").trim();
    if (["title", "objectId", "type"].includes(field) && !value) {
      throw new Error(`Pole ${field} je povinné.`);
    }
    const maximum = FIELD_LIMITS[field];
    if (maximum && value.length > maximum) throw new Error(`Pole ${field} je příliš dlouhé.`);
    if (field === "date" && !validDate(value)) throw new Error("Datum nemá platný formát.");
    if (field === "catalogTargetId" && value && !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error("Katalogový cíl má neplatné ID.");
    }
    if (value || ["title", "objectId", "type", "ra", "dec"].includes(field)) updated[field] = value;
    else delete updated[field];
  }
  updated.updatedAt = updatedAt;
  return updated;
}

export function validateMetadata(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Metadata nemají platný formát.");
  }
  const withoutCoordinates = source.withoutCoordinates === true;
  const raHours = Number(source.raHours);
  const decDeg = Number(source.decDeg);
  if (!withoutCoordinates) {
    if (!Number.isFinite(raHours) || raHours < 0 || raHours >= 24) {
      throw new Error("RA musí být číslo od 0 do méně než 24 hodin.");
    }
    if (!Number.isFinite(decDeg) || decDeg < -90 || decDeg > 90) {
      throw new Error("Dec musí být číslo od −90 do +90 stupňů.");
    }
  }

  const date = cleanText(source, "date");
  if (!validDate(date)) throw new Error("Datum nemá platný formát.");
  const catalogTargetId = cleanText(source, "catalogTargetId");
  if (catalogTargetId && !/^[A-Za-z0-9_-]+$/.test(catalogTargetId)) {
    throw new Error("Katalogový cíl má neplatné ID.");
  }

  return {
    title: cleanText(source, "title", true),
    objectId: cleanText(source, "objectId", true),
    commonName: cleanText(source, "commonName"),
    type: cleanText(source, "type", true),
    constellation: cleanText(source, "constellation"),
    ra: withoutCoordinates ? "" : formatRa(raHours),
    dec: withoutCoordinates ? "" : formatDec(decDeg),
    date,
    equipment: cleanText(source, "equipment"),
    exposure: cleanText(source, "exposure"),
    location: cleanText(source, "location"),
    notes: cleanText(source, "notes"),
    ...(catalogTargetId ? { catalogTargetId } : {}),
  };
}

function parseMetadataHeader(request) {
  const raw = request.headers.get(METADATA_HEADER) || "";
  if (!raw || raw.length > 8000) throw new Error("Chybí metadata snímku.");
  try {
    return validateMetadata(JSON.parse(decodeURIComponent(raw)));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof URIError) {
      throw new Error("Metadata snímku mají neplatný formát.");
    }
    throw error;
  }
}

function readUint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BE(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function detectMime(bytes) {
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: (bytes[offset + 7] << 8) | bytes[offset + 8], height: (bytes[offset + 5] << 8) | bytes[offset + 6] };
    }
    offset += 2 + length;
  }
  return null;
}

export function imageDimensions(bytes, mime = detectMime(bytes)) {
  if (mime === "image/png" && bytes.length >= 24) {
    return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
  }
  if (mime === "image/jpeg") return jpegDimensions(bytes);
  if (mime !== "image/webp" || bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === "VP8X") {
    return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
  }
  return null;
}

export function validateImageBytes(bytes, expectedMime, maximumBytes, maximumEdge) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error("Obrázek je prázdný.");
  if (bytes.byteLength > maximumBytes) throw new Error("Obrázek překračuje povolenou velikost.");
  const detectedMime = detectMime(bytes);
  if (!detectedMime || detectedMime !== expectedMime) throw new Error("Obsah obrázku neodpovídá povolenému formátu.");
  const dimensions = imageDimensions(bytes, detectedMime);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new Error("Rozměry obrázku se nepovedlo ověřit.");
  if (dimensions.width > maximumEdge || dimensions.height > maximumEdge) throw new Error("Obrázek má příliš velké rozměry.");
  if (dimensions.width * dimensions.height > LIMITS.maxPixels) throw new Error("Obrázek obsahuje příliš mnoho pixelů.");
  return { mime: detectedMime, ...dimensions };
}

function fileExtension(mime) {
  return mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg";
}

function encodeRecord(record) {
  return encodeURIComponent(JSON.stringify(record));
}

function decodeRecord(value) {
  try {
    const record = JSON.parse(decodeURIComponent(String(value || "")));
    return record && typeof record === "object" && !Array.isArray(record) ? record : null;
  } catch {
    return null;
  }
}

function publicRecord(record, object, origin) {
  const thumbnailKey = object.customMetadata?.thumbnailKey || "";
  return {
    ...record,
    image: `${origin}/media/${object.key}`,
    thumbnail: thumbnailKey ? `${origin}/media/${thumbnailKey}` : `${origin}/media/${object.key}`,
  };
}

async function listAllFullObjects(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: PHOTO_PREFIX, cursor, limit: 1000, include: ["customMetadata"] });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function findPhotoObject(bucket, photoId) {
  const objects = await listAllFullObjects(bucket);
  return objects.find((object) => decodeRecord(object.customMetadata?.record)?.id === photoId) || null;
}

async function verifyTurnstile(token, ip, env) {
  if (env.TURNSTILE_BYPASS === "1") return { success: true, hostname: "local" };
  if (!env.TURNSTILE_SECRET) throw new Error("Ověření uploadu není nakonfigurované.");
  if (!token) return { success: false };
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!response.ok) throw new Error("Ověření uploadu je dočasně nedostupné.");
  const result = await response.json();
  const hostnames = splitSetting(env.TURNSTILE_HOSTNAMES);
  if (result.success && hostnames.length && !hostnames.includes(result.hostname)) return { success: false };
  return result;
}

async function quotaCall(env, action, payload) {
  const objectId = env.QUOTAS.idFromName(QUOTA_OBJECT_NAME);
  const stub = env.QUOTAS.get(objectId);
  const response = await stub.fetch(`https://quota/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Limit uploadu byl vyčerpán.");
    error.status = response.status;
    error.code = result.code || "quota_exceeded";
    throw error;
  }
  return result;
}

async function handleList(request, env, origin) {
  const url = new URL(request.url);
  const objects = await listAllFullObjects(env.PHOTOS);
  const photos = objects
    .filter((object) => object.customMetadata?.status === "approved")
    .map((object) => ({ object, record: decodeRecord(object.customMetadata?.record) }))
    .filter((item) => item.record)
    .sort((left, right) => String(right.record.createdAt).localeCompare(String(left.record.createdAt)))
    .map((item) => publicRecord(item.record, item.object, url.origin));
  const response = jsonResponse({ photos, count: photos.length }, 200, origin, env);
  response.headers.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  return response;
}

async function handleMedia(request, env, key) {
  if (!key || (!key.startsWith(PHOTO_PREFIX) && !key.startsWith(THUMB_PREFIX))) return new Response("Not found", { status: 404 });
  const object = await env.PHOTOS.get(key, { onlyIf: request.headers });
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response("body" in object ? object.body : null, { status: object.body ? 200 : 304, headers });
}

async function handleUpload(request, env, origin) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength && declaredLength > LIMITS.requestBytes) {
    return errorResponse("Upload je příliš velký.", 413, origin, env, "request_too_large");
  }

  let metadata;
  try {
    metadata = parseMetadataHeader(request);
  } catch (error) {
    return errorResponse(error.message, 400, origin, env, "invalid_metadata");
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  let verification;
  try {
    verification = await verifyTurnstile(request.headers.get(TURNSTILE_HEADER), ip, env);
  } catch (error) {
    return errorResponse(error.message, 503, origin, env, "verification_unavailable");
  }
  if (!verification.success) return errorResponse("Ověření proti robotům se nepovedlo.", 403, origin, env, "verification_failed");

  let form;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Upload nemá platný formát.", 400, origin, env, "invalid_form");
  }
  const imageFile = form.get("image");
  const thumbnailFile = form.get("thumbnail");
  if (!imageFile || typeof imageFile.arrayBuffer !== "function" || !thumbnailFile || typeof thumbnailFile.arrayBuffer !== "function") {
    return errorResponse("Chybí fotografie nebo její náhled.", 400, origin, env, "missing_image");
  }
  if (imageFile.size + thumbnailFile.size > LIMITS.fullBytes + LIMITS.thumbnailBytes) {
    return errorResponse("Zpracované obrázky jsou příliš velké.", 413, origin, env, "images_too_large");
  }

  const [imageBytes, thumbnailBytes] = await Promise.all([
    imageFile.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    thumbnailFile.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
  ]);
  let imageInfo;
  let thumbnailInfo;
  try {
    imageInfo = validateImageBytes(imageBytes, imageFile.type, LIMITS.fullBytes, LIMITS.fullMaxEdge);
    thumbnailInfo = validateImageBytes(thumbnailBytes, thumbnailFile.type, LIMITS.thumbnailBytes, LIMITS.thumbnailMaxEdge);
  } catch (error) {
    return errorResponse(error.message, 400, origin, env, "invalid_image");
  }

  const totalBytes = imageBytes.byteLength + thumbnailBytes.byteLength;
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);
  const dayKey = dateKeyForPrague();
  let reservation;
  try {
    reservation = await quotaCall(env, "reserve", { bytes: totalBytes, ipHash, dayKey, now: Date.now() });
  } catch (error) {
    return errorResponse(error.message, error.status || 429, origin, env, error.code);
  }

  const id = `upload-${crypto.randomUUID()}`;
  const path = datePath(dayKey);
  const fullKey = `${PHOTO_PREFIX}${path}/${id}.${fileExtension(imageInfo.mime)}`;
  const thumbnailKey = `${THUMB_PREFIX}${path}/${id}.${fileExtension(thumbnailInfo.mime)}`;
  const createdAt = new Date().toISOString();
  const status = env.REQUIRE_APPROVAL === "false" ? "approved" : "pending";
  const record = {
    id,
    ...metadata,
    createdAt,
    updatedAt: createdAt,
    source: "public-upload",
  };

  try {
    await env.PHOTOS.put(thumbnailKey, thumbnailBytes, {
      httpMetadata: { contentType: thumbnailInfo.mime, cacheControl: "public, max-age=31536000, immutable" },
    });
    await env.PHOTOS.put(fullKey, imageBytes, {
      httpMetadata: { contentType: imageInfo.mime, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: {
        record: encodeRecord(record),
        status,
        thumbnailKey,
        width: String(imageInfo.width),
        height: String(imageInfo.height),
      },
    });
    await quotaCall(env, "commit", { reservationId: reservation.reservationId, now: Date.now() });
  } catch (error) {
    await Promise.allSettled([env.PHOTOS.delete(fullKey), env.PHOTOS.delete(thumbnailKey)]);
    await quotaCall(env, "release", { reservationId: reservation.reservationId, now: Date.now() }).catch(() => {});
    return errorResponse("Snímek se nepovedlo uložit. Zkus to prosím znovu.", 503, origin, env, "storage_failed");
  }

  const payload = {
    id,
    status,
    message: status === "pending" ? "Snímek je uložený a čeká na kontrolu." : "Snímek byl přidán do atlasu.",
  };
  if (status === "approved") {
    payload.photo = { ...record, image: `${new URL(request.url).origin}/media/${fullKey}`, thumbnail: `${new URL(request.url).origin}/media/${thumbnailKey}` };
  }
  return jsonResponse(payload, 201, origin, env);
}

function authorizedAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  return request.headers.get("Authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

async function handleAdminList(request, env) {
  if (!authorizedAdmin(request, env)) return new Response("Not found", { status: 404 });
  const statusFilter = new URL(request.url).searchParams.get("status") || "pending";
  const objects = await listAllFullObjects(env.PHOTOS);
  const photos = objects
    .filter((object) => statusFilter === "all" || object.customMetadata?.status === statusFilter)
    .map((object) => ({
      key: object.key,
      status: object.customMetadata?.status || "pending",
      bytes: object.size,
      record: decodeRecord(object.customMetadata?.record),
    }))
    .filter((item) => item.record);
  return jsonResponse({ photos, count: photos.length });
}

async function handleAdminApprove(request, env, photoId) {
  if (!authorizedAdmin(request, env)) return new Response("Not found", { status: 404 });
  const listed = await findPhotoObject(env.PHOTOS, photoId);
  if (!listed) return jsonResponse({ error: "Snímek nebyl nalezen." }, 404);
  const object = await env.PHOTOS.get(listed.key);
  if (!object) return jsonResponse({ error: "Snímek nebyl nalezen." }, 404);
  const customMetadata = { ...object.customMetadata, status: "approved" };
  await env.PHOTOS.put(listed.key, object.body, { httpMetadata: object.httpMetadata, customMetadata });
  return jsonResponse({ ok: true, id: photoId, status: "approved" });
}

async function handleAdminUpdate(request, env, photoId) {
  if (!authorizedAdmin(request, env)) return new Response("Not found", { status: 404 });
  const listed = await findPhotoObject(env.PHOTOS, photoId);
  if (!listed) return jsonResponse({ error: "Snímek nebyl nalezen." }, 404);
  const object = await env.PHOTOS.get(listed.key);
  if (!object) return jsonResponse({ error: "Snímek nebyl nalezen." }, 404);
  let patch;
  try {
    patch = await request.json();
  } catch {
    return jsonResponse({ error: "Oprava metadat nemá platný formát." }, 400);
  }
  let record;
  try {
    record = applyAdminRecordPatch(decodeRecord(object.customMetadata?.record), patch);
  } catch (error) {
    return jsonResponse({ error: error.message }, 400);
  }
  const customMetadata = { ...object.customMetadata, record: encodeRecord(record) };
  await env.PHOTOS.put(listed.key, object.body, { httpMetadata: object.httpMetadata, customMetadata });
  return jsonResponse({ ok: true, id: photoId, status: customMetadata.status || "pending", record });
}

async function handleAdminDelete(request, env, photoId) {
  if (!authorizedAdmin(request, env)) return new Response("Not found", { status: 404 });
  const listed = await findPhotoObject(env.PHOTOS, photoId);
  if (!listed) return jsonResponse({ error: "Snímek nebyl nalezen." }, 404);
  const thumbnailKey = listed.customMetadata?.thumbnailKey || "";
  const thumbnail = thumbnailKey ? await env.PHOTOS.head(thumbnailKey) : null;
  await Promise.all([env.PHOTOS.delete(listed.key), thumbnailKey ? env.PHOTOS.delete(thumbnailKey) : Promise.resolve()]);
  const record = decodeRecord(listed.customMetadata?.record);
  await quotaCall(env, "remove", {
    bytes: listed.size + (thumbnail?.size || 0),
    dayKey: record?.createdAt ? dateKeyForPrague(new Date(record.createdAt)) : "",
    now: Date.now(),
  });
  return jsonResponse({ ok: true, id: photoId });
}

export class UploadQuota {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const action = new URL(request.url).pathname.slice(1);
    const payload = await request.json();
    const now = Number(payload.now) || Date.now();
    const usage = (await this.storage.get("usage")) || {
      totalCount: 0,
      totalBytes: 0,
      dayKey: payload.dayKey || dateKeyForPrague(new Date(now)),
      dayCount: 0,
      dayBytes: 0,
      ipDaily: {},
      ipLastAt: {},
      reservations: {},
    };

    for (const [id, reservation] of Object.entries(usage.reservations || {})) {
      if (now - reservation.createdAt > RESERVATION_TTL_MS) delete usage.reservations[id];
    }
    if (payload.dayKey && usage.dayKey !== payload.dayKey) {
      usage.dayKey = payload.dayKey;
      usage.dayCount = 0;
      usage.dayBytes = 0;
      usage.ipDaily = {};
      usage.ipLastAt = {};
    }

    if (action === "reserve") {
      const bytes = Number(payload.bytes);
      const ipHash = String(payload.ipHash || "");
      if (!Number.isFinite(bytes) || bytes <= 0 || !ipHash || !payload.dayKey) {
        return jsonResponse({ error: "Neplatná rezervace limitu.", code: "invalid_reservation" }, 400);
      }
      const active = Object.values(usage.reservations || {});
      const reservedBytes = active.reduce((sum, item) => sum + item.bytes, 0);
      const reservedToday = active.filter((item) => item.dayKey === payload.dayKey);
      const reservedDayBytes = reservedToday.reduce((sum, item) => sum + item.bytes, 0);
      const reservedForIp = reservedToday.filter((item) => item.ipHash === ipHash).length;
      const lastAt = Number(usage.ipLastAt[ipHash] || 0);
      if (lastAt && now - lastAt < LIMITS.cooldownMs) {
        return jsonResponse({ error: "Mezi dvěma uploady je potřeba minutu počkat.", code: "cooldown" }, 429);
      }
      if ((usage.ipDaily[ipHash] || 0) + reservedForIp >= LIMITS.perIpDailyCount) {
        return jsonResponse({ error: "Denní limit pro toto připojení je vyčerpaný.", code: "ip_daily_limit" }, 429);
      }
      if (usage.dayCount + reservedToday.length >= LIMITS.globalDailyCount
          || usage.dayBytes + reservedDayBytes + bytes > LIMITS.globalDailyBytes) {
        return jsonResponse({ error: "Dnešní společný limit uploadů je vyčerpaný.", code: "global_daily_limit" }, 429);
      }
      if (usage.totalCount + active.length >= LIMITS.totalCount
          || usage.totalBytes + reservedBytes + bytes > LIMITS.totalBytes) {
        return jsonResponse({ error: "Úložiště atlasu dosáhlo celkového limitu.", code: "total_limit" }, 507);
      }
      const reservationId = crypto.randomUUID();
      usage.reservations[reservationId] = { bytes, ipHash, dayKey: payload.dayKey, createdAt: now };
      usage.ipLastAt[ipHash] = now;
      await this.storage.put("usage", usage);
      return jsonResponse({ reservationId });
    }

    const reservationId = String(payload.reservationId || "");
    const reservation = usage.reservations?.[reservationId];
    if (action === "commit") {
      if (!reservation) return jsonResponse({ error: "Rezervace uploadu vypršela.", code: "reservation_expired" }, 409);
      usage.totalCount += 1;
      usage.totalBytes += reservation.bytes;
      if (usage.dayKey === reservation.dayKey) {
        usage.dayCount += 1;
        usage.dayBytes += reservation.bytes;
        usage.ipDaily[reservation.ipHash] = (usage.ipDaily[reservation.ipHash] || 0) + 1;
      }
      delete usage.reservations[reservationId];
      await this.storage.put("usage", usage);
      return jsonResponse({ ok: true });
    }
    if (action === "release") {
      if (reservation) delete usage.reservations[reservationId];
      await this.storage.put("usage", usage);
      return jsonResponse({ ok: true });
    }
    if (action === "remove") {
      usage.totalCount = Math.max(0, usage.totalCount - 1);
      usage.totalBytes = Math.max(0, usage.totalBytes - Math.max(0, Number(payload.bytes) || 0));
      if (payload.dayKey && payload.dayKey === usage.dayKey) {
        usage.dayCount = Math.max(0, usage.dayCount - 1);
        usage.dayBytes = Math.max(0, usage.dayBytes - Math.max(0, Number(payload.bytes) || 0));
      }
      await this.storage.put("usage", usage);
      return jsonResponse({ ok: true });
    }
    if (action === "status") return jsonResponse({ usage, limits: LIMITS });
    return jsonResponse({ error: "Neznámá operace." }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigins(env).has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }
    if (request.method === "GET" && url.pathname === "/v1/photos") return handleList(request, env, origin);
    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      return handleMedia(request, env, decodeURIComponent(url.pathname.slice("/media/".length)));
    }
    if (request.method === "POST" && url.pathname === "/v1/photos") {
      const publicOrigin = requirePublicOrigin(request, env);
      if (!publicOrigin) return errorResponse("Tento zdroj uploadu není povolený.", 403, origin, env, "origin_denied");
      return handleUpload(request, env, publicOrigin);
    }
    if (request.method === "GET" && url.pathname === "/v1/admin/photos") return handleAdminList(request, env);
    const approveMatch = url.pathname.match(/^\/v1\/admin\/photos\/([^/]+)\/approve$/);
    if (request.method === "POST" && approveMatch) return handleAdminApprove(request, env, decodeURIComponent(approveMatch[1]));
    const updateMatch = url.pathname.match(/^\/v1\/admin\/photos\/([^/]+)$/);
    if (request.method === "PATCH" && updateMatch) return handleAdminUpdate(request, env, decodeURIComponent(updateMatch[1]));
    const deleteMatch = url.pathname.match(/^\/v1\/admin\/photos\/([^/]+)$/);
    if (request.method === "DELETE" && deleteMatch) return handleAdminDelete(request, env, decodeURIComponent(deleteMatch[1]));
    return new Response("Not found", { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
  },
};
