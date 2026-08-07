(() => {
  const PAUSE_ERROR = "EVENT_EDITOR_SYNC_PAUSED";
  const originalFetch = window.fetch.bind(window);

  let paused = false;
  let submitting = false;
  let allowOneEventRefresh = false;
  let indicatorSnapshot = null;

  function appVisible() {
    const shell = document.querySelector("#appShell");
    return Boolean(shell && !shell.hidden);
  }

  function saveIndicator() {
    const dot = document.querySelector("#syncDot");
    const label = document.querySelector("#syncLabel");
    if (!dot || !label || indicatorSnapshot) return;
    indicatorSnapshot = {
      dotClass: dot.className,
      label: label.textContent
    };
  }

  function paintPausedIndicator() {
    if (!paused) return;
    const dot = document.querySelector("#syncDot");
    const label = document.querySelector("#syncLabel");
    if (dot) dot.className = "status-dot local";
    if (label) label.textContent = "Pause";
  }

  function restoreIndicator() {
    if (!indicatorSnapshot) return;
    const dot = document.querySelector("#syncDot");
    const label = document.querySelector("#syncLabel");
    if (dot) dot.className = indicatorSnapshot.dotClass;
    if (label) label.textContent = indicatorSnapshot.label;
    indicatorSnapshot = null;
  }

  function setPaused(next) {
    const value = Boolean(next);
    if (value === paused) {
      window.__restockEventEditorSyncPaused = paused;
      if (paused) paintPausedIndicator();
      return;
    }

    paused = value;
    window.__restockEventEditorSyncPaused = paused;

    if (paused) {
      saveIndicator();
      paintPausedIndicator();
      return;
    }

    submitting = false;
    allowOneEventRefresh = false;
    restoreIndicator();
  }

  function requestInfo(input, init = {}) {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    const url = new URL(rawUrl, window.location.href);
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    return { url, method };
  }

  function bodyAction(init = {}) {
    if (typeof init?.body !== "string") return "";
    try {
      return String(JSON.parse(init.body)?.action || "");
    } catch {
      return "";
    }
  }

  function pausedError() {
    const error = new Error("Synchronisation ignorée pendant la création de l’événement");
    error.name = PAUSE_ERROR;
    return error;
  }

  window.fetch = async function eventAwareFetch(input, init = {}) {
    const { url, method } = requestInfo(input, init);

    if (paused && method === "POST" && url.pathname === "/api/sync") {
      throw pausedError();
    }

    if (
      paused &&
      method === "GET" &&
      url.pathname === "/api/me" &&
      url.searchParams.get("view") === "events"
    ) {
      if (allowOneEventRefresh) {
        allowOneEventRefresh = false;
      } else {
        throw pausedError();
      }
    }

    const response = await originalFetch(input, init);

    if (paused && method === "POST" && url.pathname === "/api/me" && response.ok) {
      const action = bodyAction(init);
      if (["eventCreate", "eventUpdate"].includes(action)) {
        allowOneEventRefresh = true;
      }
    }

    return response;
  };

  function keepEventEditorOutOfMainFormState(event) {
    if (!event.target.closest?.("#eventEditorForm")) return;
    event.stopPropagation();
  }

  document.addEventListener("input", keepEventEditorOutOfMainFormState, true);
  document.addEventListener("change", keepEventEditorOutOfMainFormState, true);

  document.addEventListener("click", event => {
    const action = event.target.closest("[data-event-action]");
    const actionName = action?.dataset.eventAction || "";

    if (["new", "edit"].includes(actionName)) {
      setPaused(true);
      return;
    }

    if (actionName === "close-editor") {
      setPaused(false);
      return;
    }

    const standardNav = event.target.closest(".bottom-nav [data-nav]");
    if (standardNav) {
      setPaused(false);
      return;
    }

    const backdrop = event.target.closest("[data-event-backdrop]");
    if (backdrop && event.target === backdrop) {
      setPaused(false);
    }
  }, true);

  document.addEventListener("submit", event => {
    if (event.target.id !== "eventEditorForm") return;
    submitting = true;
    setPaused(true);
  }, true);

  window.setInterval(() => {
    if (!paused) return;

    paintPausedIndicator();

    if (!appVisible()) {
      setPaused(false);
      return;
    }

    if (!submitting) return;
    if (document.querySelector("#eventEditorForm")) return;

    const toast = document.querySelector("#toast.show");
    if (/Événement (?:créé|modifié)/i.test(toast?.textContent || "")) {
      setPaused(false);
    }
  }, 120);

  window.__restockEventEditorSyncPaused = false;
})();
