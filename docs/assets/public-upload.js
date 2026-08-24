(function initializePublicUploadModule() {
  "use strict";

  const config = window.ATLAS_UPLOAD_CONFIG;
  const apiBase = String(config?.apiBase || "").replace(/\/+$/, "");
  const turnstileSiteKey = String(config?.turnstileSiteKey || "");
  const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  const MAX_FULL_BYTES = 4 * 1024 * 1024;
  const MAX_THUMBNAIL_BYTES = 512 * 1024;
  const FULL_MAX_EDGE = 4096;
  const THUMBNAIL_MAX_EDGE = 900;

  async function loadObjects() {
    if (!apiBase) return [];
    try {
      const response = await fetch(`${apiBase}/v1/photos`, {
        headers: { Accept: "application/json" },
        mode: "cors",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return Array.isArray(payload?.photos) ? payload.photos : [];
    } catch (error) {
      console.warn("Veřejné uploady se nepovedlo načíst.", error);
      return [];
    }
  }

  window.AtlasPublicUpload = Object.freeze({ loadObjects });
  if (!apiBase || !turnstileSiteKey) return;

  const elements = {
    openButton: document.querySelector("#uploadButton"),
    dialog: document.querySelector("#publicUploadDialog"),
    form: document.querySelector("#publicUploadForm"),
    close: document.querySelector("#publicUploadClose"),
    cancel: document.querySelector("#publicUploadCancel"),
    submit: document.querySelector("#publicUploadSubmit"),
    file: document.querySelector("#publicUploadFile"),
    previewWrap: document.querySelector("#publicUploadPreviewWrap"),
    preview: document.querySelector("#publicUploadPreview"),
    previewName: document.querySelector("#publicUploadPreviewName"),
    previewInfo: document.querySelector("#publicUploadPreviewInfo"),
    status: document.querySelector("#publicUploadStatus"),
    catalogTarget: document.querySelector("#publicUploadCatalogTarget"),
    constellationOptions: document.querySelector("#publicUploadConstellationOptions"),
    withoutCoordinates: document.querySelector("#publicUploadWithoutCoordinates"),
    ra: document.querySelector("#publicUploadRa"),
    dec: document.querySelector("#publicUploadDec"),
    turnstile: document.querySelector("#publicUploadTurnstile"),
    title: document.querySelector("#publicUploadTitleInput"),
    objectId: document.querySelector("#publicUploadObjectId"),
    commonName: document.querySelector("#publicUploadCommonName"),
    type: document.querySelector("#publicUploadType"),
    constellation: document.querySelector("#publicUploadConstellation"),
    date: document.querySelector("#publicUploadDate"),
    equipment: document.querySelector("#publicUploadEquipment"),
    exposure: document.querySelector("#publicUploadExposure"),
    location: document.querySelector("#publicUploadLocation"),
    notes: document.querySelector("#publicUploadNotes"),
  };
  if (Object.values(elements).some((element) => !element)) return;

  const state = {
    catalog: [],
    constellations: new Map(),
    processed: null,
    previewUrl: "",
    turnstileId: null,
    turnstileToken: "",
    turnstilePromise: null,
    submitting: false,
    completed: false,
  };

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
    return `${(bytes / (1024 * 1024)).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} MB`;
  }

  function setStatus(message, kind = "") {
    elements.status.textContent = message;
    elements.status.className = `public-upload-status${kind ? ` is-${kind}` : ""}`;
  }

  function setSubmitting(active) {
    state.submitting = active;
    elements.submit.disabled = active;
    elements.cancel.disabled = active;
    elements.close.disabled = active;
    elements.submit.textContent = active ? "Odesílám…" : "Odeslat";
  }

  function revokePreview() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
  }

  function resetImage() {
    revokePreview();
    state.processed = null;
    elements.preview.removeAttribute("src");
    elements.previewWrap.hidden = true;
    elements.previewName.textContent = "";
    elements.previewInfo.textContent = "";
  }

  function resetTurnstile() {
    state.turnstileToken = "";
    if (state.turnstileId !== null && window.turnstile) window.turnstile.reset(state.turnstileId);
  }

  function closeDialog() {
    if (state.submitting) return;
    elements.dialog.close();
  }

  function resetCompletedForm() {
    if (!state.completed) return;
    elements.form.reset();
    state.completed = false;
    elements.submit.disabled = false;
    elements.submit.textContent = "Odeslat";
    resetImage();
    syncCoordinateState();
  }

  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (state.turnstilePromise) return state.turnstilePromise;
    state.turnstilePromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-atlas-turnstile]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.turnstile), { once: true });
        existing.addEventListener("error", () => reject(new Error("Ověření se nepovedlo načíst.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.atlasTurnstile = "";
      script.addEventListener("load", () => resolve(window.turnstile), { once: true });
      script.addEventListener("error", () => reject(new Error("Ověření se nepovedlo načíst.")), { once: true });
      document.head.append(script);
    });
    return state.turnstilePromise;
  }

  async function prepareTurnstile() {
    try {
      const turnstile = await loadTurnstileScript();
      if (!turnstile || state.turnstileId !== null) return;
      state.turnstileId = turnstile.render(elements.turnstile, {
        sitekey: turnstileSiteKey,
        theme: "dark",
        size: "flexible",
        callback(token) {
          state.turnstileToken = token;
          if (elements.status.classList.contains("is-error")) setStatus("");
        },
        "expired-callback"() {
          state.turnstileToken = "";
        },
        "error-callback"() {
          state.turnstileToken = "";
          setStatus("Ověření proti robotům se nepovedlo.", "error");
        },
      });
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  async function loadCatalogOptions() {
    try {
      const [catalogResponse, constellationsResponse] = await Promise.all([
        fetch("data/catalog.json"),
        fetch("data/constellations.json"),
      ]);
      if (!catalogResponse.ok || !constellationsResponse.ok) return;
      const catalog = await catalogResponse.json();
      const constellations = await constellationsResponse.json();
      state.catalog = Array.isArray(catalog.targets) ? catalog.targets : [];
      state.constellations = new Map((constellations.constellations || []).map((item) => [item.abbreviation, item.latinName]));
      const fragment = document.createDocumentFragment();
      for (const target of [...state.catalog].sort((left, right) => String(left.displayName).localeCompare(String(right.displayName), "cs"))) {
        const option = document.createElement("option");
        option.value = target.targetId;
        option.textContent = target.displayName === target.targetId
          ? target.targetId
          : `${target.displayName} · ${target.targetId}`;
        fragment.append(option);
      }
      elements.catalogTarget.append(fragment);
      elements.constellationOptions.innerHTML = [...state.constellations.values()]
        .sort((left, right) => left.localeCompare(right, "cs"))
        .map((name) => `<option value="${name.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></option>`)
        .join("");
    } catch (error) {
      console.warn("Katalog pro upload se nepovedlo načíst.", error);
    }
  }

  function targetObjectId(target) {
    const values = [
      target.catalogs?.messier,
      target.catalogs?.caldwell,
      target.catalogs?.ngc?.[0],
      target.catalogs?.ic?.[0],
      target.targetId,
    ].filter(Boolean);
    return [...new Set(values)].join(" / ");
  }

  function applyCatalogTarget() {
    const target = state.catalog.find((item) => item.targetId === elements.catalogTarget.value);
    if (!target) return;
    elements.title.value = target.displayName || target.targetId;
    elements.objectId.value = targetObjectId(target);
    elements.commonName.value = target.names?.curated || target.names?.common?.[0] || "";
    elements.type.value = target.objectType?.label || "";
    elements.constellation.value = state.constellations.get(target.constellation) || target.constellation || "";
    elements.ra.value = (Number(target.coordinates?.raDeg) / 15).toFixed(6);
    elements.dec.value = Number(target.coordinates?.decDeg).toFixed(6);
    elements.withoutCoordinates.checked = false;
    syncCoordinateState();
  }

  function syncCoordinateState() {
    const disabled = elements.withoutCoordinates.checked;
    for (const input of [elements.ra, elements.dec]) {
      input.disabled = disabled;
      input.required = !disabled;
    }
  }

  function decodeImage(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file, { imageOrientation: "from-image" });
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.addEventListener("load", () => {
        URL.revokeObjectURL(url);
        resolve(image);
      }, { once: true });
      image.addEventListener("error", () => {
        URL.revokeObjectURL(url);
        reject(new Error("Fotografii se nepovedlo otevřít."));
      }, { once: true });
      image.src = url;
    });
  }

  function dimensionsFor(source, maximumEdge) {
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    const scale = Math.min(1, maximumEdge / Math.max(sourceWidth, sourceHeight));
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    };
  }

  function renderBlob(source, maximumEdge, quality) {
    const { width, height } = dimensionsFor(source, maximumEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((webpBlob) => {
        if (webpBlob?.type === "image/webp") {
          resolve({ blob: webpBlob, width, height });
          return;
        }
        canvas.toBlob((jpegBlob) => {
          if (jpegBlob) resolve({ blob: jpegBlob, width, height });
          else reject(new Error("Fotografii se nepovedlo připravit."));
        }, "image/jpeg", quality);
      }, "image/webp", quality);
    });
  }

  async function renderWithinLimit(source, variants, maximumBytes) {
    let lastResult = null;
    for (const variant of variants) {
      lastResult = await renderBlob(source, variant.edge, variant.quality);
      if (lastResult.blob.size <= maximumBytes) return lastResult;
    }
    throw new Error(`Výsledný obrázek je stále větší než ${formatBytes(maximumBytes)}.`);
  }

  async function processFile(file) {
    if (!file) return;
    resetImage();
    setStatus("Připravuji fotografii…");
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error("Podporované jsou pouze JPEG, PNG a WebP.");
    }
    if (file.size > MAX_SOURCE_BYTES) throw new Error("Zdrojová fotografie překračuje 8 MB.");
    const source = await decodeImage(file);
    try {
      const full = await renderWithinLimit(source, [
        { edge: FULL_MAX_EDGE, quality: 0.9 },
        { edge: FULL_MAX_EDGE, quality: 0.84 },
        { edge: 3600, quality: 0.84 },
        { edge: 3200, quality: 0.8 },
      ], MAX_FULL_BYTES);
      const thumbnail = await renderWithinLimit(source, [
        { edge: THUMBNAIL_MAX_EDGE, quality: 0.82 },
        { edge: THUMBNAIL_MAX_EDGE, quality: 0.72 },
      ], MAX_THUMBNAIL_BYTES);
      state.processed = { file, full, thumbnail };
      state.previewUrl = URL.createObjectURL(full.blob);
      elements.preview.src = state.previewUrl;
      elements.previewName.textContent = file.name;
      elements.previewInfo.textContent = `${full.width} × ${full.height} px · ${formatBytes(full.blob.size)}`;
      elements.previewWrap.hidden = false;
      setStatus("Fotografie je připravená.", "success");
    } finally {
      if (typeof source.close === "function") source.close();
    }
  }

  function readMetadata() {
    return {
      catalogTargetId: elements.catalogTarget.value,
      title: elements.title.value.trim(),
      objectId: elements.objectId.value.trim(),
      commonName: elements.commonName.value.trim(),
      type: elements.type.value.trim(),
      constellation: elements.constellation.value.trim(),
      raHours: elements.withoutCoordinates.checked ? null : Number(elements.ra.value),
      decDeg: elements.withoutCoordinates.checked ? null : Number(elements.dec.value),
      withoutCoordinates: elements.withoutCoordinates.checked,
      date: elements.date.value,
      equipment: elements.equipment.value.trim(),
      exposure: elements.exposure.value.trim(),
      location: elements.location.value.trim(),
      notes: elements.notes.value.trim(),
    };
  }

  function blobName(baseName, blob, suffix) {
    const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    const stem = String(baseName || "photo").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "photo";
    return `${stem}-${suffix}.${extension}`;
  }

  async function submitUpload(event) {
    event.preventDefault();
    if (state.submitting) return;
    if (!state.processed) {
      setStatus("Nejprve vyber fotografii.", "error");
      elements.file.focus();
      return;
    }
    if (!state.turnstileToken) {
      setStatus("Dokonči prosím ověření proti robotům.", "error");
      return;
    }
    setSubmitting(true);
    setStatus("Nahrávám fotografii…");
    try {
      const metadata = readMetadata();
      const body = new FormData();
      body.set("image", state.processed.full.blob, blobName(state.processed.file.name, state.processed.full.blob, "full"));
      body.set("thumbnail", state.processed.thumbnail.blob, blobName(state.processed.file.name, state.processed.thumbnail.blob, "thumb"));
      const response = await fetch(`${apiBase}/v1/photos`, {
        method: "POST",
        mode: "cors",
        headers: {
          "X-Atlas-Metadata": encodeURIComponent(JSON.stringify(metadata)),
          "X-Turnstile-Token": state.turnstileToken,
        },
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Upload se nepovedl.");
      setStatus(payload.message || "Snímek byl přijat.", "success");
      elements.submit.textContent = "Zavřít";
      elements.submit.disabled = false;
      elements.cancel.disabled = false;
      elements.close.disabled = false;
      state.submitting = false;
      state.completed = true;
      if (payload.status === "approved") {
        setTimeout(() => window.location.reload(), 900);
      }
    } catch (error) {
      setStatus(error.message || "Upload se nepovedl.", "error");
      resetTurnstile();
      setSubmitting(false);
    }
  }

  elements.openButton.addEventListener("click", () => {
    resetCompletedForm();
    setStatus("");
    elements.dialog.showModal();
    prepareTurnstile();
    elements.file.focus();
  });
  elements.close.addEventListener("click", closeDialog);
  elements.cancel.addEventListener("click", closeDialog);
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) closeDialog();
  });
  elements.file.addEventListener("change", async () => {
    try {
      await processFile(elements.file.files?.[0]);
    } catch (error) {
      resetImage();
      setStatus(error.message, "error");
      elements.file.value = "";
    }
  });
  elements.catalogTarget.addEventListener("change", applyCatalogTarget);
  elements.withoutCoordinates.addEventListener("change", syncCoordinateState);
  elements.submit.addEventListener("click", (event) => {
    if (!state.completed) return;
    event.preventDefault();
    closeDialog();
  });
  elements.form.addEventListener("submit", submitUpload);
  elements.dialog.addEventListener("close", () => {
    if (!state.submitting) resetTurnstile();
  });

  syncCoordinateState();
  loadCatalogOptions();
}());
