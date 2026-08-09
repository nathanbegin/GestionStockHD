(() => {
  const SKU_SELECTOR = 'input[name="sku"]';
  const SCAN_FORM_SELECTOR = "#scanForm";
  let refreshTimer = null;
  let entryLaunchPending = false;

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
    window.setTimeout(resetEntryScroll, 80);
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

  function iconButton(source, fileInput) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sku-ai-button sku-ai-${source}-button`;
    const camera = source === "camera";
    const label = camera
      ? "Prendre une photo de l’étiquette pour l’analyse IA"
      : "Importer une photo de l’étiquette pour l’analyse IA";
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

  function scanSourceSection(form) {
    const main = form.closest("#appMain");
    const resultSection = form.closest(".section");
    if (!main) return null;
    return [...main.querySelectorAll(":scope > .section")].find(section =>
      section !== resultSection && section.querySelector("#cameraInput, #galleryInput")
    ) || null;
  }

  function ensureScanFileInput(id, capture) {
    let input = document.getElementById(id);
    if (input) return input;
    input = document.createElement("input");
    input.id = id;
    input.type = "file";
    input.accept = "image/*";
    if (capture) input.setAttribute("capture", "environment");
    input.hidden = true;
    return input;
  }

  function moveScanFeedback(sourceSection, label) {
    if (!sourceSection) return;
    const card = sourceSection.querySelector(":scope > .card");
    if (!card) return;

    let feedback = label.querySelector(":scope > .sku-ai-feedback");
    if (!feedback) {
      feedback = document.createElement("div");
      feedback.className = "sku-ai-feedback";
      label.append(feedback);
    }

    const preview = card.querySelector(":scope > .preview");
    const actions = card.querySelector(":scope > .button-row.top-gap");
    const analysis = card.querySelector(":scope > .analysis-box");
    if (preview) feedback.append(preview);
    if (actions) {
      actions.classList.add("sku-ai-analysis-actions");
      feedback.append(actions);
    }
    if (analysis) feedback.append(analysis);
    sourceSection.classList.add("sku-ai-source-section");
  }

  function buildScanSkuControl(form, input, label) {
    const sourceSection = scanSourceSection(form);
    const cameraInput = ensureScanFileInput("cameraInput", true);
    const galleryInput = ensureScanFileInput("galleryInput", false);

    let control = label.querySelector(":scope > .sku-ai-control");
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
    actions.replaceChildren(
      iconButton("camera", cameraInput),
      iconButton("gallery", galleryInput)
    );

    cameraInput.hidden = true;
    galleryInput.hidden = true;
    label.append(cameraInput, galleryInput);

    let helper = label.querySelector(":scope > .sku-ai-helper");
    if (!helper) {
      helper = document.createElement("div");
      helper.className = "sku-ai-helper";
      control.insertAdjacentElement("afterend", helper);
    }
    helper.innerHTML = `<span>10 chiffres · <strong>1000 000 000</strong></span><span>📷 Photo · 🖼 Importer · analyse IA</span>`;

    moveScanFeedback(sourceSection, label);
    form.closest(".section")?.classList.add("sku-ai-result-section");
    label.dataset.skuAiReady = "true";
  }

  function enhanceSku(form) {
    const input = form.querySelector(SKU_SELECTOR);
    const label = input?.closest("label");
    if (!input || !label) return;

    label.classList.add("sku-ai-label");
    input.placeholder = "1000 000 000";
    input.setAttribute("aria-label", "Numéro d’article, 10 chiffres maximum");

    const legacyHint = label.querySelector(":scope > .field-hint");
    if (legacyHint) legacyHint.hidden = true;

    if (form.matches(SCAN_FORM_SELECTOR) && label.dataset.skuAiReady !== "true") {
      buildScanSkuControl(form, input, label);
    }
    stabilizeEntryPosition(form);
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
          <span class="article-entry-mode">Clavier · Caméra · Photo</span>
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
    if (!document.querySelector("#scanForm")) return;
    const title = document.querySelector("#pageTitle");
    if (title) title.textContent = "Ajouter un article";
  }

  function enhanceVisibleContent() {
    document.querySelectorAll("#itemForm, #scanForm").forEach(enhanceSku);
    harmonizeArticlesEntry();
    harmonizeDashboardActions();
    enhancePageTitle();
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceVisibleContent, 0);
  }

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
  });
})();
