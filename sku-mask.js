(() => {
  const SKU_SELECTOR = 'input[name="sku"]';
  let refreshTimer = null;

  function skuDigits(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 10);
  }

  function formatPartialSku(value) {
    const digits = skuDigits(value);
    const groups = [];
    if (digits.length) groups.push(digits.slice(0, 4));
    if (digits.length > 4) groups.push(digits.slice(4, 7));
    if (digits.length > 7) groups.push(digits.slice(7, 10));
    return groups.join(" ");
  }

  function formatInput(input) {
    if (!input?.matches?.(SKU_SELECTOR)) return;
    const formatted = formatPartialSku(input.value);
    if (input.value !== formatted) input.value = formatted;
  }

  function enhanceInput(input) {
    if (!input?.matches?.(SKU_SELECTOR)) return;
    input.maxLength = 12;
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.placeholder = "1000 000 000";
    input.setAttribute("aria-label", "Numéro d’article, 10 chiffres maximum");
    formatInput(input);

    const host = input.closest("label");
    const hint = host?.querySelector(".field-hint");
    if (hint && hint.dataset.skuMaskHint !== "true") {
      hint.dataset.skuMaskHint = "true";
      hint.textContent = "10 chiffres maximum · format automatique 1000 000 000.";
    }
  }

  function enhanceVisibleInputs() {
    document.querySelectorAll(SKU_SELECTOR).forEach(enhanceInput);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(enhanceVisibleInputs, 0);
  }

  document.addEventListener("input", event => {
    const input = event.target?.closest?.(SKU_SELECTOR);
    if (!input) return;
    formatInput(input);
    input.setCustomValidity("");
  }, true);

  document.addEventListener("paste", event => {
    const input = event.target?.closest?.(SKU_SELECTOR);
    if (!input) return;
    const text = event.clipboardData?.getData("text") || "";
    if (!text) return;
    event.preventDefault();
    input.value = formatPartialSku(text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    if (appMain) new MutationObserver(scheduleRefresh).observe(appMain, { childList: true, subtree: true });
    enhanceVisibleInputs();
  });
})();
