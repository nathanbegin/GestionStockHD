(() => {
  const STORAGE_KEY = "restock_app_v1";
  const MAX_LOCATIONS = 20;
  const MAX_LENGTH = 80;
  const FORM_SELECTOR = "#itemForm, #scanForm";
  const pendingBySku = new Map();
  const formControllers = new WeakMap();
  let refreshTimer = null;

  function normalizeSku(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeLocation(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, MAX_LENGTH);
  }

  function normalizeLocations(values) {
    const result = [];
    const seen = new Set();
    for (const raw of Array.isArray(values) ? values : []) {
      const value = normalizeLocation(raw);
      const key = value.toLocaleLowerCase("fr-CA");
      if (!value || seen.has(key)) continue;
      seen.add(key);
      result.push(value);
      if (result.length >= MAX_LOCATIONS) break;
    }
    return result;
  }

  function readSnapshot() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return snapshot && Array.isArray(snapshot.items) ? snapshot : null;
    } catch {
      return null;
    }
  }

  function itemForForm(form, snapshot = readSnapshot()) {
    if (!snapshot) return null;
    const sku = normalizeSku(form.querySelector('[name="sku"]')?.value);
    return sku ? snapshot.items.find(item => normalizeSku(item?.sku) === sku) || null : null;
  }

  function locationsFromItem(item) {
    return {
      gesPlusLocations: normalizeLocations(item?.gesPlusLocations),
      gesPalletLocations: normalizeLocations(item?.gesPalletLocations)
    };
  }

  function makeTagField({ key, title, placeholder, values }) {
    const field = document.createElement("div");
    field.className = "full ges-location-field";
    field.dataset.gesLocationKey = key;
    field.innerHTML = `
      <div class="field-title">${title} <span class="field-hint">(facultatif)</span></div>
      <div class="ges-location-entry">
        <input class="ges-location-input" type="text" maxlength="${MAX_LENGTH}" autocomplete="off" placeholder="${placeholder}">
        <button class="button compact secondary ges-location-add" type="button">Ajouter</button>
      </div>
      <div class="ges-location-tags" aria-live="polite"></div>
      <span class="field-hint">Ajoute jusqu’à ${MAX_LOCATIONS} emplacements. Utilise le × pour retirer une étiquette.</span>
    `;

    const state = normalizeLocations(values);
    const input = field.querySelector(".ges-location-input");
    const addButton = field.querySelector(".ges-location-add");
    const tags = field.querySelector(".ges-location-tags");

    function render() {
      tags.replaceChildren(...state.map((value, index) => {
        const tag = document.createElement("span");
        tag.className = "ges-location-tag";

        const text = document.createElement("span");
        text.textContent = value;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ges-location-remove";
        remove.dataset.index = String(index);
        remove.setAttribute("aria-label", `Retirer ${value}`);
        remove.textContent = "×";

        tag.append(text, remove);
        return tag;
      }));
      addButton.disabled = state.length >= MAX_LOCATIONS;
    }

    function addDraft() {
      const value = normalizeLocation(input.value);
      if (!value) return false;
      const duplicate = state.some(existing => existing.localeCompare(value, "fr-CA", { sensitivity: "base" }) === 0);
      if (!duplicate && state.length < MAX_LOCATIONS) state.push(value);
      input.value = "";
      render();
      return !duplicate;
    }

    addButton.addEventListener("click", addDraft);
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      addDraft();
    });
    tags.addEventListener("click", event => {
      const remove = event.target.closest(".ges-location-remove");
      if (!remove) return;
      const index = Number(remove.dataset.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.length) return;
      state.splice(index, 1);
      render();
      input.focus({ preventScroll: true });
    });

    render();
    return { field, state, addDraft };
  }

  function enhanceForm(form) {
    if (formControllers.has(form)) return;
    const stockInput = form.querySelector('[name="stockLocation"]');
    const stockLabel = stockInput?.closest("label");
    if (!stockLabel) return;

    const current = locationsFromItem(itemForForm(form));
    const plus = makeTagField({
      key: "gesPlusLocations",
      title: "Emplacements GES+",
      placeholder: "Ex. GES+ A12",
      values: current.gesPlusLocations
    });
    const pallets = makeTagField({
      key: "gesPalletLocations",
      title: "Emplacements GES palettes",
      placeholder: "Ex. Palette GES P-04",
      values: current.gesPalletLocations
    });

    stockLabel.after(plus.field, pallets.field);
    const controller = { plus, pallets };
    formControllers.set(form, controller);

    form.addEventListener("click", event => {
      if (!event.target.closest(".article-wizard-next")) return;
      const visibleField = form.querySelector('.ges-location-field:not([hidden])');
      const key = visibleField?.dataset.gesLocationKey;
      if (key === "gesPlusLocations") plus.addDraft();
      if (key === "gesPalletLocations") pallets.addDraft();
    }, true);
  }

  function collectFormLocations(form) {
    const controller = formControllers.get(form);
    if (!controller) return { gesPlusLocations: [], gesPalletLocations: [] };
    controller.plus.addDraft();
    controller.pallets.addDraft();
    return {
      gesPlusLocations: normalizeLocations(controller.plus.state),
      gesPalletLocations: normalizeLocations(controller.pallets.state)
    };
  }

  function mergeStoredLocations(nextSnapshot, previousSnapshot) {
    if (!nextSnapshot || !Array.isArray(nextSnapshot.items)) return nextSnapshot;
    const previousById = new Map((previousSnapshot?.items || []).filter(item => item?.id).map(item => [item.id, item]));
    const previousBySku = new Map((previousSnapshot?.items || []).map(item => [normalizeSku(item?.sku), item]));

    for (const item of nextSnapshot.items) {
      const sku = normalizeSku(item?.sku);
      const previous = previousById.get(item?.id) || previousBySku.get(sku);
      const pending = pendingBySku.get(sku);

      if (pending) {
        item.gesPlusLocations = normalizeLocations(pending.gesPlusLocations);
        item.gesPalletLocations = normalizeLocations(pending.gesPalletLocations);
        pendingBySku.delete(sku);
      } else {
        item.gesPlusLocations = normalizeLocations(
          Array.isArray(item.gesPlusLocations) ? item.gesPlusLocations : previous?.gesPlusLocations
        );
        item.gesPalletLocations = normalizeLocations(
          Array.isArray(item.gesPalletLocations) ? item.gesPalletLocations : previous?.gesPalletLocations
        );
      }
    }
    return nextSnapshot;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceVisibleContent, 0);
  }

  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patchedSetItem(key, value) {
    if (this === localStorage && key === STORAGE_KEY && typeof value === "string") {
      try {
        const previous = JSON.parse(Storage.prototype.getItem.call(this, key) || "null");
        const next = JSON.parse(value);
        value = JSON.stringify(mergeStoredLocations(next, previous));
      } catch {
        // Conserve la valeur originale si le stockage n'est pas un état JSON valide.
      }
    }
    const result = nativeSetItem.call(this, key, value);
    if (this === localStorage && key === STORAGE_KEY) scheduleRefresh();
    return result;
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init = {}) {
    try {
      const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
      const url = new URL(requestUrl, window.location.origin);
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      if (url.pathname === "/api/sync" && method === "POST" && typeof init.body === "string") {
        const payload = JSON.parse(init.body);
        const stored = readSnapshot();
        if (payload?.snapshot && stored) mergeStoredLocations(payload.snapshot, stored);
        init = { ...init, body: JSON.stringify(payload) };
      }
    } catch {
      // La requête originale demeure inchangée.
    }
    return originalFetch(input, init);
  };

  function renderCardLocations(card, item) {
    const locationGrid = card.querySelector(".location-grid");
    if (!locationGrid) return;

    const groups = [
      ["GES+", normalizeLocations(item?.gesPlusLocations)],
      ["GES palettes", normalizeLocations(item?.gesPalletLocations)]
    ];
    const signature = JSON.stringify(groups);
    if (card.dataset.gesLocationsSignature === signature) return;
    card.dataset.gesLocationsSignature = signature;
    locationGrid.querySelectorAll(".ges-location-display").forEach(element => element.remove());

    for (const [label, values] of groups) {
      if (!values.length) continue;
      const block = document.createElement("div");
      block.className = "ges-location-display";

      const heading = document.createElement("strong");
      heading.textContent = label;

      const tags = document.createElement("div");
      tags.className = "ges-location-display-tags";
      for (const value of values) {
        const tag = document.createElement("span");
        tag.className = "ges-location-display-tag";
        tag.textContent = value;
        tags.append(tag);
      }

      block.append(heading, tags);
      locationGrid.append(block);
    }
  }

  function enhanceCards() {
    const snapshot = readSnapshot();
    if (!snapshot) return;
    const byId = new Map(snapshot.items.filter(item => item?.id).map(item => [item.id, item]));
    const bySku = new Map(snapshot.items.map(item => [normalizeSku(item?.sku), item]));

    document.querySelectorAll(".item-card").forEach(card => {
      const itemId = card.querySelector("[data-id]")?.dataset.id;
      const sku = normalizeSku(card.querySelector(".sku")?.textContent);
      const item = byId.get(itemId) || bySku.get(sku);
      if (item) renderCardLocations(card, item);
    });
  }

  function enhanceVisibleContent() {
    document.querySelectorAll(FORM_SELECTOR).forEach(enhanceForm);
    enhanceCards();
  }

  document.addEventListener("submit", event => {
    const form = event.target;
    if (!form.matches?.(FORM_SELECTOR)) return;
    enhanceForm(form);
    const sku = normalizeSku(form.querySelector('[name="sku"]')?.value);
    if (!sku) return;
    pendingBySku.set(sku, collectFormLocations(form));
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(scheduleRefresh).observe(appMain, { childList: true, subtree: true });
    }
    enhanceVisibleContent();
  });
})();
