(() => {
  const STORAGE_KEY = "restock_app_v1";
  const MODAL_ID = "hdScreenEntryModal";
  let currentResult = null;
  let currentPhoto = "";
  let analyzing = false;

  const PHONE_ICON = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2.5"></rect>
      <path d="M10 5h4M11 18h2"></path>
      <path d="M9 8h6v6H9z"></path>
    </svg>`;

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function normalizeSku(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return /^(?:1000|1001)\d{6}$/.test(digits) ? digits : "";
  }

  function formatSku(value) {
    const digits = normalizeSku(value);
    return digits ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : "";
  }

  function readSnapshot() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return parsed && Array.isArray(parsed.items) ? parsed : { items: [], departments: [] };
    } catch {
      return { items: [], departments: [] };
    }
  }

  function storedAccessToken() {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith("sb-") || !key.includes("auth-token")) continue;
        try {
          const parsed = JSON.parse(storage.getItem(key) || "null");
          const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
          if (token) return token;
        } catch { /* autre donnée */ }
      }
    }
    return "";
  }

  function installStyles() {
    if (document.querySelector("#hdScreenEntryStyles")) return;
    const style = document.createElement("style");
    style.id = "hdScreenEntryStyles";
    style.textContent = `
      .hd-screen-entry-tile .article-entry-tile-icon { background:rgba(249,99,2,.16); }
      .hd-screen-modal-backdrop { position:fixed; inset:0; z-index:1450; display:grid; place-items:center; padding:18px; background:rgba(35,28,24,.48); backdrop-filter:blur(3px); }
      .hd-screen-modal-backdrop[hidden] { display:none; }
      .hd-screen-modal { width:min(720px,100%); max-height:min(92dvh,900px); overflow:auto; border:1px solid var(--line); border-radius:22px; background:var(--surface); box-shadow:0 24px 80px rgba(35,28,24,.25); }
      .hd-screen-modal-head { position:sticky; top:0; z-index:2; display:flex; justify-content:space-between; gap:16px; align-items:flex-start; padding:18px 18px 15px; border-bottom:1px solid var(--line); background:var(--surface); }
      .hd-screen-modal-head h2 { margin:2px 0 4px; }
      .hd-screen-modal-close { width:40px; height:40px; flex:0 0 40px; border:1px solid var(--line); border-radius:12px; background:var(--surface); color:var(--text); font-size:24px; cursor:pointer; }
      .hd-screen-modal-body { padding:18px; }
      .hd-screen-source-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
      .hd-screen-source-actions .button { min-height:52px; }
      .hd-screen-preview { display:block; width:100%; max-height:330px; margin-top:14px; object-fit:contain; border:1px solid var(--line); border-radius:16px; background:var(--surface-2); }
      .hd-screen-progress { margin-top:14px; padding:14px; border-radius:14px; background:var(--surface-2); font-weight:750; }
      .hd-screen-result { display:grid; gap:13px; margin-top:15px; }
      .hd-screen-result-summary { padding:14px; border:1px solid var(--line); border-radius:16px; background:var(--surface-2); }
      .hd-screen-result-summary.existing { border-color:rgba(249,99,2,.48); background:rgba(249,99,2,.08); }
      .hd-screen-result-summary h3 { margin:0 0 5px; }
      .hd-screen-data-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
      .hd-screen-data { min-width:0; padding:11px 12px; border:1px solid var(--line); border-radius:13px; background:var(--surface); }
      .hd-screen-data small { display:block; margin-bottom:3px; color:var(--muted); font-weight:700; }
      .hd-screen-data strong { display:block; overflow-wrap:anywhere; }
      .hd-screen-result-actions { display:flex; flex-wrap:wrap; gap:9px; }
      .hd-screen-filled-banner { margin:0 0 14px; padding:13px 14px; border:1px solid rgba(249,99,2,.38); border-radius:14px; background:rgba(249,99,2,.08); }
      .hd-screen-filled-banner strong { display:block; margin-bottom:3px; }
      @media (max-width:600px) {
        .hd-screen-modal-backdrop { padding:0; align-items:end; }
        .hd-screen-modal { width:100%; max-height:94dvh; border-radius:22px 22px 0 0; }
        .hd-screen-data-grid { grid-template-columns:1fr; }
      }
    `;
    document.head.append(style);
  }

  function createModal() {
    if (document.querySelector(`#${MODAL_ID}`)) return;
    const backdrop = document.createElement("div");
    backdrop.id = MODAL_ID;
    backdrop.className = "hd-screen-modal-backdrop";
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section class="hd-screen-modal" role="dialog" aria-modal="true" aria-labelledby="hdScreenTitle">
        <div class="hd-screen-modal-head">
          <div><p class="eyebrow">AJOUT RAPIDE</p><h2 id="hdScreenTitle">Écran Home Depot</h2><p class="small muted">Photographie la fiche Article Lookup du terminal Zebra.</p></div>
          <button class="hd-screen-modal-close" type="button" data-hd-screen-close aria-label="Fermer">×</button>
        </div>
        <div class="hd-screen-modal-body">
          <div class="hd-screen-source-actions">
            <button class="button primary" type="button" data-hd-screen-camera>📷 Prendre une photo</button>
            <button class="button" type="button" data-hd-screen-gallery>🖼 Choisir une photo</button>
          </div>
          <input id="hdScreenCameraInput" type="file" accept="image/*" capture="environment" hidden>
          <input id="hdScreenGalleryInput" type="file" accept="image/*" hidden>
          <img class="hd-screen-preview" alt="Aperçu de l’écran Home Depot" hidden>
          <div class="hd-screen-progress" hidden></div>
          <div class="hd-screen-result" hidden></div>
        </div>
      </section>`;
    document.body.append(backdrop);

    backdrop.addEventListener("click", event => {
      if (event.target === backdrop || event.target.closest("[data-hd-screen-close]")) closeModal();
    });
    backdrop.querySelector("[data-hd-screen-camera]")?.addEventListener("click", () => {
      const input = backdrop.querySelector("#hdScreenCameraInput");
      input.value = "";
      input.click();
    });
    backdrop.querySelector("[data-hd-screen-gallery]")?.addEventListener("click", () => {
      const input = backdrop.querySelector("#hdScreenGalleryInput");
      input.value = "";
      input.click();
    });
    backdrop.querySelectorAll("#hdScreenCameraInput, #hdScreenGalleryInput").forEach(input => {
      input.addEventListener("change", () => {
        if (input.files?.[0]) prepareAndAnalyze(input.files[0]);
      });
    });
    backdrop.querySelector(".hd-screen-result")?.addEventListener("click", event => {
      if (event.target.closest("[data-hd-screen-use]")) useCurrentResult();
      if (event.target.closest("[data-hd-screen-retry]")) resetModalContent();
    });
  }

  function modal() {
    return document.querySelector(`#${MODAL_ID}`);
  }

  function openModal() {
    createModal();
    resetModalContent();
    modal().hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    const element = modal();
    if (element) element.hidden = true;
    document.body.style.overflow = "";
  }

  function resetModalContent() {
    currentResult = null;
    currentPhoto = "";
    analyzing = false;
    const root = modal();
    if (!root) return;
    const preview = root.querySelector(".hd-screen-preview");
    const progress = root.querySelector(".hd-screen-progress");
    const result = root.querySelector(".hd-screen-result");
    preview.hidden = true;
    preview.removeAttribute("src");
    progress.hidden = true;
    progress.textContent = "";
    result.hidden = true;
    result.innerHTML = "";
  }

  function compressImage(file, maxSize = 1600, quality = .82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          let output = canvas.toDataURL("image/jpeg", quality);
          if (output.length > 3_700_000) output = canvas.toDataURL("image/jpeg", .66);
          resolve(output);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function departments() {
    return (readSnapshot().departments || []).map(entry => String(entry?.name || "").trim()).filter(Boolean);
  }

  async function apiAnalyze(image) {
    const token = storedAccessToken();
    if (!token) throw new Error("Session introuvable");
    const response = await fetch("/api/analyze-hd-screen", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image, departments: departments() }),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Analyse de l’écran impossible");
    return data;
  }

  async function prepareAndAnalyze(file) {
    if (analyzing || !file?.type?.startsWith("image/")) return;
    const root = modal();
    if (!root) return;
    const preview = root.querySelector(".hd-screen-preview");
    const progress = root.querySelector(".hd-screen-progress");
    const result = root.querySelector(".hd-screen-result");
    analyzing = true;
    currentResult = null;
    result.hidden = true;
    progress.hidden = false;
    progress.textContent = "Préparation de la photo…";
    try {
      currentPhoto = await compressImage(file);
      preview.src = currentPhoto;
      preview.hidden = false;
      progress.textContent = "Lecture de l’écran Home Depot par l’IA…";
      currentResult = await apiAnalyze(currentPhoto);
      renderResult(currentResult);
      progress.hidden = true;
    } catch (error) {
      progress.hidden = false;
      progress.textContent = error.message || "Analyse impossible";
      currentResult = null;
    } finally {
      analyzing = false;
    }
  }

  function existingItemForSku(sku) {
    const digits = normalizeSku(sku);
    return digits ? (readSnapshot().items || []).find(item => normalizeSku(item?.sku) === digits) || null : null;
  }

  function valueCard(label, value) {
    return `<div class="hd-screen-data"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value || "—")}</strong></div>`;
  }

  function renderResult(result) {
    const root = modal();
    const host = root?.querySelector(".hd-screen-result");
    if (!host) return;
    const sku = formatSku(result?.sku);
    const existing = existingItemForSku(sku);
    const recognized = Boolean(result?.isHomeDepotScreen && sku);
    const confidence = Math.round((Number(result?.screenConfidence) || 0) * 100);

    host.hidden = false;
    host.innerHTML = `
      <div class="hd-screen-result-summary ${existing ? "existing" : ""}">
        <h3>${recognized ? (existing ? "Article existant détecté" : "Écran détecté") : "Résultat à vérifier"}</h3>
        <p class="small muted">${recognized
          ? `${existing ? "L’article sera ouvert en modification." : "Un nouvel article sera préparé."} Confiance écran : ${confidence} %.`
          : "Je n’ai pas pu confirmer un écran Article Lookup avec un SKU valide. Reprends la photo en cadrant mieux l’écran."}</p>
      </div>
      <div class="hd-screen-data-grid">
        ${valueCard("SKU", sku)}
        ${valueCard("Description", result?.productName)}
        ${valueCard("Model #", result?.modelNumber)}
        ${valueCard("UPC #", result?.upc)}
        ${valueCard("Prix", result?.price ? `$${result.price}` : "")}
        ${valueCard("On Hand", result?.onHand)}
        ${valueCard("Aisle - Bay", result?.aisleBay)}
        ${valueCard("OHM+", result?.ohmPlus)}
        ${valueCard("Overhead", result?.overhead)}
        ${valueCard("X-Merch", result?.xMerch)}
      </div>
      <div class="hd-screen-result-actions">
        <button class="button primary" type="button" data-hd-screen-use ${recognized ? "" : "disabled"}>${existing ? "Mettre à jour cet article" : "Préremplir le nouvel article"}</button>
        <button class="button" type="button" data-hd-screen-retry>Reprendre</button>
      </div>`;
  }

  function hiddenAction(action, view = "", id = "") {
    const main = document.querySelector("#appMain");
    if (!main) return false;
    const button = document.createElement("button");
    button.type = "button";
    button.hidden = true;
    button.dataset.action = action;
    if (view) button.dataset.view = view;
    if (id) button.dataset.id = id;
    main.append(button);
    button.click();
    button.remove();
    return true;
  }

  function waitForForm(timeout = 3500) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const form = document.querySelector("#itemForm, #scanForm");
        if (form) return resolve(form);
        if (Date.now() - started > timeout) return reject(new Error("Formulaire d’article introuvable"));
        window.setTimeout(check, 45);
      };
      check();
    });
  }

  function setField(form, name, value) {
    if (value === null || value === undefined || value === "") return;
    const field = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!field) return;
    field.value = String(value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setDepartment(form, departmentName) {
    if (!departmentName) return;
    const snapshot = readSnapshot();
    const department = (snapshot.departments || []).find(entry => String(entry?.name || "").localeCompare(departmentName, "fr-CA", { sensitivity: "base" }) === 0);
    if (department?.id) setField(form, "departmentId", department.id);
  }

  function normalizeGesBase(value) {
    let raw = String(value || "").trim().replace(/(?:OV|\+)$/i, "");
    return window.restockLocationCodes?.normalizeLocationCode?.(raw) || raw;
  }

  function addGesLocation(form, key, value) {
    const raw = normalizeGesBase(value);
    if (!raw) return false;
    const field = form.querySelector(`.ges-location-field[data-ges-location-key="${key}"]`);
    const input = field?.querySelector(".ges-location-input");
    const add = field?.querySelector(".ges-location-add");
    if (!input || !add) return false;
    input.value = raw;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    add.click();
    return true;
  }

  function systemNoteBlock(result) {
    const lines = ["[ÉCRAN HOME DEPOT]"];
    if (result.modelNumber) lines.push(`Model #: ${result.modelNumber}`);
    if (result.upc) lines.push(`UPC #: ${result.upc}`);
    if (result.price) lines.push(`Prix système: $${result.price}`);
    if (result.unit) lines.push(`Unité: ${result.unit}`);
    if (result.pack) lines.push(`Pack: ${result.pack}`);
    if (result.onHand) lines.push(`On Hand: ${result.onHand}`);
    if (result.xMerch) lines.push(`X-Merch: ${result.xMerch}`);
    if (result.active === true) lines.push("État système: Active");
    if (result.active === false) lines.push("État système: Inactive");
    lines.push(`Mis à jour depuis Article Lookup: ${new Intl.DateTimeFormat("fr-CA", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`);
    lines.push("[/ÉCRAN HOME DEPOT]");
    return lines.join("\n");
  }

  function mergeSystemNote(existingNote, result) {
    const cleanExisting = String(existingNote || "")
      .replace(/\n?\[ÉCRAN HOME DEPOT\][\s\S]*?\[\/ÉCRAN HOME DEPOT\]\n?/g, "\n")
      .trim();
    const block = systemNoteBlock(result);
    return cleanExisting ? `${cleanExisting}\n\n${block}` : block;
  }

  function insertFilledBanner(form, existing) {
    form.querySelector(".hd-screen-filled-banner")?.remove();
    const banner = document.createElement("div");
    banner.className = "hd-screen-filled-banner full";
    banner.innerHTML = `<strong>${existing ? "Mise à jour depuis l’écran Home Depot" : "Article prérempli depuis l’écran Home Depot"}</strong><span class="small muted">Vérifie les renseignements avant d’enregistrer. Les données système ont été ajoutées dans la note.</span>`;
    const grid = form.querySelector(":scope > .form-grid");
    if (grid) grid.prepend(banner);
    else form.prepend(banner);
  }

  async function fillForm(result, existing) {
    const form = await waitForForm();
    window.restockEnhanceLocationMedia?.();
    setField(form, "sku", formatSku(result.sku));
    setField(form, "name", result.productName);
    setField(form, "salesLocation", result.aisleBay);
    setDepartment(form, result.suggestedDepartment);

    const note = form.querySelector('[name="note"]');
    if (note) setField(form, "note", mergeSystemNote(note.value, result));

    let attempts = 0;
    const addLocations = () => {
      const plusDone = !result.ohmPlus || addGesLocation(form, "gesPlusLocations", result.ohmPlus);
      const palletDone = !result.overhead || addGesLocation(form, "gesPalletLocations", result.overhead);
      if ((!plusDone || !palletDone) && attempts++ < 20) return window.setTimeout(addLocations, 80);
      insertFilledBanner(form, existing);
      form.querySelector('[name="sku"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    addLocations();
  }

  async function useCurrentResult() {
    const result = currentResult;
    if (!result?.isHomeDepotScreen || !normalizeSku(result.sku)) return;
    const existing = existingItemForSku(result.sku);
    closeModal();
    try {
      if (existing?.id) hiddenAction("edit-item", "", existing.id);
      else hiddenAction("go", "manual");
      await fillForm(result, Boolean(existing));
    } catch (error) {
      const toast = document.querySelector("#toast");
      if (toast) {
        toast.textContent = error.message || "Impossible de préremplir l’article";
        toast.classList.add("show");
        window.setTimeout(() => toast.classList.remove("show"), 4000);
      }
    }
  }

  function createTile() {
    const tile = document.createElement("button");
    tile.className = "card article-entry-tile hd-screen-entry-tile";
    tile.type = "button";
    tile.dataset.hdScreenEntry = "true";
    tile.innerHTML = `
      <span class="article-entry-tile-icon">${PHONE_ICON}</span>
      <span>
        <h3>Écran Home Depot</h3>
        <p>Photographier Article Lookup sur le terminal Zebra pour récupérer automatiquement les données système et les emplacements.</p>
        <span class="article-entry-mode">Caméra ou galerie</span>
      </span>
      <span class="article-entry-arrow" aria-hidden="true">›</span>`;
    tile.addEventListener("click", openModal);
    return tile;
  }

  function enhanceEntryOptions() {
    const grid = document.querySelector("[data-article-entry-options] .article-entry-options-grid");
    if (!grid || grid.querySelector("[data-hd-screen-entry]")) return;
    grid.append(createTile());
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal() && !modal().hidden) closeModal();
  });

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    createModal();
    enhanceEntryOptions();
    const main = document.querySelector("#appMain");
    if (main) new MutationObserver(enhanceEntryOptions).observe(main, { childList: true, subtree: true });
  });
})();
