(() => {
  const FORM_SELECTOR = "#itemForm, #scanForm";
  const FIELD_SELECTOR = ".ges-location-field[data-ges-location-key]";
  const LOCATION_FIELD_SELECTOR = ".location-barcode-field";
  const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "codabar", "itf", "qr_code", "data_matrix"];
  const CAMERA_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8.5 6 10 4h4l1.5 2H19a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 19 19H5a2.5 2.5 0 0 1-2.5-2.5v-8A2.5 2.5 0 0 1 5 6h3.5Z"/>
        <circle cx="12" cy="12.5" r="3.5"/>
      </g>
    </svg>`;
  const GALLERY_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2.5"/>
        <circle cx="8.5" cy="9" r="1.5"/>
        <path d="m5.5 17 4.2-4.2 2.8 2.8 2.2-2.2 3.8 3.6"/>
      </g>
    </svg>`;
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
    raw = raw.replace(/(?:OV|\+)$/i, "");

    const base = normalizeBase(raw).toUpperCase();
    if (!base) return "";
    if (key === "gesPlusLocations") return `${base}+`;
    if (key === "gesPalletLocations") return `${base}OV`;
    return base;
  }

  function mediaButton(kind, fileInput, ariaLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `location-camera-button location-${kind}-button`;
    button.setAttribute("aria-label", ariaLabel);
    button.title = ariaLabel;
    button.innerHTML = kind === "camera" ? CAMERA_ICON : GALLERY_ICON;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      fileInput.value = "";
      fileInput.click();
    });
    return button;
  }

  function ensureMediaActions(control, cameraInput, galleryInput, cameraLabel, galleryLabel) {
    let actions = control.querySelector(":scope > .location-media-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "location-media-actions";
      control.append(actions);
    }

    const cameraButton = actions.querySelector(".location-camera-button.location-camera-button:not(.location-gallery-button)");
    const galleryButton = actions.querySelector(".location-gallery-button");
    if (!cameraButton || !galleryButton || actions.children.length !== 2) {
      actions.replaceChildren(
        mediaButton("camera", cameraInput, cameraLabel),
        mediaButton("gallery", galleryInput, galleryLabel)
      );
    }
    return actions;
  }

  function ensureInlineControl(input) {
    let control = input.closest(".location-inline-control");
    if (control) return control;
    control = document.createElement("div");
    control.className = "location-inline-control";
    input.before(control);
    control.append(input);
    return control;
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

  function ensureGesFileInput(field, kind) {
    const gallery = kind === "gallery";
    let input = field.querySelector(
      gallery
        ? '.ges-location-scan-input[data-ges-media="gallery"], .ges-location-gallery-input'
        : '.ges-location-scan-input[data-ges-media="camera"]:not(.ges-location-gallery-input), .ges-location-scan-input:not(.ges-location-gallery-input)'
    );

    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.hidden = true;
      input.className = gallery
        ? "ges-location-scan-input ges-location-gallery-input"
        : "ges-location-scan-input";
      field.append(input);
    }

    input.dataset.gesMedia = kind;
    input.accept = "image/*";
    input.hidden = true;
    if (gallery) input.removeAttribute("capture");
    else input.setAttribute("capture", "environment");

    if (input.dataset.gesScanReady !== "true") {
      input.dataset.gesScanReady = "true";
      input.addEventListener("change", event => scanIntoField(event.currentTarget));
    }
    return input;
  }

  function enhanceStandardLocationField(host) {
    const textInput = host.querySelector('input[name="salesLocation"], input[name="stockLocation"]');
    let cameraInput = host.querySelector('.location-barcode-input:not(.location-gallery-input)');
    if (!textInput || !cameraInput) return;

    cameraInput.hidden = true;
    cameraInput.accept = "image/*";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.dataset.locationTarget = textInput.name;

    let galleryInput = host.querySelector(".location-gallery-input");
    if (!galleryInput) {
      galleryInput = document.createElement("input");
      galleryInput.className = "location-barcode-input location-gallery-input";
      galleryInput.type = "file";
      galleryInput.accept = "image/*";
      galleryInput.hidden = true;
      galleryInput.dataset.locationTarget = textInput.name;
      host.append(galleryInput);
    }
    galleryInput.removeAttribute("capture");
    galleryInput.dataset.locationTarget = textInput.name;

    const control = ensureInlineControl(textInput);
    const fieldLabel = textInput.name === "salesLocation" ? "l’emplacement en tablette" : "le lieu de ramassage";
    ensureMediaActions(
      control,
      cameraInput,
      galleryInput,
      `Photographier ${fieldLabel}`,
      `Choisir une photo de ${fieldLabel}`
    );

    host.querySelector(".button-row")?.remove();
    host.dataset.locationCameraReady = "true";
  }

  function enhanceGesField(field) {
    const key = field.dataset.gesLocationKey;
    const input = field.querySelector(".ges-location-input");
    const entry = field.querySelector(".ges-location-entry");
    if (!input || !entry) return;

    input.placeholder = key === "gesPalletLocations"
      ? "Ex. 17-003 → 17-003OV"
      : "Ex. 17-003 → 17-003+";

    const cameraInput = ensureGesFileInput(field, "camera");
    const galleryInput = ensureGesFileInput(field, "gallery");
    const control = ensureInlineControl(input);
    control.classList.add("ges-location-inline-control");

    const kind = key === "gesPalletLocations" ? "GES palette" : "GES+";
    ensureMediaActions(
      control,
      cameraInput,
      galleryInput,
      `Photographier la section pour ajouter un ${kind}`,
      `Choisir une photo de section pour ajouter un ${kind}`
    );

    let hint = field.querySelector(".ges-camera-hint");
    if (!hint) {
      hint = document.createElement("span");
      hint.className = "field-hint ges-camera-hint";
      entry.insertAdjacentElement("afterend", hint);
    }
    hint.textContent = "Caméra ou galerie : la section est lue et le suffixe est ajouté automatiquement.";
    field.dataset.gesConventionReady = "true";
  }

  function enhancePickupPhoto(form) {
    const photo = form.querySelector(".stock-photo-field");
    if (photo) {
      photo.dataset.pickupPhotoReady = "true";
      const title = photo.querySelector(".field-title");
      const hint = photo.querySelector("p.field-hint");
      if (title) title.textContent = "Photo du lieu de ramassage";
      if (hint) hint.textContent = "Ajoute ou remplace une photo pour aider à retrouver le produit. Elle pourra être modifiée plus tard avec l’article.";
    }

    const stock = form.querySelector('input[name="stockLocation"]');
    if (stock) {
      stock.dataset.pickupLocationReady = "true";
      stock.placeholder = "Ex. 17-003";
      const host = stock.closest(".location-barcode-field");
      const hint = host?.querySelector(".field-hint");
      if (hint) hint.textContent = "Ex. 17-003. Utilise la caméra ou la galerie pour lire la section; ce lieu reste modifiable plus tard.";
    }
  }

  function enhanceVisibleContent() {
    document.querySelectorAll(LOCATION_FIELD_SELECTOR).forEach(enhanceStandardLocationField);
    document.querySelectorAll(FIELD_SELECTOR).forEach(enhanceGesField);
    document.querySelectorAll(FORM_SELECTOR).forEach(enhancePickupPhoto);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceVisibleContent, 0);
  }

  window.restockEnhanceLocationMedia = enhanceVisibleContent;

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
    window.setInterval(() => {
      if (document.querySelector(FORM_SELECTOR)) enhanceVisibleContent();
    }, 650);
  });
})();
