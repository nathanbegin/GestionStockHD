(() => {
  const STORAGE_KEY = "restock_app_v1";
  const ANALYZE_PATH = "/api/analyze";
  const MIN_VISIBLE_CONFIDENCE = 0.35;
  let suggestion = null;
  let refreshTimer = null;

  function normalize(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr-CA");
  }

  function readDepartments() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return (Array.isArray(snapshot?.departments) ? snapshot.departments : [])
        .map(entry => ({ id: String(entry?.id || ""), name: String(entry?.name || "").trim() }))
        .filter(entry => entry.id && entry.name);
    } catch {
      return [];
    }
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url || "";
  }

  function isAnalyzeRequest(input, init) {
    try {
      const url = new URL(requestUrl(input), window.location.origin);
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      return url.pathname === ANALYZE_PATH && method === "POST";
    } catch {
      return false;
    }
  }

  function scheduleEnhance(delay = 0) {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceScanForm, delay);
  }

  function captureSuggestion(data) {
    const name = String(data?.suggestedDepartment || "").trim();
    const confidence = Number(data?.departmentConfidence);
    const reason = String(data?.departmentReason || "").trim();

    suggestion = name && Number.isFinite(confidence) && confidence >= MIN_VISIBLE_CONFIDENCE
      ? { name, confidence: Math.max(0, Math.min(1, confidence)), reason }
      : null;

    scheduleEnhance(0);
    scheduleEnhance(120);
    scheduleEnhance(400);
  }

  const previousFetch = window.fetch.bind(window);
  window.fetch = async function departmentAwareFetch(input, init = {}) {
    const analyze = isAnalyzeRequest(input, init);
    let nextInit = init;

    if (analyze && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        body.departments = readDepartments().map(entry => entry.name);
        nextInit = { ...init, body: JSON.stringify(body) };
      } catch {
        nextInit = init;
      }
    }

    const response = await previousFetch(input, nextInit);
    if (analyze && response.ok) {
      response.clone().json().then(captureSuggestion).catch(() => {});
    }
    return response;
  };

  function findSuggestedOption(select) {
    const target = normalize(suggestion?.name);
    return [...select.options].find(option => normalize(option.textContent) === target) || null;
  }

  function confidenceLabel(value) {
    return `${Math.round(value * 100)} % de confiance`;
  }

  function createSuggestionPanel(select, option) {
    const panel = document.createElement("div");
    panel.className = "analysis-box ai-department-suggestion";
    panel.dataset.departmentSuggestion = "true";
    panel.setAttribute("role", "status");

    const header = document.createElement("div");
    header.className = "button-row";

    const title = document.createElement("strong");
    title.textContent = "Suggestion IA";

    const confidence = document.createElement("span");
    confidence.className = "tag";
    confidence.textContent = confidenceLabel(suggestion.confidence);
    header.append(title, confidence);

    const proposed = document.createElement("p");
    proposed.className = "ai-department-name";
    const proposedName = document.createElement("strong");
    proposedName.textContent = option.textContent.trim();
    proposed.append(proposedName);

    panel.append(header, proposed);

    if (suggestion.reason) {
      const reason = document.createElement("p");
      reason.className = "small muted";
      reason.textContent = suggestion.reason;
      panel.append(reason);
    }

    const action = document.createElement("button");
    action.className = "button compact primary";
    action.type = "button";
    action.textContent = "Utiliser cette suggestion";
    action.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      action.disabled = true;
      action.textContent = "Suggestion appliquée";
      panel.dataset.applied = "true";
    });
    panel.append(action);

    return panel;
  }

  function enhanceScanForm() {
    const form = document.querySelector("#scanForm");
    if (!form) return;

    const select = form.querySelector('select[name="departmentId"]');
    const host = select?.closest("label");
    if (!select || !host) return;

    const existing = host.querySelector(":scope > [data-department-suggestion]");
    const option = suggestion ? findSuggestedOption(select) : null;

    if (!suggestion || !option) {
      existing?.remove();
      return;
    }

    const signature = `${option.value}|${suggestion.confidence}|${suggestion.reason}`;
    if (existing?.dataset.signature === signature) return;

    const panel = createSuggestionPanel(select, option);
    panel.dataset.signature = signature;
    if (existing) existing.replaceWith(panel);
    else host.append(panel);
  }

  function clearSuggestion() {
    suggestion = null;
    document.querySelectorAll("[data-department-suggestion]").forEach(panel => panel.remove());
  }

  function installStyles() {
    if (document.querySelector("#aiDepartmentSuggestionStyles")) return;
    const style = document.createElement("style");
    style.id = "aiDepartmentSuggestionStyles";
    style.textContent = `
      .ai-department-suggestion {
        display: block;
        margin-top: .75rem;
        padding: .85rem;
      }
      .ai-department-suggestion .button-row {
        justify-content: space-between;
        align-items: center;
        gap: .5rem;
      }
      .ai-department-suggestion .ai-department-name {
        margin: .55rem 0 .35rem;
        font-size: 1.05rem;
      }
      .ai-department-suggestion .button {
        margin-top: .35rem;
      }
      .ai-department-suggestion[data-applied="true"] {
        border-color: rgba(31, 125, 91, .35);
      }
    `;
    document.head.append(style);
  }

  document.addEventListener("change", event => {
    if (event.target.matches("#cameraInput, #galleryInput")) clearSuggestion();
  }, true);

  document.addEventListener("click", event => {
    if (event.target.closest('[data-action="clear-photo"]')) clearSuggestion();
  }, true);

  document.addEventListener("submit", event => {
    if (event.target?.id === "scanForm") clearSuggestion();
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(() => scheduleEnhance()).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
    enhanceScanForm();
  });
})();
