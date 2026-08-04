(() => {
  const TILE_ROUTES = {
    "À traiter": "open",
    "Priorité élevée": "high",
    "Assignés à moi": "mine",
    "À attribuer": "unassigned",
    "Permis lift à vérifier": "lift"
  };

  const VIEW_BY_TITLE = {
    "Aperçu": "dashboard",
    "Photo": "scan",
    "Ajouter": "manual",
    "Modifier l’article": "manual",
    "Articles": "lists",
    "Attribution": "assignments",
    "Listes de ramassage": "pickups",
    "Ramassage": "tour",
    "Plus": "more",
    "Historique": "history",
    "Utilisateurs": "users",
    "Réglages": "settings"
  };

  const nextPaint = () => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  let currentView = "dashboard";
  let pendingBackTarget = null;
  const viewHistory = [];

  function roleAllowsLiftVerification() {
    const role = document.querySelector("#currentUserRole")?.textContent?.trim().toLowerCase() || "";
    return role.includes("superviseur") || role.includes("administrateur");
  }

  function ensureStyles() {
    if (document.querySelector("#dashboardNavigationStyles")) return;
    const style = document.createElement("style");
    style.id = "dashboardNavigationStyles";
    style.textContent = `
      .app-back-button {
        display: inline-flex;
        align-items: center;
        gap: .35rem;
        margin: 0 0 .3rem;
        padding: .2rem 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: .86rem;
        font-weight: 750;
        cursor: pointer;
      }
      .app-back-button[hidden] { display: none !important; }
      .app-back-button:hover { text-decoration: underline; }
      .app-back-button:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 3px;
        border-radius: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  function inferCurrentView() {
    const title = document.querySelector("#pageTitle")?.textContent?.trim() || "";
    return VIEW_BY_TITLE[title] || currentView;
  }

  function navigateTo(view) {
    const navButton = document.querySelector(`[data-nav="${view}"]`);
    if (navButton) {
      navButton.click();
      return true;
    }

    const appMain = document.querySelector("#appMain");
    if (!appMain) return false;
    const temporary = document.createElement("button");
    temporary.type = "button";
    temporary.hidden = true;
    temporary.dataset.action = "go";
    temporary.dataset.view = view;
    appMain.appendChild(temporary);
    temporary.click();
    temporary.remove();
    return true;
  }

  function goBack() {
    let target = viewHistory.pop() || "dashboard";
    while (target === currentView && viewHistory.length) target = viewHistory.pop();
    pendingBackTarget = target;
    if (!navigateTo(target)) pendingBackTarget = null;
    setTimeout(() => {
      if (pendingBackTarget === target) pendingBackTarget = null;
    }, 1200);
  }

  function ensureBackButton() {
    const title = document.querySelector("#pageTitle");
    const holder = title?.parentElement;
    if (!holder) return;

    let button = holder.querySelector("#appBackButton");
    if (!button) {
      button = document.createElement("button");
      button.id = "appBackButton";
      button.type = "button";
      button.className = "app-back-button";
      button.setAttribute("aria-label", "Retour à l’écran précédent");
      button.innerHTML = '<span aria-hidden="true">←</span><span>Retour</span>';
      button.addEventListener("click", goBack);
      holder.insertBefore(button, holder.firstChild);
    }

    const appHidden = Boolean(document.querySelector("#appShell")?.hidden);
    button.hidden = appHidden || currentView === "dashboard";
  }

  function renamePickupCategory() {
    document.querySelectorAll('[data-nav="pickups"] small').forEach(label => {
      if (label.textContent !== "Listes de ramassage") label.textContent = "Listes de ramassage";
    });

    document.querySelectorAll('[data-action="go"][data-view="pickups"] h3').forEach(title => {
      if (title.textContent !== "Listes de ramassage") title.textContent = "Listes de ramassage";
    });
  }

  function applyLiftAccess() {
    const allowed = roleAllowsLiftVerification();

    document.querySelectorAll("#appMain .stats-grid .stat-card").forEach(tile => {
      const label = tile.querySelector(".stat-label")?.textContent?.trim();
      if (label !== "Permis lift à vérifier") return;
      tile.hidden = !allowed;
      tile.setAttribute("aria-hidden", allowed ? "false" : "true");
    });

    const filter = document.querySelector("#assignmentFilter");
    const liftOption = filter?.querySelector('option[value="lift"]');
    if (liftOption) {
      liftOption.hidden = !allowed;
      liftOption.disabled = !allowed;
    }

    if (!allowed && filter?.value === "lift") {
      filter.value = [...filter.options].some(option => option.value === "mine") ? "mine" : "unassigned";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function enhanceDashboardTiles() {
    renamePickupCategory();
    applyLiftAccess();
    ensureBackButton();

    document.querySelectorAll("#appMain .stats-grid .stat-card").forEach(tile => {
      const label = tile.querySelector(".stat-label")?.textContent?.trim();
      const route = TILE_ROUTES[label];
      if (!route || tile.dataset.dashboardRoute === route) return;

      tile.dataset.dashboardRoute = route;
      tile.setAttribute("role", "button");
      tile.setAttribute("tabindex", "0");
      tile.setAttribute("aria-label", `${label} — ouvrir la section correspondante`);
      tile.style.cursor = "pointer";
    });
  }

  function syncViewHistory() {
    const nextView = inferCurrentView();
    if (nextView !== currentView) {
      if (pendingBackTarget === nextView) {
        pendingBackTarget = null;
      } else if (currentView) {
        const previous = viewHistory.at(-1);
        if (previous !== currentView) viewHistory.push(currentView);
        if (viewHistory.length > 30) viewHistory.shift();
      }
      currentView = nextView;
    }
    enhanceDashboardTiles();
  }

  function clickNavigation(view) {
    const button = document.querySelector(`[data-nav="${view}"]`);
    if (!button) return false;
    button.click();
    return true;
  }

  function changeSelect(id, value) {
    const select = document.querySelector(`#${id}`);
    if (!select || ![...select.options].some(option => option.value === value && !option.disabled)) return;
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function clearArticleSearch() {
    const search = document.querySelector("#filterSearch");
    if (!search || !search.value) return;
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 220));
  }

  async function openArticleList({ priority = "all", employee = "all" } = {}) {
    if (!clickNavigation("lists")) return;
    await nextPaint();
    await clearArticleSearch();

    changeSelect("filterList", "all");
    changeSelect("filterDepartment", "all");
    changeSelect("filterEmployee", employee);
    changeSelect("filterStatus", "open");
    changeSelect("filterPriority", priority);
  }

  async function openAssignments(filter) {
    if (filter === "lift" && !roleAllowsLiftVerification()) return;
    if (!clickNavigation("assignments")) return;
    await nextPaint();
    changeSelect("assignmentFilter", filter);
  }

  async function followTile(route) {
    if (route === "open") return openArticleList();
    if (route === "high") return openArticleList({ priority: "high" });
    if (route === "mine") return openAssignments("mine");
    if (route === "unassigned") return openAssignments("unassigned");
    if (route === "lift") return openAssignments("lift");
  }

  document.addEventListener("click", event => {
    const tile = event.target.closest("[data-dashboard-route]");
    if (!tile || tile.hidden) return;
    event.preventDefault();
    followTile(tile.dataset.dashboardRoute);
  });

  document.addEventListener("keydown", event => {
    const tile = event.target.closest("[data-dashboard-route]");
    if (!tile || tile.hidden || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    followTile(tile.dataset.dashboardRoute);
  });

  document.addEventListener("DOMContentLoaded", () => {
    ensureStyles();
    currentView = inferCurrentView();

    const appMain = document.querySelector("#appMain");
    const pageTitle = document.querySelector("#pageTitle");
    const role = document.querySelector("#currentUserRole");

    if (appMain) {
      new MutationObserver(syncViewHistory).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
    if (pageTitle) {
      new MutationObserver(syncViewHistory).observe(pageTitle, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }
    if (role) {
      new MutationObserver(enhanceDashboardTiles).observe(role, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    enhanceDashboardTiles();
  });
})();
