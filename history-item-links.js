(() => {
  const STORAGE_KEY = "restock_app_v1";
  const TYPE_LABELS = {
    item_added: "Ajout",
    item_updated: "Modification",
    status_changed: "Ramassage",
    item_deleted: "Suppression",
    assignment_changed: "Attribution",
    pickup_created: "Liste créée",
    pickup_updated: "Liste modifiée",
    pickup_deleted: "Liste supprimée"
  };
  let enhanceScheduled = false;

  function loadState() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return state && typeof state === "object" ? state : { items: [], history: [] };
    } catch {
      return { items: [], history: [] };
    }
  }

  function skuDigits(value) {
    const text = String(value || "").replace(/[–—−]/g, "-");
    const match = text.match(/(?:^|\D)((?:1000|1001)(?:[\s-]*\d){6})(?!\d)/);
    return match ? match[1].replace(/\D/g, "") : "";
  }

  function formatSku(value) {
    const digits = skuDigits(value);
    return digits ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}` : "";
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  function fallbackTitle(event) {
    return ({
      item_added: "Article ajouté",
      item_updated: "Article modifié",
      status_changed: "Statut de l’article mis à jour",
      item_deleted: "Article supprimé",
      assignment_changed: "Attribution de l’article modifiée"
    })[event?.type] || event?.message || TYPE_LABELS[event?.type] || "Activité";
  }

  function eventSku(event, item) {
    return formatSku(item?.sku || event?.details?.sku || event?.message || "");
  }

  function findEventForRow(row, state) {
    const label = row.querySelector(".history-meta .tag")?.textContent?.trim() || "";
    const shownDate = row.querySelector(".history-meta .tiny")?.textContent?.trim() || "";
    const originalTitle = row.querySelector("h3")?.textContent?.trim() || "";
    const shownSku = skuDigits(row.querySelector(".sku")?.textContent || originalTitle);

    const candidates = (state.history || []).filter(event => {
      if ((TYPE_LABELS[event.type] || "Activité") !== label) return false;
      if (formatDate(event.createdAt) !== shownDate) return false;
      const item = (state.items || []).find(entry => entry.id === event.itemId);
      const candidateSku = skuDigits(item?.sku || event.details?.sku || event.message);
      return !shownSku || !candidateSku || shownSku === candidateSku;
    });

    return candidates.find(event => String(event.message || "").trim() === originalTitle) || candidates[0] || null;
  }

  function ensureSkuLine(row, sku) {
    if (!sku || row.querySelector(".sku")) return;
    const title = row.querySelector("h3");
    if (!title) return;
    const line = document.createElement("p");
    line.className = "sku";
    line.textContent = sku;
    title.insertAdjacentElement("afterend", line);
  }

  function enhanceHistoryRows() {
    const state = loadState();
    const items = Array.isArray(state.items) ? state.items : [];

    document.querySelectorAll(".history-row:not([data-history-description-ready])").forEach(row => {
      const event = findEventForRow(row, state);
      if (!event) return;

      const item = event.itemId ? items.find(entry => entry.id === event.itemId) : null;
      const title = row.querySelector("h3");
      const description = String(item?.name || event.details?.productName || event.details?.name || "").trim();
      const sku = eventSku(event, item);

      if (title) title.textContent = description || fallbackTitle(event);
      ensureSkuLine(row, sku);
      row.dataset.historyDescriptionReady = "true";
      row.dataset.historyEventId = event.id || "";

      if (event.type === "item_added" && item) {
        row.dataset.historyItemId = item.id;
        row.dataset.historyItemSku = formatSku(item.sku);
        row.classList.add("history-row-link");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.setAttribute("aria-label", `Ouvrir l’article ${description || sku}`);
        row.title = "Ouvrir cet article dans l’onglet Articles";
      }
    });
  }

  function scheduleEnhancement() {
    if (enhanceScheduled) return;
    enhanceScheduled = true;
    window.requestAnimationFrame(() => {
      enhanceScheduled = false;
      enhanceHistoryRows();
    });
  }

  function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function setSelectFilter(id, value) {
    const select = document.querySelector(id);
    if (!select || ![...select.options].some(option => option.value === value)) return;
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(60);
  }

  async function openArticle(row) {
    const sku = row.dataset.historyItemSku || "";
    if (!sku) return;

    document.querySelector('.bottom-nav [data-nav="lists"]')?.click();
    await wait(80);

    const search = document.querySelector("#filterSearch");
    if (!search) return;
    search.value = sku;
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(230);

    await setSelectFilter("#filterList", "all");
    await setSelectFilter("#filterDepartment", "all");
    await setSelectFilter("#filterEmployee", "all");
    await setSelectFilter("#filterStatus", "all");
    await setSelectFilter("#filterPriority", "all");
    await wait(220);

    const targetDigits = skuDigits(sku);
    const card = [...document.querySelectorAll(".item-card")].find(article =>
      skuDigits(article.querySelector(".sku")?.textContent) === targetDigits
    );
    if (!card) return;

    card.classList.add("history-item-target");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => card.classList.remove("history-item-target"), 2600);
  }

  function installStyles() {
    if (document.querySelector("#historyItemLinksStyles")) return;
    const style = document.createElement("style");
    style.id = "historyItemLinksStyles";
    style.textContent = `
      .history-row-link { cursor: pointer; transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
      .history-row-link:hover { transform: translateY(-1px); border-color: rgba(249,99,2,.38); box-shadow: var(--shadow); }
      .history-row-link:focus-visible { outline: 3px solid rgba(249,99,2,.30); outline-offset: 3px; }
      .item-card.history-item-target { animation: historyItemTarget 2.6s ease; }
      @keyframes historyItemTarget {
        0%, 100% { box-shadow: 0 3px 12px rgba(92,46,18,.05); }
        18%, 72% { border-color: var(--brand); box-shadow: 0 0 0 4px rgba(249,99,2,.18), var(--shadow); }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("click", event => {
    const row = event.target.closest(".history-row-link");
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    void openArticle(row);
  });

  document.addEventListener("keydown", event => {
    const row = event.target.closest(".history-row-link");
    if (!row || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    void openArticle(row);
  });

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    const main = document.querySelector("#appMain");
    if (main) new MutationObserver(scheduleEnhancement).observe(main, { childList: true, subtree: true });
    scheduleEnhancement();
  });
})();
