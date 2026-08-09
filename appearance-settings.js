(() => {
  const STORAGE_KEY = "restock_appearance_v1";
  const APP_VERSION = "v5-69";
  const PALETTES = ["orange", "blue", "green", "purple"];
  const BRAND_COLORS = {
    orange: "#f96302",
    blue: "#2563eb",
    green: "#16834f",
    purple: "#7c3aed"
  };

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {};
      return {
        palette: PALETTES.includes(parsed.palette) ? parsed.palette : "orange",
        dark: Boolean(parsed.dark)
      };
    } catch {
      return { palette: "orange", dark: false };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function applySettings(settings = loadSettings()) {
    const root = document.documentElement;
    root.dataset.palette = settings.palette;
    root.dataset.theme = settings.dark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", BRAND_COLORS[settings.palette] || BRAND_COLORS.orange);
  }

  function paletteOption(value, label, selected) {
    return `<label class="appearance-palette-option"><input type="radio" name="appPalette" value="${value}" ${selected === value ? "checked" : ""}><span class="appearance-swatch ${value}" aria-hidden="true"></span><strong>${label}</strong></label>`;
  }

  function ensureSettingsCard() {
    const title = document.querySelector("#pageTitle")?.textContent?.trim();
    if (title !== "Réglages") return;
    const grid = document.querySelector("#appMain .settings-grid");
    if (!grid || grid.querySelector("#appearanceSettingsCard")) return;

    const settings = loadSettings();
    const card = document.createElement("article");
    card.id = "appearanceSettingsCard";
    card.className = "card appearance-settings-card";
    card.innerHTML = `
      <h2>Apparence</h2>
      <p class="muted small">Personnalise les couleurs de l’application sur cet appareil.</p>
      <div class="appearance-palette-grid" role="radiogroup" aria-label="Palette de couleurs">
        ${paletteOption("orange", "Orange", settings.palette)}
        ${paletteOption("blue", "Bleu", settings.palette)}
        ${paletteOption("green", "Vert", settings.palette)}
        ${paletteOption("purple", "Violet", settings.palette)}
      </div>
      <div class="appearance-mode-row">
        <div><strong>Mode nuit</strong><small>Fond sombre et contraste adapté pour une utilisation en faible éclairage.</small></div>
        <label class="appearance-switch" aria-label="Activer le mode nuit"><input type="checkbox" id="appDarkMode" ${settings.dark ? "checked" : ""}><span aria-hidden="true"></span></label>
      </div>`;

    const firstCard = grid.querySelector(":scope > .card");
    if (firstCard) firstCard.insertAdjacentElement("afterend", card);
    else grid.prepend(card);
  }

  function ensureVersionCard() {
    const title = document.querySelector("#pageTitle")?.textContent?.trim();
    if (title !== "Réglages") return;
    const grid = document.querySelector("#appMain .settings-grid");
    if (!grid || grid.querySelector("#appVersionCard")) return;

    const card = document.createElement("article");
    card.id = "appVersionCard";
    card.className = "card";
    card.innerHTML = `
      <h2>Application</h2>
      <p class="small"><strong>Version de l’application :</strong> ${APP_VERSION}</p>`;
    grid.append(card);
  }

  document.addEventListener("change", event => {
    if (event.target.matches('input[name="appPalette"]')) {
      const settings = loadSettings();
      settings.palette = event.target.value;
      saveSettings(settings);
      applySettings(settings);
      return;
    }

    if (event.target.id === "appDarkMode") {
      const settings = loadSettings();
      settings.dark = event.target.checked;
      saveSettings(settings);
      applySettings(settings);
    }
  });

  applySettings();
  document.addEventListener("DOMContentLoaded", () => {
    applySettings();
    ensureSettingsCard();
    ensureVersionCard();
    window.setInterval(() => {
      ensureSettingsCard();
      ensureVersionCard();
    }, 350);
  });
})();