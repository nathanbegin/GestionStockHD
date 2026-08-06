(() => {
  const FORM_IDS = new Set(["itemForm", "scanForm"]);
  const ENTRY_MODE_KEY = "restock_item_entry_mode_v1";
  const STORAGE_KEY = "restock_app_v1";
  const QUANTITY_VALIDATE_MARKER = "⁣​⁣‌⁣";
  const KEYBOARD_THRESHOLD = 120;
  const FIELD_TOP_GAP = 96;
  const FIELD_BOTTOM_GAP = 28;
  const ENTRY_MODES = new Set(["guided", "form"]);

  function currentEntryMode() {
    const stored = localStorage.getItem(ENTRY_MODE_KEY);
    return ENTRY_MODES.has(stored) ? stored : "guided";
  }

  function guidedModeEnabled() {
    return currentEntryMode() === "guided";
  }

  function saveEntryMode(mode) {
    const normalized = ENTRY_MODES.has(mode) ? mode : "guided";
    localStorage.setItem(ENTRY_MODE_KEY, normalized);
    return normalized;
  }

  function enhanceEntryModeSettings() {
    const grid = document.querySelector(".settings-grid");
    if (!grid || grid.querySelector("[data-entry-mode-settings]")) return;

    const mode = currentEntryMode();
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.entryModeSettings = "true";
    card.innerHTML = `
      <h2>Mode d’ajout des articles</h2>
      <p class="muted small">Choisis l’affichage utilisé lors de l’ajout ou de la modification d’un article. Cette préférence est enregistrée sur cet appareil.</p>
      <div class="manage-list">
        <label class="check-card">
          <span><input type="radio" name="entryModePreference" value="guided" ${mode === "guided" ? "checked" : ""}> <strong>Mode guidé</strong></span>
          <span class="field-hint">Une question à la fois avec les boutons Précédent et Suivant.</span>
        </label>
        <label class="check-card">
          <span><input type="radio" name="entryModePreference" value="form" ${mode === "form" ? "checked" : ""}> <strong>Mode formulaire</strong></span>
          <span class="field-hint">Tous les champs sont affichés dans un seul formulaire.</span>
        </label>
      </div>
      <p class="small muted" data-entry-mode-status aria-live="polite"></p>
    `;

    const status = card.querySelector("[data-entry-mode-status]");
    card.addEventListener("change", event => {
      const input = event.target.closest('input[name="entryModePreference"]');
      if (!input) return;
      const selected = saveEntryMode(input.value);
      status.textContent = selected === "guided"
        ? "Mode guidé activé pour les prochains articles."
        : "Mode formulaire activé pour les prochains articles.";
    });

    grid.append(card);
  }

  function moveGesFieldsToSalesLocation(form) {
    const salesInput = form.querySelector('[name="salesLocation"]');
    const salesPanel = salesInput?.closest("label");
    const grid = form.querySelector(":scope > .form-grid");
    if (!salesPanel || !grid) return;

    const fields = [...grid.querySelectorAll(":scope > .ges-location-field")];
    if (!fields.length) return;

    let group = salesPanel.querySelector(":scope > .ges-location-panel-group");
    if (!group) {
      group = document.createElement("div");
      group.className = "ges-location-panel-group";
      group.setAttribute("aria-label", "Emplacements GES facultatifs");
      salesPanel.append(group);
    }

    fields.forEach(field => {
      field.hidden = false;
      field.removeAttribute("aria-hidden");
      field.classList.remove("article-wizard-step");
      delete field.dataset.wizardStep;
      group.append(field);
    });

    if (form.dataset.gesPanelNextReady !== "true") {
      form.dataset.gesPanelNextReady = "true";
      form.addEventListener("click", event => {
        if (!event.target.closest(".article-wizard-next")) return;
        group.querySelectorAll(".ges-location-field").forEach(field => {
          const input = field.querySelector(".ges-location-input");
          const add = field.querySelector(".ges-location-add");
          if (input?.value.trim()) add?.click();
        });
      }, true);
    }
  }

  function stripQuantityValidationMarker(value) {
    return String(value || "").split(QUANTITY_VALIDATE_MARKER).join("");
  }

  function hasQuantityValidationMarker(value) {
    return String(value || "").includes(QUANTITY_VALIDATE_MARKER);
  }

  function clampQuantity(input, value) {
    const min = Number(input.min || 1);
    const max = Number(input.max || 999);
    const numeric = Number.isFinite(Number(value)) ? Number(value) : min;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  }

  function enhanceQuantityField(form) {
    const input = form.querySelector('input[name="quantity"]');
    const host = input?.closest("label");
    if (!input || !host || input.dataset.quantityControlsReady === "true") return;

    input.dataset.quantityControlsReady = "true";
    input.classList.add("quantity-stepper-input");
    input.setAttribute("aria-label", "Quantité à remplir");

    const note = form.querySelector('textarea[name="note"]');
    const initiallyFlagged = hasQuantityValidationMarker(note?.value);
    if (note) note.value = stripQuantityValidationMarker(note.value);

    const row = document.createElement("div");
    row.className = "quantity-stepper";
    input.before(row);
    row.append(input);

    const arrows = document.createElement("div");
    arrows.className = "quantity-stepper-arrows";
    arrows.setAttribute("aria-label", "Modifier la quantité sans ouvrir le clavier");
    arrows.innerHTML = `
      <button type="button" class="quantity-stepper-button" data-quantity-delta="1" aria-label="Augmenter la quantité">▲</button>
      <button type="button" class="quantity-stepper-button" data-quantity-delta="-1" aria-label="Diminuer la quantité">▼</button>
    `;
    row.append(arrows);

    const validationOption = document.createElement("div");
    validationOption.className = "quantity-validation-option";
    validationOption.innerHTML = `
      <input type="checkbox" class="quantity-validation-checkbox" aria-label="Marquer la quantité à valider" ${initiallyFlagged ? "checked" : ""}>
      <span><strong>Quantité à valider</strong><small>Ajoute un signalement visible sur l’article.</small></span>
    `;
    host.append(validationOption);

    const flagCheckbox = validationOption.querySelector(".quantity-validation-checkbox");

    arrows.addEventListener("click", event => {
      const button = event.target.closest("[data-quantity-delta]");
      if (!button) return;
      const delta = Number(button.dataset.quantityDelta || 0);
      input.value = String(clampQuantity(input, Number(input.value || input.min || 1) + delta));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    form.addEventListener("formdata", event => {
      const cleanNote = stripQuantityValidationMarker(note?.value || "");
      event.formData.set(
        "note",
        flagCheckbox.checked ? `${cleanNote}${QUANTITY_VALIDATE_MARKER}` : cleanNote
      );
    });
  }

  function flaggedItemIds() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return new Set((snapshot?.items || [])
        .filter(item => item?.id && hasQuantityValidationMarker(item.note))
        .map(item => String(item.id)));
    } catch {
      return new Set();
    }
  }

  function decorateQuantityValidationFlags() {
    const ids = flaggedItemIds();
    document.querySelectorAll("[data-quantity-validation-badge]").forEach(badge => {
      const card = badge.closest(".card");
      const idElement = card?.querySelector("[data-id]");
      if (!idElement || !ids.has(String(idElement.dataset.id || ""))) badge.remove();
    });

    ids.forEach(id => {
      const selector = `[data-id="${CSS.escape(id)}"]`;
      document.querySelectorAll(selector).forEach(element => {
        const card = element.closest(".item-card, .tour-card, .card");
        if (!card || card.querySelector("[data-quantity-validation-badge]")) return;
        const host = card.querySelector(".tags") || card.querySelector(".item-top") || card;
        const badge = document.createElement("span");
        badge.className = "tag quantity-validation-badge";
        badge.dataset.quantityValidationBadge = "true";
        badge.textContent = "⚑ Quantité à valider";
        host.append(badge);
      });
    });
  }

  function directText(element) {
    return [...element.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(Boolean)
      .join(" ");
  }

  function questionTitle(step, index) {
    const fieldTitle = step.querySelector(":scope > .field-title, :scope > span > .field-title");
    if (fieldTitle?.textContent.trim()) return fieldTitle.textContent.trim();

    if (step.matches("label")) {
      const text = directText(step);
      if (text) return text;
      const firstSpan = step.querySelector(":scope > span");
      if (firstSpan?.textContent.trim()) return firstSpan.textContent.trim();
    }

    const heading = step.querySelector("h2, h3, strong");
    return heading?.textContent.trim() || `Information ${index + 1}`;
  }

  function validateSku(input) {
    if (!input || input.name !== "sku") return true;
    const digits = String(input.value || "").replace(/\D/g, "");
    const valid = /^(?:1000|1001)\d{6}$/.test(digits);
    input.setCustomValidity(valid ? "" : "Le numéro doit contenir 10 chiffres et commencer par 1000 ou 1001.");
    return valid;
  }

  function validateStep(step) {
    const fields = [...step.querySelectorAll("input, select, textarea")]
      .filter(field => !field.disabled && field.type !== "hidden");

    for (const field of fields) {
      if (!validateSku(field) || !field.checkValidity()) {
        field.reportValidity();
        field.focus({ preventScroll: true });
        return false;
      }
    }
    return true;
  }

  function isEditableField(element) {
    return element instanceof HTMLElement && element.matches("input, select, textarea");
  }

  function visualViewportBounds() {
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const height = viewport?.height || window.innerHeight;
    return { top, bottom: top + height };
  }

  function keyboardHeight() {
    const viewport = window.visualViewport;
    if (!viewport) return 0;
    const overlap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    return overlap >= KEYBOARD_THRESHOLD ? Math.round(overlap) : 0;
  }

  function initializeWizard(form) {
    if (!FORM_IDS.has(form.id)) return;
    moveGesFieldsToSalesLocation(form);
    enhanceQuantityField(form);
    if (!guidedModeEnabled() || form.dataset.articleWizard === "ready") return;

    const grid = form.querySelector(":scope > .form-grid");
    const finalActions = form.querySelector(":scope > .form-actions");
    if (!grid || !finalActions) return;

    const steps = [...grid.children].filter(step =>
      !step.matches('input[type="hidden"], .ges-location-field')
    );
    if (steps.length < 2) return;

    form.dataset.articleWizard = "ready";
    form.classList.add("article-wizard");
    steps.forEach((step, index) => {
      step.classList.add("article-wizard-step");
      step.dataset.wizardStep = String(index);
    });
    finalActions.classList.add("article-wizard-final-actions");

    const header = document.createElement("div");
    header.className = "article-wizard-header";
    header.innerHTML = `
      <div class="article-wizard-heading">
        <span class="article-wizard-badge">Mode guidé activé</span>
        <span class="article-wizard-count" aria-live="polite"></span>
      </div>
      <h3 class="article-wizard-question"></h3>
      <div class="article-wizard-progress" aria-hidden="true"><span></span></div>
    `;
    grid.before(header);

    const controls = document.createElement("div");
    controls.className = "article-wizard-controls";
    controls.innerHTML = `
      <button class="button article-wizard-previous" type="button">← Précédent</button>
      <button class="button primary article-wizard-next" type="button">Suivant →</button>
    `;
    finalActions.before(controls);

    const previousButton = controls.querySelector(".article-wizard-previous");
    const nextButton = controls.querySelector(".article-wizard-next");
    const count = header.querySelector(".article-wizard-count");
    const question = header.querySelector(".article-wizard-question");
    const progress = header.querySelector(".article-wizard-progress span");
    let activeIndex = 0;
    let visibilityTimer = null;

    function updateKeyboardSpace() {
      const height = keyboardHeight();
      const spacing = height ? height + FIELD_BOTTOM_GAP : 0;
      form.style.paddingBottom = spacing ? `${spacing}px` : "";
      form.style.scrollPaddingBottom = spacing ? `${spacing}px` : "";
      form.classList.toggle("article-wizard-keyboard-open", height > 0);
      return height;
    }

    function keepFieldVisible(field = document.activeElement, behavior = "smooth") {
      if (!isEditableField(field) || !form.contains(field)) return;

      const viewport = visualViewportBounds();
      const rect = field.getBoundingClientRect();
      const visibleTop = viewport.top + FIELD_TOP_GAP;
      const visibleBottom = viewport.bottom - FIELD_BOTTOM_GAP;
      let movement = 0;

      if (rect.bottom > visibleBottom) movement = rect.bottom - visibleBottom;
      else if (rect.top < visibleTop) movement = rect.top - visibleTop;

      if (Math.abs(movement) > 2) window.scrollBy({ top: movement, behavior });
    }

    function scheduleVisibilityCheck(field = document.activeElement, delay = 240) {
      clearTimeout(visibilityTimer);
      visibilityTimer = window.setTimeout(() => {
        if (!form.isConnected) return;
        updateKeyboardSpace();
        keepFieldVisible(field);
      }, delay);
    }

    function showStep(index, { focus = false } = {}) {
      activeIndex = Math.max(0, Math.min(index, steps.length - 1));
      steps.forEach((step, stepIndex) => {
        const active = stepIndex === activeIndex;
        step.hidden = !active;
        step.setAttribute("aria-hidden", active ? "false" : "true");
      });

      count.textContent = `Étape ${activeIndex + 1} sur ${steps.length}`;
      question.textContent = questionTitle(steps[activeIndex], activeIndex);
      progress.style.width = `${((activeIndex + 1) / steps.length) * 100}%`;
      previousButton.hidden = activeIndex === 0;
      nextButton.hidden = activeIndex === steps.length - 1;
      finalActions.hidden = activeIndex !== steps.length - 1;

      header.scrollIntoView({ behavior: "smooth", block: "start" });
      if (focus) {
        const field = steps[activeIndex].querySelector("input:not([type='hidden']):not([type='file']), select, textarea, button");
        field?.focus({ preventScroll: true });
        if (isEditableField(field)) scheduleVisibilityCheck(field, 280);
      }
    }

    function closeKeyboardBeforeNavigation() {
      if (isEditableField(document.activeElement) && form.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }

    previousButton.addEventListener("click", () => {
      closeKeyboardBeforeNavigation();
      showStep(activeIndex - 1);
    });
    nextButton.addEventListener("click", () => {
      if (!validateStep(steps[activeIndex])) return;
      closeKeyboardBeforeNavigation();
      showStep(activeIndex + 1);
    });

    form.addEventListener("keydown", event => {
      if (event.key !== "Enter" || activeIndex >= steps.length - 1) return;
      if (event.target.matches("textarea, button, input[type='checkbox'], input[type='radio'], input[type='file']")) return;
      event.preventDefault();
      nextButton.click();
    });

    form.addEventListener("focusin", event => {
      if (!isEditableField(event.target)) return;
      scheduleVisibilityCheck(event.target);
    });

    form.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!form.isConnected || form.contains(document.activeElement)) return;
        updateKeyboardSpace();
      }, 220);
    });

    form.addEventListener("input", event => {
      if (event.target?.name === "sku") event.target.setCustomValidity("");
    });

    form.addEventListener("invalid", event => {
      const invalidStep = steps.findIndex(step => step.contains(event.target));
      if (invalidStep >= 0 && invalidStep !== activeIndex) showStep(invalidStep, { focus: false });
      scheduleVisibilityCheck(event.target, 80);
    }, true);

    if (window.visualViewport) {
      const handleViewportChange = () => {
        if (!form.isConnected) {
          window.visualViewport.removeEventListener("resize", handleViewportChange);
          window.visualViewport.removeEventListener("scroll", handleViewportChange);
          return;
        }
        updateKeyboardSpace();
        requestAnimationFrame(() => keepFieldVisible(document.activeElement, "auto"));
      };

      window.visualViewport.addEventListener("resize", handleViewportChange);
      window.visualViewport.addEventListener("scroll", handleViewportChange);
    }

    updateKeyboardSpace();
    showStep(0, { focus: false });
  }

  function initializeVisibleForms() {
    document.querySelectorAll("#itemForm, #scanForm").forEach(initializeWizard);
    enhanceEntryModeSettings();
    decorateQuantityValidationFlags();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(initializeVisibleForms).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
    initializeVisibleForms();
  });

  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY) decorateQuantityValidationFlags();
  });
})();
