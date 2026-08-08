(() => {
  const LOCATION_SELECTOR = 'input[name="salesLocation"], input[name="stockLocation"]';
  const AIM_PREFIX = /^\][A-Za-z][0-9]/;

  function stripAimPrefix(value) {
    const raw = String(value || "").trim();
    return AIM_PREFIX.test(raw) ? raw.slice(3) : raw;
  }

  function normalizeLocationCode(value) {
    let cleaned = stripAimPrefix(value)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim();

    if (!cleaned) return "";

    const compact = cleaned
      .toUpperCase()
      .replace(/[‐‑‒–—−_\s]+/g, "-");

    const alphaNumeric = compact.match(/^([A-Z]{1,4})-?(\d{1,6})$/);
    if (alphaNumeric) return `${alphaNumeric[1]}-${alphaNumeric[2]}`.slice(0, 120);

    const numericSection = compact.match(/^(\d{2})-?(\d{3})$/);
    if (numericSection) return `${numericSection[1]}-${numericSection[2]}`;

    return cleaned.slice(0, 120);
  }

  function normalizeScannedLocation(value) {
    const raw = String(value || "").trim();
    if (!AIM_PREFIX.test(raw)) return raw;
    return normalizeLocationCode(raw);
  }

  function normalizeLocationInput(event) {
    const input = event.target?.closest?.(LOCATION_SELECTOR);
    if (!input) return;
    const current = String(input.value || "").trim();
    if (!AIM_PREFIX.test(current)) return;

    const normalized = normalizeScannedLocation(current);
    if (normalized !== input.value) input.value = normalized;
  }

  window.restockLocationCodes = Object.freeze({
    stripAimPrefix,
    normalizeLocationCode,
    normalizeScannedLocation
  });

  document.addEventListener("input", normalizeLocationInput, true);
  document.addEventListener("change", normalizeLocationInput, true);
})();