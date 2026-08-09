(() => {
  let drawerOpen = false;
  let commitQueue = null;
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

  function sourceSelect(root, id) {
    return root.querySelector(`#${id}`);
  }

  function draftSelect(root, id) {
    return root.querySelector(`[data-filter-source="${id}"]`);
  }

  function activeCount(root = document, { useDraft = drawerOpen } = {}) {
    return FILTERS.reduce((count, filter) => {
      const element = useDraft
        ? draftSelect(root, filter.id) || sourceSelect(root, filter.id)
        : sourceSelect(root, filter.id);
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

    if (!drawerOpen && restoreFocus && lastTrigger?.isConnected) {
      lastTrigger.focus({ preventScroll: true });
    }
  }

  function syncDraftsFromSources(root = document) {
    for (const filter of FILTERS) {
      const source = sourceSelect(root, filter.id);
      const draft = draftSelect(root, filter.id);
      if (source && draft) draft.value = source.value;
    }
    updateTrigger(root);
  }

  function collectChangedDrafts(root = document) {
    const changes = [];
    for (const filter of FILTERS) {
      const source = sourceSelect(root, filter.id);
      const draft = draftSelect(root, filter.id);
      if (!source || !draft || source.value === draft.value) continue;
      changes.push({ id: filter.id, value: draft.value });
    }
    return changes;
  }

  function processCommitQueue() {
    if (!commitQueue?.length) {
      commitQueue = null;
      updateTrigger(document);
      return;
    }

    const next = commitQueue.shift();
    const source = document.querySelector(`#${next.id}`);
    if (!source) {
      queueMicrotask(processCommitQueue);
      return;
    }

    source.value = next.value;
    source.dispatchEvent(new Event("change", { bubbles: true }));
    // app.js reconstruit la page de façon synchrone. Le MutationObserver
    // reprend la file sur le nouveau DOM après ce rendu.
  }

  function applyAndClose(root = document) {
    const changes = collectChangedDrafts(root);
    setOpen(false, root, { restoreFocus: changes.length === 0 });
    if (!changes.length) return;
    commitQueue = changes;
    queueMicrotask(processCommitQueue);
  }

  function resetDrafts(root = document) {
    for (const filter of FILTERS) {
      const draft = draftSelect(root, filter.id);
      if (draft) draft.value = filter.defaultValue;
    }
    updateTrigger(root);
  }

  function makeDraftField(source, definition) {
    const field = document.createElement("label");
    field.className = "filter-drawer-field";

    const caption = document.createElement("span");
    caption.textContent = definition.label;

    const draft = source.cloneNode(true);
    draft.id = `drawer-${definition.id}`;
    draft.removeAttribute("name");
    draft.dataset.filterSource = definition.id;
    draft.value = source.value;

    field.append(caption, draft);
    return field;
  }

  function enhance() {
    const appMain = document.querySelector("#appMain");
    if (!appMain) return;
    const toolbar = appMain.querySelector(".toolbar.six-filters");

    if (!toolbar) {
      drawerOpen = false;
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
    trigger.setAttribute("aria-expanded", "false");
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
      const source = sourceSelect(toolbar, definition.id);
      if (source) body.appendChild(makeDraftField(source, definition));
    }

    toolbar.parentElement?.insertBefore(backdrop, toolbar.nextSibling);
    toolbar.parentElement?.insertBefore(drawer, backdrop.nextSibling);

    trigger.addEventListener("click", () => {
      lastTrigger = trigger;
      syncDraftsFromSources(appMain);
      setOpen(true, appMain, { restoreFocus: false });
    });

    backdrop.addEventListener("click", () => applyAndClose(appMain));
    drawer.querySelector(".filter-drawer-close")?.addEventListener("click", () => applyAndClose(appMain));
    drawer.querySelector("[data-filter-done]")?.addEventListener("click", () => applyAndClose(appMain));
    drawer.querySelector("[data-filter-reset]")?.addEventListener("click", () => resetDrafts(appMain));

    drawer.addEventListener("change", event => {
      if (!event.target?.dataset?.filterSource) return;
      // Les copies locales ne sont pas les vrais filtres de app.js : aucun
      // rendu de la page n'est déclenché pendant l'utilisation du drawer.
      updateTrigger(appMain);
    });

    updateTrigger(appMain);
    if (commitQueue?.length) queueMicrotask(processCommitQueue);
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && drawerOpen) applyAndClose(document);
  });

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (!appMain) return;
    enhance();
    new MutationObserver(enhance).observe(appMain, { childList: true, subtree: true });
  });
})();
