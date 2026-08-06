(() => {
  let enhanceTimer = null;
  let requestInFlight = false;

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

  function jwtSubject(token) {
    try {
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
      return JSON.parse(atob(padded))?.sub || "";
    } catch {
      return "";
    }
  }

  function toast(message) {
    const element = document.querySelector("#toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("show"), 4200);
  }

  function isAdministratorView() {
    return Boolean(document.querySelector("#userManagementV2 .um-create-user-form"));
  }

  function accountName(form) {
    return form.querySelector("h3")?.textContent?.trim()
      || form.querySelector('[name="fullName"]')?.value?.trim()
      || "cet utilisateur";
  }

  function addDeleteButton(form, currentUserId) {
    const userId = String(form.dataset.userId || "");
    if (!userId || userId === currentUserId || form.querySelector("[data-delete-user]")) return;

    const actions = form.querySelector(".form-actions, .button-row");
    if (!actions) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button danger um-delete-user-button";
    button.dataset.deleteUser = userId;
    button.textContent = "Supprimer le compte";
    actions.append(button);

    if (form.matches(".um-user-edit-form")) {
      const note = document.createElement("p");
      note.className = "tiny muted um-delete-user-note";
      note.textContent = "La suppression retire définitivement l’accès et enlève l’employé des attributions.";
      actions.before(note);
    }
  }

  function enhance() {
    if (!isAdministratorView()) return;
    const currentUserId = jwtSubject(storedAccessToken());
    document.querySelectorAll("#userManagementV2 form[data-user-id]")
      .forEach(form => addDeleteButton(form, currentUserId));
  }

  function scheduleEnhance() {
    clearTimeout(enhanceTimer);
    enhanceTimer = window.setTimeout(enhance, 20);
  }

  async function deleteUser(button) {
    if (requestInFlight) return;
    const form = button.closest("form");
    const userId = String(button.dataset.deleteUser || "");
    const name = accountName(form);
    if (!userId || !form) return;

    const confirmed = window.confirm(
      `Supprimer définitivement le compte de « ${name} »?\n\n` +
      "Cette personne perdra l’accès à l’application. Elle sera aussi retirée des employés, des attributions, des listes de ramassage et des connexions enregistrées."
    );
    if (!confirmed) return;

    const token = storedAccessToken();
    if (!token) return toast("Session introuvable. Reconnecte-toi.");

    requestInFlight = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Suppression…";
    form.setAttribute("aria-busy", "true");

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "delete", userId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Suppression du compte impossible");

      toast(data.cleanupComplete === false
        ? "Compte supprimé. Le reste du nettoyage sera terminé à la prochaine synchronisation."
        : "Compte et accès supprimés définitivement");

      const refreshButton = document.querySelector("#userManagementV2 [data-um-action='refresh']");
      if (refreshButton) refreshButton.click();
      window.setTimeout(() => document.querySelector("#syncButton")?.click(), 250);
    } catch (error) {
      toast(error?.message || "Suppression du compte impossible");
      button.disabled = false;
      button.textContent = originalText;
      form.removeAttribute("aria-busy");
    } finally {
      requestInFlight = false;
    }
  }

  function installStyles() {
    if (document.querySelector("#userDeleteStyles")) return;
    const style = document.createElement("style");
    style.id = "userDeleteStyles";
    style.textContent = `
      #userManagementV2 .um-delete-user-note {
        margin: .9rem 0 .25rem;
      }
      #userManagementV2 .um-delete-user-button {
        margin-left: auto;
      }
      @media (max-width: 560px) {
        #userManagementV2 .um-delete-user-button {
          width: 100%;
          margin-left: 0;
        }
      }
    `;
    document.head.append(style);
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    const appMain = document.querySelector("#appMain");
    if (!appMain) return;

    new MutationObserver(scheduleEnhance).observe(appMain, { childList: true, subtree: true });
    appMain.addEventListener("click", event => {
      const button = event.target.closest("[data-delete-user]");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      deleteUser(button);
    }, true);

    enhance();
  });
})();
