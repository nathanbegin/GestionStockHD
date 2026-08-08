(() => {
  const FORM_SELECTOR = "#itemForm, #scanForm";
  let refreshTimer = null;

  function gesCounts(wrapper) {
    const plus = wrapper.querySelector('[data-ges-location-key="gesPlusLocations"]');
    const pallets = wrapper.querySelector('[data-ges-location-key="gesPalletLocations"]');
    return {
      plus: plus?.querySelectorAll(".ges-location-tag").length || 0,
      pallets: pallets?.querySelectorAll(".ges-location-tag").length || 0
    };
  }

  function updateGesSummary(wrapper) {
    const summary = wrapper.querySelector("[data-location-ges-summary]");
    const badge = wrapper.querySelector("[data-location-ges-count]");
    if (!summary || !badge) return;
    const counts = gesCounts(wrapper);
    const total = counts.plus + counts.pallets;
    summary.textContent = total
      ? `GES+ ${counts.plus} · Palettes ${counts.pallets}`
      : "Aucun GES ajouté";
    badge.textContent = total ? String(total) : "";
    badge.hidden = total === 0;
  }

  function commitGesDrafts(wrapper) {
    wrapper.querySelectorAll(".location-ges-sheet .ges-location-field").forEach(field => {
      const input = field.querySelector(".ges-location-input");
      const add = field.querySelector(".ges-location-add");
      if (input?.value.trim()) add?.click();
    });
    updateGesSummary(wrapper);
  }

  function openGesSheet(wrapper) {
    const sheet = wrapper.querySelector(".location-ges-sheet");
    if (!sheet) return;
    sheet.hidden = false;
    document.body.classList.add("location-ges-sheet-open");
    window.setTimeout(() => {
      sheet.querySelector(".location-ges-sheet-close")?.focus({ preventScroll: true });
    }, 0);
  }

  function closeGesSheet(wrapper, { commit = true } = {}) {
    const sheet = wrapper.querySelector(".location-ges-sheet");
    if (!sheet || sheet.hidden) return;
    if (commit) commitGesDrafts(wrapper);
    sheet.hidden = true;
    document.body.classList.remove("location-ges-sheet-open");
    wrapper.querySelector(".location-ges-manage")?.focus({ preventScroll: true });
  }

  function combineLocationStep(form) {
    if (form.dataset.locationWizardCombined === "true") {
      const wrapper = form.querySelector(".location-wizard-combined");
      if (wrapper) updateGesSummary(wrapper);
      return;
    }

    const grid = form.querySelector(":scope > .form-grid");
    const salesInput = form.querySelector('input[name="salesLocation"]');
    const stockInput = form.querySelector('input[name="stockLocation"]');
    const salesPanel = salesInput?.closest(".location-barcode-field");
    const stockPanel = stockInput?.closest(".location-barcode-field");
    const gesFields = grid ? [...grid.querySelectorAll(":scope > .ges-location-field")] : [];
    if (!grid || !salesPanel || !stockPanel || gesFields.length < 2) return;

    const wrapper = document.createElement("div");
    wrapper.className = "location-wizard-combined";
    wrapper.innerHTML = `
      <div class="field-title location-combined-step-title">Emplacements</div>
      <div class="location-primary-fields" aria-label="Emplacements principaux"></div>
      <div class="location-ges-summary-card">
        <div class="location-ges-summary-text">
          <strong>GES facultatifs</strong>
          <span data-location-ges-summary>Aucun GES ajouté</span>
        </div>
        <button type="button" class="button secondary compact location-ges-manage">
          Gérer
          <span class="location-ges-count" data-location-ges-count hidden></span>
        </button>
      </div>
      <div class="location-ges-sheet" hidden>
        <button type="button" class="location-ges-sheet-backdrop" aria-label="Fermer les emplacements GES"></button>
        <section class="location-ges-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="locationGesSheetTitle">
          <div class="location-ges-sheet-header">
            <div>
              <p class="eyebrow">EMPLACEMENTS FACULTATIFS</p>
              <h3 id="locationGesSheetTitle">GES</h3>
            </div>
            <button type="button" class="location-ges-sheet-close" aria-label="Fermer">×</button>
          </div>
          <p class="small muted location-ges-sheet-help">Scanne la section : l’application ajoute automatiquement <strong>+</strong> pour GES+ ou <strong>OV</strong> pour une palette overhead.</p>
          <div class="location-ges-sheet-fields"></div>
          <button type="button" class="button primary wide location-ges-sheet-done">Terminé</button>
        </section>
      </div>
    `;

    grid.insertBefore(wrapper, salesPanel);
    const primaryFields = wrapper.querySelector(".location-primary-fields");
    primaryFields.append(salesPanel, stockPanel);

    const sheetFields = wrapper.querySelector(".location-ges-sheet-fields");
    gesFields.forEach(field => {
      field.hidden = false;
      field.removeAttribute("aria-hidden");
      field.classList.remove("article-wizard-step");
      delete field.dataset.wizardStep;
      sheetFields.append(field);
    });

    wrapper.querySelector(".location-ges-manage")?.addEventListener("click", () => openGesSheet(wrapper));
    wrapper.querySelector(".location-ges-sheet-close")?.addEventListener("click", () => closeGesSheet(wrapper));
    wrapper.querySelector(".location-ges-sheet-done")?.addEventListener("click", () => closeGesSheet(wrapper));
    wrapper.querySelector(".location-ges-sheet-backdrop")?.addEventListener("click", () => closeGesSheet(wrapper));

    form.addEventListener("click", event => {
      if (!event.target.closest(".article-wizard-next")) return;
      if (wrapper.hidden || wrapper.getAttribute("aria-hidden") === "true") return;
      commitGesDrafts(wrapper);
    }, true);

    const tagsObserver = new MutationObserver(() => updateGesSummary(wrapper));
    wrapper.querySelectorAll(".ges-location-tags").forEach(tags => {
      tagsObserver.observe(tags, { childList: true, subtree: true });
    });

    form.dataset.locationWizardCombined = "true";
    updateGesSummary(wrapper);
  }

  function enhanceVisibleForms() {
    document.querySelectorAll(FORM_SELECTOR).forEach(combineLocationStep);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceVisibleForms, 0);
  }

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const sheet = document.querySelector(".location-ges-sheet:not([hidden])");
    const wrapper = sheet?.closest(".location-wizard-combined");
    if (wrapper) closeGesSheet(wrapper);
  });

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) new MutationObserver(scheduleRefresh).observe(appMain, { childList: true, subtree: true });
    enhanceVisibleForms();
  });
})();
