(() => {
  const SKU_SELECTOR = 'input[name="sku"]';
  const SCAN_FORM_SELECTOR = "#scanForm";
  let refreshTimer = null;

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

  function goToUnifiedEntry() {
    const main = document.querySelector("#appMain");
    if (!main) return;
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
    button.className = "sku-ai-button";
    const camera = source === "camera";
    const label = camera
      ? "Prendre une photo de l’étiquette pour l’analyse IA"
      : "Choisir une photo de l’étiquette dans la galerie";
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
    if (!main) return null;
    return [...main.querySelectorAll(":scope > .section")]
      .find(section => section !== form.closest(".section") && section.querySelector("#cameraInput, #galleryInput")) || null;
  }

  function moveScanFeedback(form, label) {
    const source = scanSourceSection(form);
    if (!source) return;
    source.classList.add("sku-ai-source-section");

    const resultSection = form.closest(".section");
    resultSection?.classList.add("sku-ai-result-section");

    let feedback = label.querySelector(":scope > .sku-ai-feedback");
    if (!feedback) {
      feedback = document.createElement("div");
      feedback.className = "sku-ai-feedback";
      label.append(feedback);
    }

    const sourceCard = source.querySelector(":scope > .card");
    if (!sourceCard) return;
    const preview = sourceCard.querySelector(":scope > .preview");
    const analysis = sourceCard.querySelector(":scope > .analysis-box");
    if (preview) feedback.append(preview);
    if (analysis) feedback.append(analysis);
  }

  function enhanceSku(form) {
    const input = form.querySelector(SKU_SELECTOR);
    if (!input) return;
    const label = input.closest("label");
    if (!label) return;

    label.classList.add("sku-ai-label");
    input.placeholder = "1000 000 000";
    input.setAttribute("aria-label", "Numéro d’article, 10 chiffres maximum");

    if (form.matches(SCAN_FORM_SELECTOR)) {
      const cameraInput = document.querySelector("#cameraInput");
      const galleryInput = document.querySelector("#galleryInput");
      if (cameraInput && galleryInput && !label.querySelector(".sku-ai-control")) {
        const control = document.createElement("div");
        control.className = "sku-ai-control";
        input.before(control);
        control.append(input);

        const actions = document.createElement("div");
        actions.className = "sku-ai-actions";
        actions.append(iconButton("gallery", galleryInput), iconButton("camera", cameraInput));
        control.append(actions);

        const helper = document.createElement("div");
        helper.className = "sku-ai-helper";
        helper.innerHTML = `<span>10 chiffres · format <strong>1000 000 000</strong></span><span>Photo = analyse IA</span>`;
        control.insertAdjacentElement("afterend", helper);

        const legacyHint = label.querySelector(":scope > .field-hint");
        if (legacyHint) legacyHint.hidden = true;
      }
      moveScanFeedback(form, label);
    }
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
          <p>Saisie du SKU, caméra ou galerie avec analyse IA dans le même parcours.</p>
          <span class="article-entry-mode">Manuel · Caméra · Galerie</span>
        </span>
        <span class="article-entry-arrow" aria-hidden="true">›</span>
      </button>`;

    const heading = section.querySelector(".section-head p");
    if (heading) heading.textContent = "Un seul parcours pour saisir le numéro ou utiliser une photo avec l’IA.";
  }

  function harmonizeDashboardActions() {
    const main = document.querySelector("#appMain");
    if (!main || main.querySelector("#scanForm, #itemForm, #filterSearch")) return;

    const grids = [...main.querySelectorAll(".actions-grid")];
    for (const grid of grids) {
      const scan = grid.querySelector('[data-action="go"][data-view="scan"]');
      const manual = grid.querySelector('[data-action="go"][data-view="manual"]');
      if (!scan || grid.dataset.unifiedQuickActions === "true") continue;

      grid.dataset.unifiedQuickActions = "true";
      grid.classList.add("unified-quick-actions");
      scan.dataset.view = "scan";
      const icon = scan.querySelector(".icon");
      const title = scan.querySelector("h3");
      const text = scan.querySelector("p");
      if (icon) icon.textContent = "＋";
      if (title) title.textContent = "Ajouter un article";
      if (text) text.textContent = "Saisir le SKU ou utiliser caméra / galerie avec l’IA.";
      manual?.remove();
    }
  }

  function enhancePageTitle() {
    if (document.querySelector("#scanForm")) {
      const title = document.querySelector("#pageTitle");
      if (title) title.textContent = "Ajouter un article";
    }
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
    const button = event.target.closest?.("[data-unified-article-entry]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    goToUnifiedEntry();
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const main = document.querySelector("#appMain");
    if (main) new MutationObserver(scheduleRefresh).observe(main, { childList: true, subtree: true });
    enhanceVisibleContent();
  });
})();
