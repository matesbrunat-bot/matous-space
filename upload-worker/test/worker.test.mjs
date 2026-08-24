import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAdminRecordPatch,
  LIMITS,
  UploadQuota,
  imageDimensions,
  validateImageBytes,
  validateMetadata,
} from "../src/index.js";

test("admin metadata patches preserve identity and validate editable fields", () => {
  const record = {
    id: "upload-1",
    title: "NGC 6503",
    objectId: "NGC5503",
    type: "galaxie",
    createdAt: "2026-08-24T06:41:47.372Z",
    updatedAt: "2026-08-24T06:41:47.372Z",
    source: "public-upload",
  };
  const updated = applyAdminRecordPatch(record, { objectId: "NGC 6503" }, "2026-08-24T07:00:00.000Z");
  assert.equal(updated.objectId, "NGC 6503");
  assert.equal(updated.id, record.id);
  assert.equal(updated.createdAt, record.createdAt);
  assert.equal(updated.source, record.source);
  assert.equal(updated.updatedAt, "2026-08-24T07:00:00.000Z");
  assert.throws(() => applyAdminRecordPatch(record, { id: "changed" }), /nelze administrativně upravit/);
  assert.throws(() => applyAdminRecordPatch(record, { objectId: "" }), /povinné/);
});

function pngBytes(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function webpVp8xBytes(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes.set([encodedWidth & 0xff, (encodedWidth >> 8) & 0xff, (encodedWidth >> 16) & 0xff], 24);
  bytes.set([encodedHeight & 0xff, (encodedHeight >> 8) & 0xff, (encodedHeight >> 16) & 0xff], 27);
  return bytes;
}

test("metadata are normalized to the atlas record format", () => {
  const record = validateMetadata({
    title: "M42",
    objectId: "M42 / NGC 1976",
    commonName: "Orion Nebula",
    type: "emisní mlhovina",
    constellation: "Orion",
    raHours: 5.588139,
    decDeg: -5.391111,
    date: "2026-08-21",
    equipment: "Dwarf 3",
    catalogTargetId: "NGC1976",
  });
  assert.equal(record.ra, "05h 35m 17.3s");
  assert.equal(record.dec, "−05° 23' 28\"");
  assert.equal(record.catalogTargetId, "NGC1976");
});

test("coordinates can only be omitted explicitly", () => {
  assert.throws(() => validateMetadata({ title: "X", objectId: "X", type: "hvězda" }), /RA/);
  const record = validateMetadata({
    title: "Měsíc",
    objectId: "Měsíc",
    type: "objekt Sluneční soustavy",
    withoutCoordinates: true,
  });
  assert.equal(record.ra, "");
  assert.equal(record.dec, "");
});

test("PNG and WebP dimensions are read from binary headers", () => {
  assert.deepEqual(imageDimensions(pngBytes(2400, 1600), "image/png"), { width: 2400, height: 1600 });
  assert.deepEqual(imageDimensions(webpVp8xBytes(4096, 2048), "image/webp"), { width: 4096, height: 2048 });
  assert.deepEqual(validateImageBytes(pngBytes(400, 300), "image/png", 1024, 900), {
    mime: "image/png",
    width: 400,
    height: 300,
  });
});

test("image validation rejects a mismatched MIME type and oversized dimensions", () => {
  assert.throws(() => validateImageBytes(pngBytes(400, 300), "image/jpeg", 1024, 900), /formátu/);
  assert.throws(() => validateImageBytes(pngBytes(901, 300), "image/png", 1024, 900), /rozměry/);
});

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return structuredClone(this.values.get(key));
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }
}

async function quotaRequest(quota, action, payload) {
  return quota.fetch(new Request(`https://quota/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

test("quota reservations are atomic, rate limited, and committed", async () => {
  const storage = new MemoryStorage();
  const quota = new UploadQuota({ storage });
  const base = { bytes: 500_000, ipHash: "ip-a", dayKey: "2026-08-21", now: 1_000_000 };
  const reserved = await quotaRequest(quota, "reserve", base);
  assert.equal(reserved.status, 200);
  const reservationId = (await reserved.json()).reservationId;

  const tooSoon = await quotaRequest(quota, "reserve", { ...base, now: base.now + LIMITS.cooldownMs - 1 });
  assert.equal(tooSoon.status, 429);
  assert.equal((await tooSoon.json()).code, "cooldown");

  const committed = await quotaRequest(quota, "commit", { reservationId, now: base.now + 1000 });
  assert.equal(committed.status, 200);
  const usage = storage.values.get("usage");
  assert.equal(usage.totalCount, 1);
  assert.equal(usage.totalBytes, base.bytes);
  assert.equal(usage.dayCount, 1);
  assert.equal(usage.ipDaily[base.ipHash], 1);
});

test("quota enforces per-IP daily count", async () => {
  const storage = new MemoryStorage();
  const quota = new UploadQuota({ storage });
  let now = 2_000_000;
  for (let index = 0; index < LIMITS.perIpDailyCount; index += 1) {
    const response = await quotaRequest(quota, "reserve", {
      bytes: 1000,
      ipHash: "ip-limit",
      dayKey: "2026-08-21",
      now,
    });
    assert.equal(response.status, 200);
    const { reservationId } = await response.json();
    await quotaRequest(quota, "commit", { reservationId, now: now + 1 });
    now += LIMITS.cooldownMs;
  }
  const blocked = await quotaRequest(quota, "reserve", {
    bytes: 1000,
    ipHash: "ip-limit",
    dayKey: "2026-08-21",
    now,
  });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "ip_daily_limit");
});
