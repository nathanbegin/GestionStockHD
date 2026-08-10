(() => {
  const STATE_KEY = "restockNavigationV1";
  const TITLE_TO_VIEW = new Map([
    ["Aperçu", "dashboard"],
    ["Articles", "lists"],
    ["Événements", "events"],
    ["Attribution", "assignments"],
    ["Listes de ramassage", "pickups"],
    ["Ramassage", "tour"],
    ["Plus", "more"],
    ["Historique", "history"],
    ["Utilisateurs", "users"],
    ["Réglages", "settings"],
    ["Photo", "scan"],
    ["Ajouter un article", "scan"],
    ["Ajouter", "manual"],
    ["Modifier l’article", "manual"]
  ]);

  let ready = false;
  let applyingHistory = false;
  let initialized = false;
  let pushTimer = null;

  function appAvailable() {
    const shell = document.querySelector("#appShell");
    return Boolean(
      shell &&
      !shell.hidden &&
      !document.documentElement.hasAttribute("data-restoring-view")
    );
  }

  function currentView() {
    if (document.querySelector("[data-events-root]")) return "events";
    const title = document.querySelector("#pageTitle")?.textContent?.trim() || "";
    return TITLE_TO_VIEW.get(title) || "dashboard";
  }

  function activeWizard() {
    const form = document.querySelector("#scanForm.article-wizard, #itemForm.article-wizard");
    if (!form) return null;
    const step = [...form.querySelectorAll(".article-wizard-step")]
      .find(candidate => !candidate.hidden && candidate.getAttribute("aria-hidden") !== "true");
    if (!step) return null;
    const index = Number(step.dataset.wizardStep);
    if (!Number.isInteger(index) || index < 0) return null;
    return { formId: form.id, index };
  }

  function snapshot() {
    const state = { view: currentView() };
    const wizard = activeWizard();
    if (wizard) state.wizard = wizard;
    return state;
  }

  function stateSnapshot(state = history.state) {
    return state?.[STATE_KEY]?.snapshot || null;
  }

  function signature(value) {
    if (!value) return "";
    return `${value.view || ""}|${value.wizard?.formId || ""}|${value.wizard?.index ?? ""}`;
  }

  function makeHistoryState(value, root = false) {
    const existing = history.state && typeof history.state === "object" ? history.state : {};
    return {
      ...existing,
      [STATE_KEY]: {
        snapshot: value,
        root: Boolean(root)
      }
    };
  }

  function replaceCurrent(value = snapshot(), root = history.state?.[STATE_KEY]?.root === true) {
    if (!appAvailable()) return;
    history.replaceState(makeHistoryState(value, root), "", window.location.href);
  }

  function pushCurrent() {
    if (!ready || applyingHistory || !appAvailable()) return;
    const value = snapshot();
    if (signature(value) === signature(stateSnapshot())) return;
    history.pushState(makeHistoryState(value, false), "", window.location.href);
  }

  function schedulePush() {
    if (!ready || applyingHistory) return;
    clearTimeout(pushTimer);
    pushTimer = window.setTimeout(pushCurrent, 0);
  }

  function prepareInitialHistory() {
    const value = snapshot();
    if (history.state?.[STATE_KEY]) {
      history.replaceState(makeHistoryState(value, history.state[STATE_KEY].root === true), "", window.location.href);
      return;
    }

    history.replaceState(makeHistoryState(value, true), "", window.location.href);
    history.pushState(makeHistoryState(value, false), "", window.location.href);
  }

  function closeTopLayer() {
    const notification = document.querySelector("#notificationBackdrop:not([hidden])");
    if (notification) {
      notification.querySelector('[data-notification-action="close"]')?.click();
      return true;
    }

    const hdScreenModal = document.querySelector("#hdScreenEntryModal:not([hidden])");
    if (hdScreenModal) {
      hdScreenModal.querySelector("[data-hd-screen-close]")?.click();
      return true;
    }

    const filterDrawer = document.querySelector("#articleFilterDrawer.is-open");
    if (filterDrawer) {
      filterDrawer.querySelector(".filter-drawer-close")?.click();
      return true;
    }

    const gesSheet = document.querySelector(".location-ges-sheet:not([hidden])");
    if (gesSheet) {
      gesSheet.querySelector(".location-ges-sheet-close")?.click();
      return true;
    }

    const eventDialog = document.querySelector(".event-dialog-backdrop");
    if (eventDialog) {
      eventDialog.querySelector('[data-event-action="close-editor"]')?.click();
      return true;
    }

    const appDialog = document.querySelector(".dialog-backdrop");
    if (appDialog) {
      const close = appDialog.querySelector(
        '[data-action="bulk-edit-close"], [data-action="close-pickup-editor"], .dialog-close'
      );
      if (close) {
        close.click();
        return true;
      }
    }

    const nav = document.querySelector("#primaryNavigation.desktop-open");
    const toggle = document.querySelector("#desktopMenuToggle.open");
    if (nav && toggle) {
      toggle.click();
      return true;
    }

    return false;
  }

  function navigateToView(view) {
    const current = currentView();
    if (view === current) return;

    if (view === "events") {
      document.querySelector("#eventsNavButton")?.click();
      return;
    }

    if (view === "manual") view = "lists";
    if (view === "tour") view = "pickups";

    const nav = document.querySelector(`[data-nav="${CSS.escape(view)}"]`);
    if (nav) {
      nav.click();
      return;
    }

    const main = document.querySelector("#appMain");
    if (!main) return;
    const button = document.createElement("button");
    button.type = "button";
    button.hidden = true;
    button.dataset.action = "go";
    button.dataset.view = view;
    main.append(button);
    button.click();
    button.remove();
  }

  function currentWizardIndex(form) {
    const step = [...form.querySelectorAll(".article-wizard-step")]
      .find(candidate => !candidate.hidden && candidate.getAttribute("aria-hidden") !== "true");
    const index = Number(step?.dataset.wizardStep);
    return Number.isInteger(index) ? index : 0;
  }

  function restoreWizard(target) {
    if (!target?.wizard) return;
    const form = document.querySelector(`#${CSS.escape(target.wizard.formId)}.article-wizard`);
    if (!form) return;

    const targetIndex = Number(target.wizard.index);
    if (!Number.isInteger(targetIndex)) return;

    let safety = 30;
    while (currentWizardIndex(form) > targetIndex && safety-- > 0) {
      const previous = form.querySelector(".article-wizard-previous:not([hidden])");
      if (!previous) break;
      previous.click();
    }

    safety = 30;
    while (currentWizardIndex(form) < targetIndex && safety-- > 0) {
      const next = form.querySelector(".article-wizard-next:not([hidden])");
      if (!next) break;
      const before = currentWizardIndex(form);
      next.click();
      if (currentWizardIndex(form) === before) break;
    }
  }

  function applySnapshot(target) {
    if (!target?.view) return;
    navigateToView(target.view);
    window.setTimeout(() => restoreWizard(target), 0);
  }

  function consumeBackForLayer() {
    const value = snapshot();
    history.pushState(makeHistoryState(value, false), "", window.location.href);
  }

  function handlePopState(event) {
    if (!ready || !appAvailable()) return;

    if (closeTopLayer()) {
      consumeBackForLayer();
      return;
    }

    const target = event.state?.[STATE_KEY]?.snapshot;
    const isRoot = event.state?.[STATE_KEY]?.root === true;
    if (!target) return;

    if (isRoot && signature(target) === signature(snapshot())) {
      window.setTimeout(() => history.back(), 0);
      return;
    }

    applyingHistory = true;
    applySnapshot(target);
    window.setTimeout(() => {
      replaceCurrent(target, isRoot);
      requestAnimationFrame(() => {
        applyingHistory = false;
      });
    }, 0);
  }

  function handleClick(event) {
    if (!ready || applyingHistory) return;

    const previous = event.target.closest?.(".article-wizard-previous");
    if (previous) {
      const current = stateSnapshot();
      const wizard = activeWizard();
      if (
        current?.wizard &&
        wizard &&
        current.wizard.formId === wizard.formId &&
        current.wizard.index === wizard.index &&
        wizard.index > 0
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        history.back();
      }
      return;
    }

    const next = event.target.closest?.(".article-wizard-next");
    if (next) {
      replaceCurrent(snapshot(), false);
      requestAnimationFrame(schedulePush);
      return;
    }

    if (
      event.target.closest?.("#eventsNavButton") ||
      event.target.closest?.("[data-nav]") ||
      event.target.closest?.('[data-action="go"][data-view]') ||
      event.target.closest?.('[data-action="edit-item"]') ||
      event.target.closest?.('[data-action="start-pickup"]') ||
      event.target.closest?.('[data-action="cancel-edit"]') ||
      event.target.closest?.('[data-action="exit-pickup-tour"]')
    ) {
      requestAnimationFrame(schedulePush);
    }
  }

  function becomeReady() {
    if (ready || !appAvailable()) return;
    ready = true;
    prepareInitialHistory();
  }

  function initialize() {
    if (initialized) return;
    initialized = true;

    window.addEventListener("popstate", handlePopState);
    document.addEventListener("click", handleClick, true);

    const pageTitle = document.querySelector("#pageTitle");
    if (pageTitle) {
      new MutationObserver(() => {
        if (!ready || applyingHistory) return;
        schedulePush();
      }).observe(pageTitle, { childList: true, subtree: true, characterData: true });
    }

    const readinessObserver = new MutationObserver(becomeReady);
    readinessObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-restoring-view"]
    });
    const shell = document.querySelector("#appShell");
    if (shell) readinessObserver.observe(shell, { attributes: true, attributeFilter: ["hidden"] });

    becomeReady();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
