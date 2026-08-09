(() => {
  const VIEW_KEY = "restock_current_view_v1";
  const RESTORABLE_VIEWS = new Set([
    "dashboard",
    "lists",
    "assignments",
    "pickups",
    "more",
    "history",
    "users",
    "settings",
    "scan"
  ]);
  const TITLE_TO_VIEW = new Map([
    ["Aperçu", "dashboard"],
    ["Articles", "lists"],
    ["Attribution", "assignments"],
    ["Listes de ramassage", "pickups"],
    ["Plus", "more"],
    ["Historique", "history"],
    ["Utilisateurs", "users"],
    ["Réglages", "settings"],
    ["Photo", "scan"],
    ["Ajouter un article", "scan"]
  ]);

  let restorationStarted = false;
  let restorationComplete = false;
  let readyTimer = null;
  let initialized = false;

  function savedView() {
    const value = sessionStorage.getItem(VIEW_KEY) || "dashboard";
    return RESTORABLE_VIEWS.has(value) ? value : "dashboard";
  }

  function saveView(view) {
    if (!RESTORABLE_VIEWS.has(view)) return;
    sessionStorage.setItem(VIEW_KEY, view);
  }

  function bootScreen() {
    return document.querySelector("#bootScreen");
  }

  function hideBoot() {
    const boot = bootScreen();
    if (boot) boot.hidden = true;
  }

  function navigateToView(view) {
    if (view === "dashboard") return false;
    const main = document.querySelector("#appMain");
    if (!main) return false;

    const button = document.createElement("button");
    button.type = "button";
    button.hidden = true;
    button.dataset.action = "go";
    button.dataset.view = view;
    main.append(button);
    button.click();
    button.remove();
    return true;
  }

  function finishRestoration() {
    restorationComplete = true;
    document.documentElement.removeAttribute("data-restoring-view");
    hideBoot();
  }

  function restoreWhenAppAppears() {
    const appShell = document.querySelector("#appShell");
    const authScreen = document.querySelector("#authScreen");
    if (!appShell || !authScreen) return;

    if (!authScreen.hidden) {
      restorationComplete = true;
      document.documentElement.removeAttribute("data-restoring-view");
      hideBoot();
      return;
    }

    if (appShell.hidden || restorationStarted) return;
    restorationStarted = true;
    const view = savedView();

    // L'écouteur principal de app.js est déjà installé lorsque showApp() rend
    // l'application. On attend la microtask suivante pour restaurer la vue sans
    // afficher brièvement Aperçu.
    queueMicrotask(() => {
      navigateToView(view);
      requestAnimationFrame(() => requestAnimationFrame(finishRestoration));
    });
  }

  function saveFromPageTitle() {
    if (!restorationComplete) return;
    const title = document.querySelector("#pageTitle")?.textContent?.trim();
    const view = TITLE_TO_VIEW.get(title);
    if (view) saveView(view);
  }

  function handleNavigationIntent(event) {
    const nav = event.target.closest?.("[data-nav]");
    if (nav?.dataset.nav) {
      saveView(nav.dataset.nav);
      return;
    }

    const go = event.target.closest?.('[data-action="go"][data-view]');
    if (go?.dataset.view) {
      const view = go.dataset.view;
      if (view === "tour") saveView("pickups");
      else saveView(view);
      return;
    }

    // Un formulaire de modification ne peut pas être reconstruit fidèlement
    // après F5; on revient donc à la liste Articles plutôt qu'à un formulaire vide.
    if (event.target.closest?.('[data-action="edit-item"]')) saveView("lists");
    if (event.target.closest?.('[data-action="start-pickup"]')) saveView("pickups");
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    document.documentElement.setAttribute("data-restoring-view", "true");
    document.addEventListener("click", handleNavigationIntent, true);

    const appShell = document.querySelector("#appShell");
    const authScreen = document.querySelector("#authScreen");
    const pageTitle = document.querySelector("#pageTitle");

    const visibilityObserver = new MutationObserver(() => restoreWhenAppAppears());
    if (appShell) visibilityObserver.observe(appShell, { attributes: true, attributeFilter: ["hidden"] });
    if (authScreen) visibilityObserver.observe(authScreen, { attributes: true, attributeFilter: ["hidden"] });

    if (pageTitle) {
      new MutationObserver(() => {
        clearTimeout(readyTimer);
        readyTimer = window.setTimeout(saveFromPageTitle, 0);
      }).observe(pageTitle, { childList: true, subtree: true, characterData: true });
    }

    window.addEventListener("pagehide", saveFromPageTitle);
    window.addEventListener("beforeunload", saveFromPageTitle);
    restoreWhenAppAppears();
  }

  // Ce script est chargé juste avant app.js, après tout le HTML utile : on peut
  // donc installer les observers immédiatement et fermer toute fenêtre de flash.
  if (document.querySelector("#appShell") && document.querySelector("#authScreen")) initialize();
  else document.addEventListener("DOMContentLoaded", initialize, { once: true });
})();
