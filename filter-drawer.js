(() => {
  let drawerOpen = false;
  let commitQueue = null;
  let pendingDirty = false;
  let lastTrigger = null;

  const FILTERS = [
    { id: "filterList", label: "Liste", defaultValue: "all" },
    { id: "filterDepartment", label: "Département", defaultValue: "all" },
    { id: "filterEmployee", label: "Employé", defaultValue: "all" },
    { id: "filterStatus", label: "Statut", defaultValue: "open" },
    { id: "filterPriority", label: "Priorité", defaultValue: "all" }
  ];

  const FILTER_IDS = new Set(FILTERS.map(filter => filter.id));

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

  function setOpen(open, root = document, { restoreFocus = true } = {}) {
    const drawer = root.querySelector("#articleFilterDrawer");
    const backdrop = root.querySelector("#articleFilterBackdrop");
    const trigger = root.querySelector("#articleFilterTrigger");
    drawerOpen = Boolean(open && drawer && backdrop);
    drawer?.classList.toggle("is-open", drawerOpen);
    backdrop?.classList.toggle("is-open", drawerOpen);
    trigger?.setAttribute("aria-expanded", String(drawerOpen));
    document.body.classList.toggle("filter-drawer-open", drawerOpen);

    // Ne pas forcer le focus sur un <select> à l'ouverture : certains navigateurs
    // mobiles peuvent ouvrir/repositionner le contrôle natif pendant l'animation.
    if (!drawerOpen && restoreFocus && lastTrigger?.isConnected) {
      lastTrigger.focus({ preventScroll: true });
    }
  }

  function currentFilterValues(root = document) {
    return FILTERS.map(filter => ({
      id: filter.id,
      value: root.querySelector(`#${filter.id}`)?.value ?? filter.defaultValue
    }));
  }

  function processCommitQueue() {
    if (!commitQueue?.length) {
      commitQueue = null;
      pendingDirty = false;
      updateTrigger(document);
      return;
    }

    const next = commitQueue.shift();
    const element = document.querySelector(`#${next.id}`);
    if (!element) {
      queueMicrotask(processCommitQueue);
      return;
    }

    if (element.value === next.value) {
      queueMicrotask(processCommitQueue);
      return;
    }

    element.value = next.value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    // app.js fait un render() synchrone. Le MutationObserver rappellera enhance(),
    // qui poursuivra la file sur le nouveau DOM.
  }

  function closeAndCommit(root = document) {
    const values = currentFilterValues(root);
    const shouldCommit = pendingDirty;
    setOpen(false, root, { restoreFocus: !shouldCommit });

    if (!shouldCommit) return;
    commitQueue = values;
    pendingDirty = false;
    queueMicrotask(processCommitQueue);
  }

  function resetFilters(root = document) {
    for (const filter of FILTERS) {
      const element = root.querySelector(`#${filter.id}`);
      if (element) element.value = filter.defaultValue;
    }
    pendingDirty = true;
    updateTrigger(root);
  }

  function enhance() {
    const appMain = document.querySelector("#appMain");
    if (!appMain) return;
    const toolbar = appMain.querySelector(".toolbar.six-filters");

    if (!toolbar) {
      drawerOpen = false;
      pendingDirty = false;
      commitQueue = null;
      document.body.classList.remove("filter-drawer-open");
      return;
    }

    if (toolbar.dataset.filterDrawerReady === "1") {
      updateTrigger(appMain);
      if (commitQueue?.length) queueMicrotask(processCommitQueue);
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
        <button class="filter-drawer-close" type="button" aria-label="Fermer et appliquer les filtres">×</button>
      </div>
      <div class="filter-drawer-body"></div>
      <div class="filter-drawer-footer">
        <button class="button" type="button" data-filter-reset>Réinitialiser</button>
        <button class="button primary" type="button" data-filter-done>Afficher</button>
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
      pendingDirty = false;
      setOpen(true, appMain);
    });

    backdrop.addEventListener("click", () => closeAndCommit(appMain));
    drawer.querySelector(".filter-drawer-close")?.addEventListener("click", () => closeAndCommit(appMain));
    drawer.querySelector("[data-filter-done]")?.addEventListener("click", () => closeAndCommit(appMain));
    drawer.querySelector("[data-filter-reset]")?.addEventListener("click", () => resetFilters(appMain));

    drawer.addEventListener("change", event => {
      if (!FILTER_IDS.has(event.target?.id)) return;
      if (!drawerOpen) return;

      // Pendant l'utilisation du drawer, empêcher app.js de rerendre toute la page.
      // Les valeurs seront envoyées à app.js une seule fois lorsque le drawer ferme.
      event.stopPropagation();
      pendingDirty = true;
      updateTrigger(appMain);
    });

    updateTrigger(appMain);
    if (drawerOpen) setOpen(true, appMain, { restoreFocus: false });
    if (commitQueue?.length) queueMicrotask(processCommitQueue);
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && drawerOpen) closeAndCommit(document);
  });

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (!appMain) return;
    enhance();
    new MutationObserver(enhance).observe(appMain, { childList: true, subtree: true });
  });
})();
