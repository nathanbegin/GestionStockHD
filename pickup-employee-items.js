(() => {
  const STORAGE_KEY = "restock_app_v1";
  const CLOSED_STATUSES = new Set(["rempli", "introuvable"]);

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return parsed && parsed.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3600);
  }

  function updateIncludedCount(form) {
    const picker = form.querySelector(".pickup-item-picker");
    const title = picker?.closest(".full")?.querySelector(".field-title");
    if (!title) return;
    const count = form.querySelectorAll('input[name="pickupItemIds"]:checked').length;
    title.textContent = `Articles inclus (${count})`;
  }

  function installExplanation(form) {
    if (form.querySelector("#pickupEmployeeItemsHint")) return;
    const employeeField = form.querySelector('input[name="assignedEmployeeIds"]')?.closest(".assignment-field");
    if (!employeeField) return;
    const hint = document.createElement("p");
    hint.id = "pickupEmployeeItemsHint";
    hint.className = "field-hint pickup-employee-items-hint";
    hint.textContent = "Sélectionner un employé ajoute automatiquement ses articles ouverts attribués. La sélection manuelle demeure disponible.";
    const picker = employeeField.querySelector(".employee-picker");
    if (picker) picker.insertAdjacentElement("beforebegin", hint);
    else employeeField.appendChild(hint);
  }

  function enhanceCurrentEditor() {
    const form = document.querySelector("#pickupListForm");
    if (!form) return;
    installExplanation(form);
    updateIncludedCount(form);
  }

  function addItemsForSelectedEmployees(form) {
    const state = readState();
    if (!state) return;

    const selectedEmployeeIds = new Set(
      [...form.querySelectorAll('input[name="assignedEmployeeIds"]:checked')]
        .map(input => String(input.value || ""))
        .filter(Boolean)
    );
    if (!selectedEmployeeIds.size) return;

    const matchingItemIds = new Set(
      (Array.isArray(state.items) ? state.items : [])
        .filter(item => item?.id && !CLOSED_STATUSES.has(item.status))
        .filter(item => (Array.isArray(item.assignedEmployeeIds) ? item.assignedEmployeeIds : [])
          .some(employeeId => selectedEmployeeIds.has(String(employeeId))))
        .map(item => String(item.id))
    );

    let added = 0;
    for (const input of form.querySelectorAll('input[name="pickupItemIds"]')) {
      if (!matchingItemIds.has(String(input.value)) || input.checked) continue;
      input.checked = true;
      added += 1;
    }

    updateIncludedCount(form);
    if (added) {
      showToast(`${added} article${added > 1 ? "s ajoutés" : " ajouté"} selon les employés responsables`);
    } else {
      showToast("Tous les articles attribués à ces employés sont déjà inclus");
    }
  }

  document.addEventListener("change", event => {
    const target = event.target;
    const form = target.closest?.("#pickupListForm");
    if (!form) return;

    if (target.matches('input[name="assignedEmployeeIds"]') && target.checked) {
      addItemsForSelectedEmployees(form);
      return;
    }

    if (target.matches('input[name="pickupItemIds"]')) updateIncludedCount(form);
  });

  document.addEventListener("DOMContentLoaded", () => {
    enhanceCurrentEditor();
    const main = document.querySelector("#appMain");
    if (!main) return;
    new MutationObserver(() => enhanceCurrentEditor()).observe(main, { childList: true, subtree: true });
  });
})();
