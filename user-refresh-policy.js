(() => {
  const GENERAL_REFRESH_INTERVAL = 5 * 60 * 1000;
  const DEFERRED_REFRESH_DELAY = 30 * 1000;
  let savedManagement = null;
  let refreshTimer = null;
  let automaticRefresh = false;
  let formDirty = false;
  let savedScrollY = 0;
  let savedTab = "";
  let restoring = false;

  function storedAccessToken() {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith("sb-") || !key.includes("auth-token")) continue;
        try {
          const parsed = JSON.parse(storage.getItem(key) || "null");
          const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
          if (token) return token;
        } catch { /* clé sans rapport */ }
      }
    }
    return "";
  }

  function onUsersPage() {
    return document.querySelector("#pageTitle")?.textContent?.trim() === "Utilisateurs";
  }

  function activeTab(management = savedManagement) {
    return management?.dataset.activeUserTab
      || management?.querySelector(".um-category-tab.active")?.dataset.userTab
      || "";
  }

  function scheduleRefresh(delay = GENERAL_REFRESH_INTERVAL) {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(runGeneralRefresh, delay);
  }

  function userIsEditing(management) {
    if (!management) return false;
    if (formDirty || management.querySelector('form[aria-busy="true"]')) return true;
    const focused = document.activeElement;
    return Boolean(focused && management.contains(focused) && focused.matches(
      "input, select, textarea, [contenteditable='true']"
    ));
  }

  async function refreshRequestBadgeOnly() {
    const management = document.querySelector("#userManagementV2");
    const badge = management?.querySelector('[data-user-tab="requests"] .um-tab-badge');
    const token = storedAccessToken();
    if (!management || !badge || !token || !navigator.onLine) return;

    try {
      const response = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const count = (Array.isArray(data.users) ? data.users : [])
        .filter(user => user.approvalStatus === "pending").length;
      badge.textContent = String(count);
      badge.classList.toggle("has-items", count > 0);
      badge.setAttribute("aria-label", `${count} demande${count === 1 ? "" : "s"} en attente`);
    } catch { /* la prochaine actualisation réessaiera */ }
  }

  function restoreExperience(management) {
    if (!management || !onUsersPage()) return;
    const apply = () => {
      if (!onUsersPage()) return;
      const current = document.querySelector("#userManagementV2");
      if (!current) return;
      const tab = savedTab && current.querySelector(`[data-user-tab="${savedTab}"]`);
      if (tab && !tab.classList.contains("active")) tab.click();
      window.scrollTo({ top: savedScrollY, behavior: "auto" });
    };
    window.setTimeout(apply, 60);
    window.setTimeout(apply, 160);
  }

  function preserveManagement(appMain) {
    if (restoring || !appMain) return;

    if (!onUsersPage()) {
      savedManagement = null;
      automaticRefresh = false;
      formDirty = false;
      clearTimeout(refreshTimer);
      return;
    }

    const current = appMain.querySelector("#userManagementV2");
    if (current) {
      const replaced = current !== savedManagement;
      savedManagement = current;
      if (replaced) {
        formDirty = false;
        if (automaticRefresh) {
          automaticRefresh = false;
          restoreExperience(current);
        }
        scheduleRefresh();
      }
      return;
    }

    if (!savedManagement || savedManagement.isConnected) return;
    if (appMain.textContent.includes("Gestion des utilisateurs indisponible")) return;

    restoring = true;
    const scrollY = window.scrollY;
    appMain.replaceChildren(savedManagement);
    window.scrollTo({ top: scrollY, behavior: "auto" });
    restoring = false;
  }

  async function runGeneralRefresh() {
    const management = document.querySelector("#userManagementV2");
    if (!management || !onUsersPage() || document.visibilityState !== "visible" || !navigator.onLine) {
      scheduleRefresh(DEFERRED_REFRESH_DELAY);
      return;
    }

    const tab = activeTab(management);
    if (tab === "presence" || userIsEditing(management)) {
      await refreshRequestBadgeOnly();
      scheduleRefresh(DEFERRED_REFRESH_DELAY);
      return;
    }

    const refreshButton = management.querySelector('[data-um-action="refresh"]');
    if (!refreshButton) {
      scheduleRefresh(DEFERRED_REFRESH_DELAY);
      return;
    }

    automaticRefresh = true;
    savedScrollY = window.scrollY;
    savedTab = tab;
    refreshButton.click();
    scheduleRefresh();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const appMain = document.querySelector("#appMain");
    const pageTitle = document.querySelector("#pageTitle");
    if (!appMain || !pageTitle) return;

    new MutationObserver(() => preserveManagement(appMain)).observe(appMain, {
      childList: true,
      subtree: false
    });
    new MutationObserver(() => preserveManagement(appMain)).observe(pageTitle, {
      childList: true,
      characterData: true,
      subtree: true
    });

    appMain.addEventListener("input", event => {
      if (event.target.closest("#userManagementV2 form")) formDirty = true;
    }, true);
    appMain.addEventListener("change", event => {
      if (event.target.closest("#userManagementV2 form")) formDirty = true;
    }, true);
    appMain.addEventListener("click", event => {
      const tab = event.target.closest("[data-user-tab]");
      if (!tab || !automaticRefresh) return;
      savedTab = tab.dataset.userTab || savedTab;
    }, true);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && onUsersPage()) scheduleRefresh(DEFERRED_REFRESH_DELAY);
    });

    preserveManagement(appMain);
  });
})();
