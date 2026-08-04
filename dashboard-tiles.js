(() => {
  const ROUTES = {
    "À traiter": { view: "lists", filters: { status: "open", priority: "all" } },
    "Priorité élevée": { view: "lists", filters: { status: "open", priority: "high" } },
    "Assignés à moi": { view: "assignments", assignment: "mine" },
    "À attribuer": { view: "assignments", assignment: "unassigned" },
    "Permis lift à vérifier": { view: "assignments", assignment: "lift" }
  };

  function enhanceDashboardTiles() {
    const main = document.querySelector("#appMain");
    if (!main) return;

    main.querySelectorAll(".stats-grid .stat-card").forEach(tile => {
      const label = tile.querySelector(".stat-label")?.textContent?.trim();
      if (!label || !ROUTES[label]) return;

      tile.dataset.dashboardRoute = label;
      tile.classList.add("dashboard-tile");
      tile.setAttribute("role", "button");
      tile.setAttribute("tabindex", "0");
      tile.setAttribute("aria-label", `Ouvrir : ${label}`);
    });
  }

  function dispatchChange(id, value) {
    const control = document.querySelector(`#${id}`);
    if (!control || control.value === value) return;
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clearArticleSearch() {
    const search = document.querySelector("#filterSearch");
    if (!search || !search.value) return;
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function applyArticleFilters(route) {
    clearArticleSearch();
    dispatchChange("filterList", "all");
    dispatchChange("filterDepartment", "all");
    dispatchChange("filterEmployee", "all");
    dispatchChange("filterStatus", route.filters?.status || "open");
    dispatchChange("filterPriority", route.filters?.priority || "all");
  }

  function openRoute(label) {
    const route = ROUTES[label];
    if (!route) return;

    const navButton = document.querySelector(`[data-nav="${route.view}"]`);
    if (!navButton) return;
    navButton.click();

    requestAnimationFrame(() => {
      if (route.view === "lists") applyArticleFilters(route);
      if (route.view === "assignments") dispatchChange("assignmentFilter", route.assignment || "all");
    });
  }

  function activateTile(tile) {
    const label = tile?.dataset?.dashboardRoute;
    if (label) openRoute(label);
  }

  document.querySelector("#appMain")?.addEventListener("click", event => {
    const tile = event.target.closest(".dashboard-tile[data-dashboard-route]");
    if (tile) activateTile(tile);
  });

  document.querySelector("#appMain")?.addEventListener("keydown", event => {
    const tile = event.target.closest(".dashboard-tile[data-dashboard-route]");
    if (!tile || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    activateTile(tile);
  });

  const main = document.querySelector("#appMain");
  if (main) {
    new MutationObserver(enhanceDashboardTiles).observe(main, { childList: true, subtree: true });
    enhanceDashboardTiles();
  }
})();
