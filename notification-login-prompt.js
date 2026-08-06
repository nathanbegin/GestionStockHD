(() => {
  const CHOICE_PREFIX = "restock_push_prompt_session_choice_v2:";
  const FALLBACK_SESSION_PREFIX = "restock_push_login_session_v1:";
  const PUSH_OWNER_KEY = "restock_push_owner_v1";
  const PROMPT_DELAY = 1800;
  let promptTimer = null;
  let promptedSessionKey = "";
  let evaluationInFlight = false;

  function storedAuthState() {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith("sb-") || !key.includes("auth-token")) continue;
        try {
          const parsed = JSON.parse(storage.getItem(key) || "null");
          const session = parsed?.currentSession || parsed?.session || parsed;
          const accessToken = session?.access_token || parsed?.access_token || "";
          if (accessToken) return { accessToken };
        } catch { /* clé sans rapport */ }
      }
    }
    return { accessToken: "" };
  }

  function jwtPayload(token) {
    try {
      const part = String(token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = part.padEnd(Math.ceil(part.length / 4) * 4, "=");
      return JSON.parse(atob(padded)) || {};
    } catch {
      return {};
    }
  }

  function makeFallbackSessionId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function authIdentity() {
    const { accessToken } = storedAuthState();
    const payload = jwtPayload(accessToken);
    const userId = String(payload.sub || "");
    if (!userId) return { userId: "", sessionId: "", key: "" };

    let sessionId = String(payload.session_id || payload.sid || "");
    if (!sessionId) {
      const fallbackKey = `${FALLBACK_SESSION_PREFIX}${userId}`;
      sessionId = localStorage.getItem(fallbackKey) || makeFallbackSessionId();
      localStorage.setItem(fallbackKey, sessionId);
    }

    return { userId, sessionId, key: `${userId}:${sessionId}` };
  }

  function appIsAvailable() {
    const shell = document.querySelector("#appShell");
    return Boolean(shell && !shell.hidden && storedAuthState().accessToken);
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isStandalone() {
    return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone);
  }

  async function currentPushMode(identity) {
    if (!window.isSecureContext) return "unsupported";
    if (isIOS() && !isStandalone()) return "install";
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "denied") return "blocked";
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      const owner = localStorage.getItem(PUSH_OWNER_KEY) || "";
      if (subscription && owner === identity.userId) return "enabled";
    } catch { /* l’activation pourra réessayer depuis le centre de notifications */ }

    return "activate";
  }

  function choiceKey(userId) {
    return `${CHOICE_PREFIX}${userId}`;
  }

  function rememberChoice(identity, choice) {
    if (!identity.userId || !identity.sessionId) return;
    localStorage.setItem(choiceKey(identity.userId), JSON.stringify({
      sessionId: identity.sessionId,
      choice,
      updatedAt: new Date().toISOString()
    }));
  }

  function storedChoice(identity) {
    if (!identity.userId || !identity.sessionId) return "";
    try {
      const record = JSON.parse(localStorage.getItem(choiceKey(identity.userId)) || "null");
      return record?.sessionId === identity.sessionId ? String(record.choice || "") : "";
    } catch {
      return "";
    }
  }

  function clearCurrentSessionMemory() {
    const identity = authIdentity();
    if (identity.userId) {
      localStorage.removeItem(choiceKey(identity.userId));
      localStorage.removeItem(`${FALLBACK_SESSION_PREFIX}${identity.userId}`);
    }
    promptedSessionKey = "";
    clearTimeout(promptTimer);
    closePrompt();
  }

  function installStyles() {
    if (document.querySelector("#notificationLoginPromptStyles")) return;
    const style = document.createElement("style");
    style.id = "notificationLoginPromptStyles";
    style.textContent = `
      .notification-login-prompt {
        position: fixed;
        inset: 0;
        z-index: 1400;
        display: grid;
        place-items: center;
        padding: 18px;
        background: rgba(35, 28, 24, .46);
        backdrop-filter: blur(3px);
      }
      .notification-login-prompt[hidden] { display: none; }
      .notification-login-card {
        width: min(430px, 100%);
        padding: 24px;
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--surface);
        box-shadow: 0 22px 55px rgba(35, 28, 24, .24);
      }
      .notification-login-icon {
        display: grid;
        place-items: center;
        width: 54px;
        height: 54px;
        margin-bottom: 15px;
        border-radius: 17px;
        background: rgba(249, 99, 2, .13);
        font-size: 27px;
      }
      .notification-login-card h2 { margin: 0 0 9px; }
      .notification-login-card > p { margin: 0 0 18px; line-height: 1.5; }
      .notification-login-actions { display: grid; gap: 9px; }
      .notification-login-note { margin: 14px 0 0 !important; font-size: .78rem; color: var(--muted); }
      @media (max-width: 600px) {
        .notification-login-prompt { align-items: end; padding: 12px; padding-bottom: max(12px, env(safe-area-inset-bottom)); }
        .notification-login-card { border-radius: 22px 22px 18px 18px; }
      }
    `;
    document.head.appendChild(style);
  }

  function closePrompt() {
    document.querySelector("#notificationLoginPrompt")?.remove();
  }

  function triggerPushActivation() {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.hidden = true;
    trigger.dataset.notificationAction = "push-enable";
    document.body.appendChild(trigger);
    trigger.click();
    trigger.remove();
  }

  function showPrompt(identity, mode) {
    if (!appIsAvailable() || document.querySelector("#notificationLoginPrompt")) return;

    const install = mode === "install";
    const backdrop = document.createElement("div");
    backdrop.id = "notificationLoginPrompt";
    backdrop.className = "notification-login-prompt";
    backdrop.setAttribute("role", "presentation");
    backdrop.innerHTML = `
      <section class="notification-login-card" role="dialog" aria-modal="true" aria-labelledby="notificationLoginTitle" aria-describedby="notificationLoginText">
        <div class="notification-login-icon" aria-hidden="true">🔔</div>
        <h2 id="notificationLoginTitle">${install ? "Installer pour recevoir les notifications?" : "Activer les notifications?"}</h2>
        <p id="notificationLoginText">${install
          ? "Sur iPhone et iPad, ajoute d’abord l’application à l’écran d’accueil pour recevoir une alerte lorsqu’une tâche t’est attribuée."
          : "Reçois une alerte lorsqu’une tâche ou une liste de ramassage t’est attribuée, même lorsque l’application est fermée."}</p>
        <div class="notification-login-actions">
          <button class="button primary wide" type="button" data-push-prompt-choice="accept">${install ? "Voir les instructions" : "Activer les notifications"}</button>
          <button class="button wide" type="button" data-push-prompt-choice="decline">Pas maintenant</button>
        </div>
        <p class="notification-login-note">Ce choix restera mémorisé pendant cette connexion. La question sera reposée seulement après une déconnexion suivie d’une nouvelle connexion.</p>
      </section>`;

    backdrop.addEventListener("click", event => {
      const choice = event.target.closest("[data-push-prompt-choice]")?.dataset.pushPromptChoice;
      if (choice === "accept") {
        rememberChoice(identity, install ? "install" : "accepted");
        closePrompt();
        if (install) {
          window.setTimeout(() => document.querySelector("#notificationBellButton")?.click(), 50);
        } else {
          triggerPushActivation();
        }
        return;
      }
      if (choice === "decline" || event.target === backdrop) {
        rememberChoice(identity, "declined");
        closePrompt();
      }
    });

    backdrop.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      rememberChoice(identity, "declined");
      closePrompt();
    });

    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-push-prompt-choice="accept"]')?.focus({ preventScroll: true });
  }

  async function evaluatePrompt() {
    if (!appIsAvailable() || evaluationInFlight) return;
    const identity = authIdentity();
    if (!identity.key || promptedSessionKey === identity.key) return;

    evaluationInFlight = true;
    try {
      const mode = await currentPushMode(identity);
      const latestIdentity = authIdentity();
      if (!appIsAvailable() || latestIdentity.key !== identity.key) return;

      if (mode === "enabled") {
        rememberChoice(identity, "accepted");
        promptedSessionKey = identity.key;
        return;
      }
      if (mode === "blocked") {
        rememberChoice(identity, "blocked");
        promptedSessionKey = identity.key;
        return;
      }
      if (mode === "unsupported") {
        promptedSessionKey = identity.key;
        return;
      }

      const choice = storedChoice(identity);
      const completedChoice = choice && !(choice === "install" && mode === "activate");
      if (completedChoice) {
        promptedSessionKey = identity.key;
        return;
      }

      promptedSessionKey = identity.key;
      showPrompt(identity, mode);
    } finally {
      evaluationInFlight = false;
    }
  }

  function schedulePrompt(delay = PROMPT_DELAY) {
    clearTimeout(promptTimer);
    promptTimer = window.setTimeout(evaluatePrompt, delay);
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();

    document.addEventListener("click", event => {
      const logout = event.target.closest("#logoutButton, [data-auth-action=\"logout\"], [data-action=\"logout\"]");
      if (logout) clearCurrentSessionMemory();
    }, true);

    const shell = document.querySelector("#appShell");
    if (shell) {
      new MutationObserver(() => {
        if (!shell.hidden) schedulePrompt();
        else {
          clearTimeout(promptTimer);
          promptedSessionKey = "";
          closePrompt();
        }
      }).observe(shell, { attributes: true, attributeFilter: ["hidden"] });
    }
    schedulePrompt();
  });
})();
