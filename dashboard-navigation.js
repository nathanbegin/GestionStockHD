(() => {
  const TILE_ROUTES = {
    "À traiter": "open",
    "Priorité élevée": "high",
    "Assignés à moi": "mine",
    "À attribuer": "unassigned",
    "Permis lift à vérifier": "lift"
  };

  const nextPaint = () => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  function renamePickupCategory() {
    document.querySelectorAll('[data-nav="pickups"] small').forEach(label => {
      if (label.textContent !== "Listes de ramassage") {
        label.textContent = "Listes de ramassage";
      }
    });

    document.querySelectorAll('[data-action="go"][data-view="pickups"] h3').forEach(title => {
      if (title.textContent !== "Listes de ramassage") {
        title.textContent = "Listes de ramassage";
      }
    });
  }

  function enhanceDashboardTiles() {
    renamePickupCategory();

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

  function clickNavigation(view) {
    const button = document.querySelector(`[data-nav="${view}"]`);
    if (!button) return false;
    button.click();
    return true;
  }

  function changeSelect(id, value) {
    const select = document.querySelector(`#${id}`);
    if (!select || ![...select.options].some(option => option.value === value)) return;
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
    if (!tile) return;
    event.preventDefault();
    followTile(tile.dataset.dashboardRoute);
  });

  document.addEventListener("keydown", event => {
    const tile = event.target.closest("[data-dashboard-route]");
    if (!tile || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    followTile(tile.dataset.dashboardRoute);
  });

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(enhanceDashboardTiles).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
    enhanceDashboardTiles();
  });
})();
