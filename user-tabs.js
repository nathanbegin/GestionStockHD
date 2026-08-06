(() => {
  const ACTIVE_TAB_KEY = "restock_user_management_active_tab_v1";
  const TAB_LABELS = {
    requests: "Demandes d’approbation",
    users: "Utilisateurs",
    presence: "Connexions",
    groups: "Groupes",
    create: "Créer un utilisateur",
    rejected: "Comptes refusés"
  };
  const TAB_ORDER = ["requests", "users", "presence", "groups", "create", "rejected"];
  let enhanceTimer = null;
  let enhancing = false;

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr-CA");
  }

  function directSections(management) {
    return [...management.children].filter(element => element.tagName === "SECTION");
  }

  function sectionWithHeading(management, headingText) {
    const target = normalizeText(headingText);
    return directSections(management).find(section =>
      [...section.querySelectorAll("h2")].some(heading => normalizeText(heading.textContent) === target)
    ) || null;
  }

  function collectPanels(management) {
    const panels = new Map();
    const add = (key, panel) => {
      if (!panel) return;
      if (!panels.has(key)) panels.set(key, []);
      if (!panels.get(key).includes(panel)) panels.get(key).push(panel);
    };

    add("presence", management.querySelector(":scope > #userPresencePanel"));
    add("create", directSections(management).find(section => section.querySelector(".um-create-user-form")) || null);
    add("requests", sectionWithHeading(management, "Demandes d’accès"));
    directSections(management)
      .filter(section => section.classList.contains("um-overview"))
      .forEach(section => add("groups", section));
    add("users", sectionWithHeading(management, "Gestion détaillée"));
    add("rejected", directSections(management).find(section =>
      section.querySelector(".um-reactivate-form") || normalizeText(section.querySelector("summary")?.textContent).startsWith("comptes refuses")
    ) || null);

    return panels;
  }

  function pendingCount(management) {
    return management.querySelectorAll(".um-approval-form").length;
  }

  function rejectedCount(management) {
    return management.querySelectorAll(".um-reactivate-form").length;
  }

  function readSavedTab() {
    try {
      return sessionStorage.getItem(ACTIVE_TAB_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveTab(key) {
    try {
      sessionStorage.setItem(ACTIVE_TAB_KEY, key);
    } catch { /* stockage non disponible */ }
  }

  function defaultTab(available, requests) {
    const saved = readSavedTab();
    if (available.includes(saved)) return saved;
    if (requests > 0 && available.includes("requests")) return "requests";
    if (available.includes("users")) return "users";
    if (available.includes("presence")) return "presence";
    return available[0] || "";
  }

  function badgeMarkup(count) {
    return `<span class="um-tab-badge${count ? " has-items" : ""}" aria-label="${count} demande${count === 1 ? "" : "s"} en attente">${count}</span>`;
  }

  function tabMarkup(key, requests, rejected) {
    const countText = key === "rejected" && rejected > 0 ? ` (${rejected})` : "";
    return `<button class="um-category-tab" type="button" role="tab" data-user-tab="${key}" aria-selected="false" tabindex="-1">
      <span>${TAB_LABELS[key]}${countText}</span>${key === "requests" ? badgeMarkup(requests) : ""}
    </button>`;
  }

  function applyActiveTab(management, key, { focus = false, scroll = false } = {}) {
    const tabs = [...management.querySelectorAll(":scope > .um-category-tabs [data-user-tab]")];
    const available = tabs.map(tab => tab.dataset.userTab);
    if (!available.includes(key)) key = available[0] || "";
    if (!key) return;

    management.querySelectorAll(":scope > [data-user-tab-panel]").forEach(panel => {
      const active = panel.dataset.userTabPanel === key;
      panel.hidden = !active;
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    });

    tabs.forEach(tab => {
      const active = tab.dataset.userTab === key;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus({ preventScroll: true });
      if (active && scroll) tab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });

    management.dataset.activeUserTab = key;
    saveTab(key);
  }

  function ensureTabs() {
    if (enhancing) return;
    const title = document.querySelector("#pageTitle")?.textContent?.trim();
    const management = document.querySelector("#userManagementV2");
    if (title !== "Utilisateurs" || !management) return;

    enhancing = true;
    try {
      const panels = collectPanels(management);
      const available = TAB_ORDER.filter(key => panels.get(key)?.length);
      if (!available.length) return;

      for (const [key, elements] of panels.entries()) {
        elements.forEach((panel, index) => {
          panel.dataset.userTabPanel = key;
          panel.setAttribute("role", "tabpanel");
          if (!panel.id) panel.id = `user-tab-panel-${key}-${index + 1}`;
        });
      }

      const requests = pendingCount(management);
      const rejected = rejectedCount(management);
      const signature = `${available.join("|")}:${requests}:${rejected}`;
      let tabs = management.querySelector(":scope > .um-category-tabs");

      if (!tabs || tabs.dataset.signature !== signature) {
        const previous = management.dataset.activeUserTab || readSavedTab();
        const nextTabs = document.createElement("nav");
        nextTabs.className = "um-category-tabs";
        nextTabs.setAttribute("role", "tablist");
        nextTabs.setAttribute("aria-label", "Catégories de gestion des utilisateurs");
        nextTabs.dataset.signature = signature;
        nextTabs.innerHTML = available.map(key => tabMarkup(key, requests, rejected)).join("");
        if (tabs) tabs.replaceWith(nextTabs);
        else management.prepend(nextTabs);
        tabs = nextTabs;
        const active = available.includes(previous) ? previous : defaultTab(available, requests);
        applyActiveTab(management, active);
      } else {
        if (management.firstElementChild !== tabs) management.prepend(tabs);
        const active = available.includes(management.dataset.activeUserTab)
          ? management.dataset.activeUserTab
          : defaultTab(available, requests);
        applyActiveTab(management, active);
      }
    } finally {
      enhancing = false;
    }
  }

  function scheduleEnhance(delay = 30) {
    clearTimeout(enhanceTimer);
    enhanceTimer = window.setTimeout(ensureTabs, delay);
  }

  function installStyles() {
    if (document.querySelector("#userCategoryTabStyles")) return;
    const style = document.createElement("style");
    style.id = "userCategoryTabStyles";
    style.textContent = `
      #userManagementV2 > .um-category-tabs {
        position: relative;
        z-index: 2;
        display: flex;
        gap: .55rem;
        margin: 0 0 1.1rem;
        padding: .5rem;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        scrollbar-width: thin;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--surface);
        box-shadow: 0 5px 18px rgba(45, 36, 31, .06);
      }
      #userManagementV2 .um-category-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: .48rem;
        min-height: 44px;
        padding: .68rem .9rem;
        flex: 0 0 auto;
        border: 1px solid transparent;
        border-radius: 13px;
        background: transparent;
        color: var(--text);
        font: inherit;
        font-size: .9rem;
        font-weight: 800;
        white-space: nowrap;
        cursor: pointer;
      }
      #userManagementV2 .um-category-tab:hover {
        border-color: rgba(249, 99, 2, .25);
        background: rgba(249, 99, 2, .07);
      }
      #userManagementV2 .um-category-tab.active {
        border-color: #f96302;
        background: #f96302;
        color: #fff;
        box-shadow: 0 5px 14px rgba(249, 99, 2, .22);
      }
      #userManagementV2 .um-category-tab:focus-visible {
        outline: 3px solid rgba(249, 99, 2, .28);
        outline-offset: 2px;
      }
      #userManagementV2 .um-tab-badge {
        display: inline-grid;
        place-items: center;
        min-width: 1.45rem;
        height: 1.45rem;
        padding: 0 .32rem;
        border-radius: 999px;
        background: #e6ddd7;
        color: #5f544e;
        font-size: .76rem;
        font-weight: 900;
        line-height: 1;
      }
      #userManagementV2 .um-tab-badge.has-items {
        background: #c84400;
        color: #fff;
        box-shadow: 0 0 0 3px rgba(200, 68, 0, .12);
      }
      #userManagementV2 .um-category-tab.active .um-tab-badge {
        background: #fff;
        color: #c84400;
        box-shadow: none;
      }
      #userManagementV2 > [data-user-tab-panel][hidden] {
        display: none !important;
      }
      @media (max-width: 640px) {
        #userManagementV2 > .um-category-tabs {
          margin-inline: -.2rem;
          padding: .42rem;
          border-radius: 15px;
        }
        #userManagementV2 .um-category-tab {
          min-height: 42px;
          padding: .62rem .78rem;
          font-size: .84rem;
        }
      }
    `;
    document.head.append(style);
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    const appMain = document.querySelector("#appMain");
    const pageTitle = document.querySelector("#pageTitle");
    if (!appMain || !pageTitle) return;

    new MutationObserver(() => scheduleEnhance()).observe(appMain, { childList: true, subtree: true });
    new MutationObserver(() => scheduleEnhance()).observe(pageTitle, { childList: true, characterData: true, subtree: true });

    appMain.addEventListener("click", event => {
      const tab = event.target.closest("[data-user-tab]");
      if (!tab) return;
      const management = tab.closest("#userManagementV2");
      if (!management) return;
      event.preventDefault();
      applyActiveTab(management, tab.dataset.userTab, { scroll: true });
    });

    appMain.addEventListener("keydown", event => {
      const tab = event.target.closest("[data-user-tab]");
      if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const management = tab.closest("#userManagementV2");
      const tabs = [...management.querySelectorAll(":scope > .um-category-tabs [data-user-tab]")];
      const currentIndex = tabs.indexOf(tab);
      let nextIndex = currentIndex;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      event.preventDefault();
      applyActiveTab(management, tabs[nextIndex].dataset.userTab, { focus: true, scroll: true });
    });

    ensureTabs();
  });
})();
