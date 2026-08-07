(() => {
  const ENTRY_MODE_KEY = "restock_item_entry_mode_v1";
  const AUTO_ANALYZE_DELAY = 450;
  let autoAnalyzePending = false;
  let autoAnalyzeTimer = null;

  function entryMode() {
    return localStorage.getItem(ENTRY_MODE_KEY) === "form" ? "form" : "guided";
  }

  function installStyles() {
    if (document.querySelector("#articleEntryOptionsStyles")) return;
    const style = document.createElement("style");
    style.id = "articleEntryOptionsStyles";
    style.textContent = `
      .article-entry-options { margin-bottom: 24px; }
      .article-entry-options-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .article-entry-tile {
        position: relative;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 15px;
        min-height: 126px;
        width: 100%;
        border: 1px solid var(--line);
        text-align: left;
        color: var(--text);
        transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
      }
      .article-entry-tile:hover {
        transform: translateY(-2px);
        border-color: rgba(249, 99, 2, .42);
        box-shadow: var(--shadow);
      }
      .article-entry-tile-icon {
        display: grid;
        place-items: center;
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: rgba(249, 99, 2, .13);
        color: var(--brand-2);
      }
      .article-entry-tile-icon svg { width: 27px; height: 27px; }
      .article-entry-tile h3 { margin: 0 0 6px; font-size: 17px; }
      .article-entry-tile p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
      .article-entry-mode {
        display: inline-flex;
        align-items: center;
        width: max-content;
        margin-top: 8px;
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--surface-2);
        color: var(--brand-2);
        font-size: 11px;
        font-weight: 800;
      }
      .article-entry-arrow { color: var(--brand-2); font-size: 24px; font-weight: 800; }
      @media (max-width: 680px) {
        .article-entry-options-grid { grid-template-columns: 1fr; }
        .article-entry-tile { min-height: 112px; padding: 16px; }
      }
    `;
    document.head.appendChild(style);
  }

  function photoIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z"></path><circle cx="12" cy="13" r="3"></circle></svg>`;
  }

  function manualIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;
  }

  function createOptionsSection() {
    const mode = entryMode();
    const section = document.createElement("section");
    section.className = "section article-entry-options";
    section.dataset.articleEntryOptions = "true";
    section.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Ajouter un article</h2>
          <p class="muted">Choisis la méthode d’ajout. Les articles existants demeurent accessibles ci-dessous.</p>
        </div>
      </div>
      <div class="article-entry-options-grid">
        <button class="card article-entry-tile" type="button" data-action="go" data-view="scan">
          <span class="article-entry-tile-icon">${photoIcon()}</span>
          <span>
            <h3>Ajouter par photo</h3>
            <p>Ouvrir directement la caméra, photographier l’étiquette et lancer automatiquement l’analyse par l’IA.</p>
          </span>
          <span class="article-entry-arrow" aria-hidden="true">›</span>
        </button>
        <button class="card article-entry-tile" type="button" data-action="go" data-view="manual">
          <span class="article-entry-tile-icon">${manualIcon()}</span>
          <span>
            <h3>Ajouter manuellement</h3>
            <p>Saisir les renseignements de l’article selon la préférence enregistrée dans les réglages.</p>
            <span class="article-entry-mode">${mode === "form" ? "Mode formulaire" : "Mode guidé"}</span>
          </span>
          <span class="article-entry-arrow" aria-hidden="true">›</span>
        </button>
      </div>`;
    return section;
  }

  function updateNavigationState() {
    const main = document.querySelector("#appMain");
    const articleButton = document.querySelector('.bottom-nav [data-nav="lists"]');
    if (!main || !articleButton) return;

    const articleEntryOpen = Boolean(main.querySelector("#scanForm, #itemForm"));
    if (articleEntryOpen) {
      document.querySelectorAll(".bottom-nav [data-nav]").forEach(button => {
        button.classList.toggle("active", button === articleButton);
        if (button === articleButton) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      return;
    }

    document.querySelectorAll(".bottom-nav [data-nav]").forEach(button => {
      if (button.classList.contains("active")) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function openCamera() {
    const input = document.querySelector("#cameraInput");
    if (!input) return false;
    input.value = "";
    input.click();
    return true;
  }

  function triggerAutomaticAnalysis() {
    if (!autoAnalyzePending) return;
    const button = document.querySelector('#appMain [data-action="analyze-photo"]');
    if (!button || button.disabled) return;
    autoAnalyzePending = false;
    clearTimeout(autoAnalyzeTimer);
    button.click();
  }

  function scheduleAutomaticAnalysis(delay = AUTO_ANALYZE_DELAY) {
    if (!autoAnalyzePending) return;
    clearTimeout(autoAnalyzeTimer);
    autoAnalyzeTimer = window.setTimeout(triggerAutomaticAnalysis, delay);
  }

  function enhanceArticlesView() {
    const main = document.querySelector("#appMain");
    if (!main) return;

    const isArticlesView = Boolean(main.querySelector("#filterSearch"));
    if (isArticlesView && !main.querySelector("[data-article-entry-options]")) {
      main.prepend(createOptionsSection());
    }
    updateNavigationState();
    scheduleAutomaticAnalysis();
  }

  document.addEventListener("click", event => {
    const tile = event.target.closest('[data-view="scan"]');
    if (!tile?.closest("[data-article-entry-options]")) return;

    // Le gestionnaire principal ouvre la vue photo avant que l’événement atteigne
    // document. Le clic sur le champ fichier reste donc dans le même geste utilisateur.
    if (!openCamera()) {
      window.requestAnimationFrame(openCamera);
    }
  });

  document.addEventListener("change", event => {
    const input = event.target;
    if (!input.matches?.("#cameraInput, #galleryInput") || !input.files?.[0]) return;
    autoAnalyzePending = true;
    scheduleAutomaticAnalysis();
  }, true);

  document.addEventListener("click", event => {
    if (!event.target.closest('[data-action="clear-photo"]')) return;
    autoAnalyzePending = false;
    clearTimeout(autoAnalyzeTimer);
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    enhanceArticlesView();
    const main = document.querySelector("#appMain");
    if (!main) return;
    new MutationObserver(enhanceArticlesView).observe(main, { childList: true, subtree: true });
  });
})();
