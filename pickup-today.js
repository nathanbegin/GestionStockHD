(() => {
  const STORAGE_KEY = "restock_app_v1";
  const CLOSED_STATUSES = new Set(["rempli", "introuvable"]);

  function isSameLocalDay(value, reference = new Date()) {
    const date = new Date(value);
    return !Number.isNaN(date.getTime())
      && date.getFullYear() === reference.getFullYear()
      && date.getMonth() === reference.getMonth()
      && date.getDate() === reference.getDate();
  }

  function todayOpenItemIds() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
      return new Set(items
        .filter(item => item?.id
          && item.createdAt
          && !CLOSED_STATUSES.has(item.status)
          && isSameLocalDay(item.createdAt))
        .map(item => item.id));
    } catch {
      return new Set();
    }
  }

  function updateSelectedCount(form) {
    const picker = form.querySelector(".pickup-item-picker");
    const title = picker?.parentElement?.querySelector(":scope > .field-title");
    if (!picker || !title) return;
    const count = picker.querySelectorAll('input[name="pickupItemIds"]:checked').length;
    title.textContent = `Articles inclus (${count})`;
  }

  function enhancePickupEditor() {
    const form = document.querySelector("#pickupListForm");
    if (!form || form.dataset.todaySelectorReady === "true") return;

    const picker = form.querySelector(".pickup-item-picker");
    const title = picker?.parentElement?.querySelector(":scope > .field-title");
    if (!picker || !title) return;

    form.dataset.todaySelectorReady = "true";

    const controls = document.createElement("div");
    controls.className = "button-row pickup-today-actions";
    controls.style.margin = "8px 0 12px";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button compact secondary";

    const status = document.createElement("span");
    status.className = "small muted";
    status.setAttribute("aria-live", "polite");
    status.style.alignSelf = "center";

    const refreshButton = () => {
      const todayIds = todayOpenItemIds();
      const available = [...picker.querySelectorAll('input[name="pickupItemIds"]')]
        .filter(input => todayIds.has(input.value));
      button.textContent = `Inclure les articles ajoutés aujourd’hui (${available.length})`;
      button.disabled = available.length === 0;
      if (!available.length) status.textContent = "Aucun article ouvert ajouté aujourd’hui.";
    };

    button.addEventListener("click", () => {
      const todayIds = todayOpenItemIds();
      let added = 0;

      picker.querySelectorAll('input[name="pickupItemIds"]').forEach(input => {
        if (!todayIds.has(input.value) || input.checked) return;
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        added += 1;
      });

      updateSelectedCount(form);
      status.textContent = added
        ? `${added} article${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""} à la liste.`
        : "Tous les articles d’aujourd’hui sont déjà inclus.";
    });

    form.addEventListener("change", event => {
      if (event.target.matches('input[name="pickupItemIds"]')) updateSelectedCount(form);
    });

    controls.append(button, status);
    title.after(controls);
    updateSelectedCount(form);
    refreshButton();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) {
      new MutationObserver(enhancePickupEditor).observe(appMain, {
        childList: true,
        subtree: true
      });
    }
    enhancePickupEditor();
  });
})();
