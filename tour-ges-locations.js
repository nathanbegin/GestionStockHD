(() => {
  const STORAGE_KEY = "restock_app_v1";
  let refreshTimer = null;

  function normalizeSku(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeLocations(values) {
    const locations = [];
    const seen = new Set();

    for (const raw of Array.isArray(values) ? values : []) {
      const value = String(raw || "").trim().replace(/\s+/g, " ");
      const key = value.toLocaleLowerCase("fr-CA");
      if (!value || seen.has(key)) continue;
      seen.add(key);
      locations.push(value);
    }

    return locations;
  }

  function readItems() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return Array.isArray(snapshot?.items) ? snapshot.items : [];
    } catch {
      return [];
    }
  }

  function itemForTourCard(card) {
    const sku = normalizeSku(card.querySelector(".sku")?.textContent);
    if (!sku) return null;
    return readItems().find(item => normalizeSku(item?.sku) === sku) || null;
  }

  function createLocationGroup(label, values) {
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
    return block;
  }

  function enhanceTourCard(card) {
    const primaryLocations = card.querySelector(".location-grid:not(.tour-ges-locations)");
    if (!primaryLocations) return;

    const item = itemForTourCard(card);
    const groups = item ? [
      ["Emplacements GES+", normalizeLocations(item.gesPlusLocations)],
      ["Emplacements GES palettes", normalizeLocations(item.gesPalletLocations)]
    ].filter(([, values]) => values.length) : [];

    const signature = JSON.stringify(groups);
    let panel = card.querySelector(".tour-ges-locations");

    if (!groups.length) {
      panel?.remove();
      delete card.dataset.tourGesSignature;
      return;
    }

    if (panel && card.dataset.tourGesSignature === signature) return;

    if (!panel) {
      panel = document.createElement("div");
      panel.className = "location-grid top-gap tour-ges-locations";
      panel.setAttribute("aria-label", "Emplacements GES de l’article");
      primaryLocations.insertAdjacentElement("afterend", panel);
    }

    panel.replaceChildren(...groups.map(([label, values]) => createLocationGroup(label, values)));
    card.dataset.tourGesSignature = signature;
  }

  function enhanceVisibleTour() {
    document.querySelectorAll(".tour-card").forEach(enhanceTourCard);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceVisibleTour, 0);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(scheduleRefresh).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
    enhanceVisibleTour();
  });

  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY) scheduleRefresh();
  });
})();
