(() => {
  const FORM_SELECTOR = "#itemForm, #scanForm";
  const FIELD_SELECTOR = ".ges-location-field[data-ges-location-key]";
  const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "codabar", "itf", "qr_code", "data_matrix"];
  let refreshTimer = null;

  function localNormalizeBase(value) {
    let raw = String(value || "").trim();
    if (/^\][A-Za-z][0-9]/.test(raw)) raw = raw.slice(3);
    raw = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!raw) return "";

    const compact = raw.toUpperCase().replace(/[‐‑‒–—−_\s]+/g, "-");
    let match = compact.match(/^([A-Z]{1,4})-?(\d{1,6})$/);
    if (match) return `${match[1]}-${match[2]}`;
    match = compact.match(/^(\d{2})-?(\d{3})$/);
    if (match) return `${match[1]}-${match[2]}`;
    return raw;
  }

  function normalizeBase(value) {
    return window.restockLocationCodes?.normalizeLocationCode?.(value) || localNormalizeBase(value);
  }

  function normalizeGesValue(value, key) {
    let raw = String(value || "").trim();
    if (!raw) return "";

    if (key === "gesPlusLocations") raw = raw.replace(/\+$/i, "");
    if (key === "gesPalletLocations") raw = raw.replace(/OV$/i, "");

    const base = normalizeBase(raw).toUpperCase();
    if (!base) return "";
    if (key === "gesPlusLocations") return `${base}+`;
    if (key === "gesPalletLocations") return `${base}OV`;
    return base;
  }

  function prepareDraft(field) {
    const input = field?.querySelector(".ges-location-input");
    if (!input) return;
    const normalized = normalizeGesValue(input.value, field.dataset.gesLocationKey);
    if (normalized) input.value = normalized;
  }

  async function scanIntoField(fileInput) {
    const file = fileInput.files?.[0];
    const field = fileInput.closest(FIELD_SELECTOR);
    const draft = field?.querySelector(".ges-location-input");
    const add = field?.querySelector(".ges-location-add");
    if (!file || !field || !draft || !add) return;

    try {
      if (!("BarcodeDetector" in window)) throw new Error("unsupported");
      const detector = new BarcodeDetector({ formats: SCAN_FORMATS });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      const raw = String(codes[0]?.rawValue || "").trim();
      if (!raw) throw new Error("not-found");

      draft.value = normalizeGesValue(raw, field.dataset.gesLocationKey);
      draft.dispatchEvent(new Event("input", { bubbles: true }));
      add.click();
    } catch {
      draft.focus({ preventScroll: true });
    } finally {
      fileInput.value = "";
    }
  }

  function enhanceGesField(field) {
    if (field.dataset.gesConventionReady === "true") return;
    field.dataset.gesConventionReady = "true";

    const key = field.dataset.gesLocationKey;
    const input = field.querySelector(".ges-location-input");
    if (!input) return;

    input.placeholder = key === "gesPalletLocations"
      ? "Ex. 17-003 → 17-003OV"
      : "Ex. 17-003 → 17-003+";

    const scanId = `gesLocationScan-${key}-${crypto.randomUUID()}`;
    const row = document.createElement("div");
    row.className = "ges-location-scan-row";
    row.innerHTML = `
      <label class="button compact secondary ges-location-scan-button" for="${scanId}">▣ Scanner la section</label>
      <input id="${scanId}" class="ges-location-scan-input" type="file" accept="image/*" capture="environment" hidden>
      <span class="field-hint">Le suffixe est ajouté automatiquement.</span>
    `;

    const entry = field.querySelector(".ges-location-entry");
    entry?.insertAdjacentElement("afterend", row);
    row.querySelector(".ges-location-scan-input")?.addEventListener("change", event => scanIntoField(event.currentTarget));
  }

  function enhancePickupPhoto(form) {
    const photo = form.querySelector(".stock-photo-field");
    if (photo && photo.dataset.pickupPhotoReady !== "true") {
      photo.dataset.pickupPhotoReady = "true";
      const title = photo.querySelector(".field-title");
      const hint = photo.querySelector("p.field-hint");
      if (title) title.textContent = "Photo du lieu de ramassage";
      if (hint) hint.textContent = "Ajoute ou remplace une photo pour aider à retrouver le produit. Elle pourra être modifiée plus tard avec l’article.";
    }

    const stock = form.querySelector('input[name="stockLocation"]');
    if (stock && stock.dataset.pickupLocationReady !== "true") {
      stock.dataset.pickupLocationReady = "true";
      stock.placeholder = "Ex. 17-003";
      const host = stock.closest(".location-barcode-field");
      const hint = host?.querySelector(".field-hint");
      if (hint) hint.textContent = "Ex. 17-003. Tu peux scanner la section maintenant et modifier ce lieu plus tard.";
    }
  }

  function enhanceVisibleContent() {
    document.querySelectorAll(FIELD_SELECTOR).forEach(enhanceGesField);
    document.querySelectorAll(FORM_SELECTOR).forEach(enhancePickupPhoto);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceVisibleContent, 0);
  }

  document.addEventListener("click", event => {
    const add = event.target.closest?.(".ges-location-add");
    if (add) prepareDraft(add.closest(FIELD_SELECTOR));
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const input = event.target.closest?.(".ges-location-input");
    if (input) prepareDraft(input.closest(FIELD_SELECTOR));
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) new MutationObserver(scheduleRefresh).observe(appMain, { childList: true, subtree: true });
    enhanceVisibleContent();
  });
})();