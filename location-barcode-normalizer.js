(() => {
  const LOCATION_SELECTOR = 'input[name="salesLocation"], input[name="stockLocation"]';
  const AIM_PREFIX = /^\][A-Za-z][0-9]/;

  function normalizeScannedLocation(value) {
    const raw = String(value || "").trim();
    if (!AIM_PREFIX.test(raw)) return raw;

    let cleaned = raw.slice(3)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim();

    if (!cleaned) return "";

    const compact = cleaned
      .toUpperCase()
      .replace(/[‐‑‒–—−_\s]+/g, "-");
    const locationMatch = compact.match(/^([A-Z]{1,4})-?(\d{1,6})$/);

    if (locationMatch) cleaned = `${locationMatch[1]}-${locationMatch[2]}`;
    return cleaned.slice(0, 120);
  }

  function normalizeLocationInput(event) {
    const input = event.target?.closest?.(LOCATION_SELECTOR);
    if (!input) return;
    const current = String(input.value || "").trim();
    if (!AIM_PREFIX.test(current)) return;

    const normalized = normalizeScannedLocation(current);
    if (normalized !== input.value) input.value = normalized;
  }

  document.addEventListener("input", normalizeLocationInput, true);
  document.addEventListener("change", normalizeLocationInput, true);
})();