(() => {
  const SKU_SELECTOR = 'input[name="sku"]';
  const SCAN_FORM_SELECTOR = "#scanForm";
  const MEDIA_IDS = new Set(["cameraInput", "galleryInput"]);
  let refreshTimer = null;
  let entryLaunchPending = false;
  let autoAnalyzeToken = 0;

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

  const ADD_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14M5 12h14"/>
      </g>
    </svg>`;

  function resetEntryScroll() {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function stabilizeEntryPosition(form) {
    if (!form?.matches?.(SCAN_FORM_SELECTOR)) return;
    if (!entryLaunchPending && window.scrollY <= 12) return;
    entryLaunchPending = false;
    resetEntryScroll();
    requestAnimationFrame(resetEntryScroll);
    window.setTimeout(resetEntryScroll, 100);
  }

  function goToUnifiedEntry() {
    const main = document.querySelector("#appMain");
    if (!main) return;
    entryLaunchPending = true;
    const navigation = document.createElement("button");
    navigation.type = "button";
    navigation.hidden = true;
    navigation.dataset.action = "go";
    navigation.dataset.view = "scan";
    main.append(navigation);
    navigation.click();
    navigation.remove();
  }

  function findLegacyPhotoSection(form) {
    const main = form.closest("#appMain");
    const formSection = form.closest(".section");
    if (!main) return null;
    return [...main.querySelectorAll(":scope > .section")].find(section =>
      section !== formSection && (section.querySelector(".scan-zone") || section.querySelector("#cameraInput") || section.querySelector("#galleryInput"))
    ) || null;
  }

  function ensureFileInput(form, id, capture = false) {
    let input = document.getElementById(id);
    if (!input) {
      input = document.createElement("input");
      input.id = id;
      input.type = "file";
      input.accept = "image/*";
      if (capture) input.setAttribute("capture", "environment");
      input.hidden = true;
      form.append(input);
    }
    input.hidden = true;
    if (capture) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    return input;
  }

  function iconButton(kind, fileInput) {
    const camera = kind === "camera";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sku-ai-button sku-ai-${kind}-button`;
    const label = camera
      ? "Prendre une photo de l’étiquette avec la caméra et l’analyser avec l’IA"
      : "Importer une photo de l’étiquette et l’analyser avec l’IA";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = camera ? CAMERA_ICON : GALLERY_ICON;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      fileInput.value = "";
      fileInput.click();
    });
    return button;
  }

  function movePhotoFeedback(sourceSection, fieldLabel) {
    let feedback = fieldLabel.querySelector(":scope > .sku-ai-feedback");
    if (!feedback) {
      feedback = document.createElement("div");
      feedback.className = "sku-ai-feedback";
      fieldLabel.append(feedback);
    }

    const sourceCard = sourceSection?.querySelector(":scope > .card");
    if (sourceCard) {
      const preview = sourceCard.querySelector(":scope > .preview");
      const actions = sourceCard.querySelector(":scope > .button-row.top-gap");
      const analysis = sourceCard.querySelector(":scope > .analysis-box");
      if (preview) feedback.append(preview);
      if (actions) {
        actions.classList.add("sku-ai-analysis-actions");
        feedback.append(actions);
      }
      if (analysis) feedback.append(analysis);
    }

    if (sourceSection) sourceSection.classList.add("sku-ai-source-section");
  }

  function enhanceScanSku(form) {
    const input = form.querySelector(SKU_SELECTOR);
    const fieldLabel = input?.closest("label");
    if (!input || !fieldLabel) return;

    fieldLabel.classList.add("sku-ai-label");
    input.placeholder = "1000 000 000";
    input.setAttribute("aria-label", "Numéro d’article, 10 chiffres maximum");

    const legacyHint = fieldLabel.querySelector(":scope > .field-hint");
    if (legacyHint) legacyHint.hidden = true;

    if (!form.matches(SCAN_FORM_SELECTOR)) return;

    const sourceSection = findLegacyPhotoSection(form);
    const cameraInput = ensureFileInput(form, "cameraInput", true);
    const galleryInput = ensureFileInput(form, "galleryInput", false);

    let control = input.closest(".sku-ai-control");
    if (!control) {
      control = document.createElement("div");
      control.className = "sku-ai-control";
      input.before(control);
      control.append(input);
    }

    let actions = control.querySelector(":scope > .sku-ai-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "sku-ai-actions";
      control.append(actions);
    }

    if (actions.dataset.mediaReady !== "true") {
      actions.dataset.mediaReady = "true";
      actions.replaceChildren(
        iconButton("camera", cameraInput),
        iconButton("gallery", galleryInput)
      );
    }

    if (!fieldLabel.querySelector(":scope > #cameraInput")) fieldLabel.append(cameraInput);
    if (!fieldLabel.querySelector(":scope > #galleryInput")) fieldLabel.append(galleryInput);

    let helper = fieldLabel.querySelector(":scope > .sku-ai-helper");
    if (!helper) {
      helper = document.createElement("div");
      helper.className = "sku-ai-helper";
      control.insertAdjacentElement("afterend", helper);
    }
    helper.innerHTML = `<span>10 chiffres · <strong>1000 000 000</strong></span><span>Caméra ou photo = analyse IA automatique</span>`;

    movePhotoFeedback(sourceSection, fieldLabel);
    form.closest(".section")?.classList.add("sku-ai-result-section");
    fieldLabel.dataset.skuAiReady = "true";
    stabilizeEntryPosition(form);
  }

  function scheduleAutomaticAnalysis() {
    const token = ++autoAnalyzeToken;
    let attempts = 0;
    const tryAnalyze = () => {
      if (token !== autoAnalyzeToken) return;
      attempts += 1;
      const button = document.querySelector('#scanForm [data-action="analyze-photo"], .sku-ai-feedback [data-action="analyze-photo"]');
      if (button && !button.disabled) {
        button.click();
        return;
      }
      if (attempts < 24) window.setTimeout(tryAnalyze, 200);
    };
    window.setTimeout(tryAnalyze, 220);
  }

  function harmonizeArticlesEntry() {
    const section = document.querySelector("[data-article-entry-options]");
    const grid = section?.querySelector(".article-entry-options-grid");
    if (!section || !grid || grid.dataset.unifiedEntry === "true") return;

    grid.dataset.unifiedEntry = "true";
    grid.classList.add("unified-article-entry-grid");
    grid.innerHTML = `
      <button class="card article-entry-tile unified-entry-tile" type="button" data-unified-article-entry>
        <span class="article-entry-tile-icon">${ADD_ICON}</span>
        <span>
          <h3>Ajouter un article</h3>
          <p>Saisis le SKU ou utilise directement la caméra ou une photo avec l’IA.</p>
          <span class="article-entry-mode">Clavier · Caméra · Photo IA</span>
        </span>
        <span class="article-entry-arrow" aria-hidden="true">›</span>
      </button>`;
  }

  function harmonizeDashboardActions() {
    const main = document.querySelector("#appMain");
    if (!main || main.querySelector("#scanForm, #itemForm, #filterSearch")) return;

    for (const grid of main.querySelectorAll(".actions-grid")) {
      const scan = grid.querySelector('[data-action="go"][data-view="scan"]');
      const manual = grid.querySelector('[data-action="go"][data-view="manual"]');
      if (!scan || grid.dataset.unifiedQuickActions === "true") continue;

      grid.dataset.unifiedQuickActions = "true";
      grid.classList.add("unified-quick-actions");
      const icon = scan.querySelector(".icon");
      const title = scan.querySelector("h3");
      const text = scan.querySelector("p");
      if (icon) icon.textContent = "＋";
      if (title) title.textContent = "Ajouter un article";
      if (text) text.textContent = "SKU, caméra ou photo avec analyse IA.";
      manual?.remove();
    }
  }

  function enhancePageTitle() {
    if (!document.querySelector(SCAN_FORM_SELECTOR)) return;
    const title = document.querySelector("#pageTitle");
    if (title) title.textContent = "Ajouter un article";
  }

  function enhanceVisibleContent() {
    document.querySelectorAll("#itemForm, #scanForm").forEach(enhanceScanSku);
    harmonizeArticlesEntry();
    harmonizeDashboardActions();
    enhancePageTitle();
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceVisibleContent, 0);
  }

  document.addEventListener("change", event => {
    if (MEDIA_IDS.has(event.target?.id) && event.target.files?.[0]) scheduleAutomaticAnalysis();
  }, true);

  document.addEventListener("click", event => {
    const unified = event.target.closest?.("[data-unified-article-entry]");
    if (unified) {
      event.preventDefault();
      event.stopImmediatePropagation();
      goToUnifiedEntry();
      return;
    }

    const scanLaunch = event.target.closest?.('[data-action="go"][data-view="scan"]');
    if (scanLaunch?.closest(".actions-grid, [data-article-entry-options]")) entryLaunchPending = true;

    const legacyManual = event.target.closest?.('[data-action="go"][data-view="manual"]');
    if (legacyManual && legacyManual.closest(".actions-grid, [data-article-entry-options]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      goToUnifiedEntry();
    }
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const main = document.querySelector("#appMain");
    if (main) new MutationObserver(scheduleRefresh).observe(main, { childList: true, subtree: true });
    enhanceVisibleContent();
    window.setInterval(() => {
      if (document.querySelector("#scanForm")) enhanceVisibleContent();
    }, 500);
  });
})();
