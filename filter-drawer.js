(() => {
  let drawerOpen = false;
  let resetQueue = null;
  let lastTrigger = null;

  const FILTERS = [
    { id: "filterList", label: "Liste", defaultValue: "all" },
    { id: "filterDepartment", label: "Département", defaultValue: "all" },
    { id: "filterEmployee", label: "Employé", defaultValue: "all" },
    { id: "filterStatus", label: "Statut", defaultValue: "open" },
    { id: "filterPriority", label: "Priorité", defaultValue: "all" }
  ];

  const filterIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 6h16M7 12h10M10 18h4"/>
    </svg>`;

  function activeCount(root = document) {
    return FILTERS.reduce((count, filter) => {
      const element = root.querySelector(`#${filter.id}`);
      return count + (element && element.value !== filter.defaultValue ? 1 : 0);
    }, 0);
  }

  function updateTrigger(root = document) {
    const trigger = root.querySelector("#articleFilterTrigger");
    if (!trigger) return;
    const count = activeCount(root);
    trigger.setAttribute("aria-label", count ? `Filtres, ${count} actif${count > 1 ? "s" : ""}` : "Filtres");
    trigger.title = count ? `${count} filtre${count > 1 ? "s" : ""} actif${count > 1 ? "s" : ""}` : "Filtres";
    trigger.querySelector(".filter-count")?.remove();
    if (count) {
      const badge = document.createElement("span");
      badge.className = "filter-count";
      badge.textContent = String(count);
      badge.setAttribute("aria-hidden", "true");
      trigger.appendChild(badge);
    }
  }

  function setOpen(open, root = document) {
    const drawer = root.querySelector("#articleFilterDrawer");
    const backdrop = root.querySelector("#articleFilterBackdrop");
    const trigger = root.querySelector("#articleFilterTrigger");
    drawerOpen = Boolean(open && drawer && backdrop);
    drawer?.classList.toggle("is-open", drawerOpen);
    backdrop?.classList.toggle("is-open", drawerOpen);
    trigger?.setAttribute("aria-expanded", String(drawerOpen));
    document.body.classList.toggle("filter-drawer-open", drawerOpen);
    if (drawerOpen) {
      setTimeout(() => drawer?.querySelector("select")?.focus({ preventScroll: true }), 30);
    } else if (lastTrigger?.isConnected) {
      lastTrigger.focus({ preventScroll: true });
    }
  }

  function processResetQueue() {
    if (!resetQueue?.length) {
      resetQueue = null;
      updateTrigger(document);
      return;
    }
    const next = resetQueue.shift();
    const element = document.querySelector(`#${next.id}`);
    if (!element) return;
    if (element.value === next.defaultValue) {
      queueMicrotask(processResetQueue);
      return;
    }
    element.value = next.defaultValue;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function resetFilters() {
    resetQueue = FILTERS.map(filter => ({ ...filter }));
    drawerOpen = true;
    processResetQueue();
  }

  function enhance() {
    const appMain = document.querySelector("#appMain");
    if (!appMain) return;
    const toolbar = appMain.querySelector(".toolbar.six-filters");
    if (!toolbar) {
      drawerOpen = false;
      document.body.classList.remove("filter-drawer-open");
      return;
    }
    if (toolbar.dataset.filterDrawerReady === "1") {
      updateTrigger(appMain);
      if (resetQueue?.length) queueMicrotask(processResetQueue);
      return;
    }

    toolbar.dataset.filterDrawerReady = "1";
    toolbar.classList.add("filter-toolbar-drawerized");

    const trigger = document.createElement("button");
    trigger.id = "articleFilterTrigger";
    trigger.type = "button";
    trigger.className = "filter-trigger";
    trigger.setAttribute("aria-controls", "articleFilterDrawer");
    trigger.setAttribute("aria-expanded", String(drawerOpen));
    trigger.innerHTML = filterIcon;
    toolbar.appendChild(trigger);

    const backdrop = document.createElement("div");
    backdrop.id = "articleFilterBackdrop";
    backdrop.className = "filter-drawer-backdrop";
    backdrop.setAttribute("aria-hidden", "true");

    const drawer = document.createElement("aside");
    drawer.id = "articleFilterDrawer";
    drawer.className = "filter-drawer";
    drawer.setAttribute("aria-label", "Filtres des articles");
    drawer.innerHTML = `
      <div class="filter-drawer-header">
        <div><p class="eyebrow">AFFICHAGE</p><h2>Filtres</h2></div>
        <button class="filter-drawer-close" type="button" aria-label="Fermer les filtres">×</button>
      </div>
      <div class="filter-drawer-body"></div>
      <div class="filter-drawer-footer">
        <button class="button" type="button" data-filter-reset>Réinitialiser</button>
        <button class="button primary" type="button" data-filter-done>Terminé</button>
      </div>`;

    const body = drawer.querySelector(".filter-drawer-body");
    for (const definition of FILTERS) {
      const select = toolbar.querySelector(`#${definition.id}`);
      if (!select) continue;
      const field = document.createElement("label");
      field.className = "filter-drawer-field";
      const caption = document.createElement("span");
      caption.textContent = definition.label;
      field.append(caption, select);
      body.appendChild(field);
    }

    toolbar.parentElement?.insertBefore(backdrop, toolbar.nextSibling);
    toolbar.parentElement?.insertBefore(drawer, backdrop.nextSibling);

    trigger.addEventListener("click", () => {
      lastTrigger = trigger;
      setOpen(!drawerOpen, appMain);
    });
    backdrop.addEventListener("click", () => setOpen(false, appMain));
    drawer.querySelector(".filter-drawer-close")?.addEventListener("click", () => setOpen(false, appMain));
    drawer.querySelector("[data-filter-done]")?.addEventListener("click", () => setOpen(false, appMain));
    drawer.querySelector("[data-filter-reset]")?.addEventListener("click", resetFilters);
    drawer.addEventListener("change", () => {
      drawerOpen = true;
      queueMicrotask(() => updateTrigger(document));
    });

    updateTrigger(appMain);
    if (drawerOpen) setOpen(true, appMain);
    if (resetQueue?.length) queueMicrotask(processResetQueue);
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && drawerOpen) setOpen(false, document);
  });

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (!appMain) return;
    enhance();
    new MutationObserver(enhance).observe(appMain, { childList: true, subtree: true });
  });
})();
