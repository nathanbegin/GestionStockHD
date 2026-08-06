(() => {
  const CHOICE_PREFIX = "restock_push_prompt_choice_v1:";
  const PROMPT_DELAY = 1800;
  let promptTimer = null;
  let promptedUserId = "";

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

  function jwtSubject(token = storedAccessToken()) {
    try {
      const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = part.padEnd(Math.ceil(part.length / 4) * 4, "=");
      return String(JSON.parse(atob(padded))?.sub || "");
    } catch {
      return "";
    }
  }

  function appIsAvailable() {
    const shell = document.querySelector("#appShell");
    return Boolean(shell && !shell.hidden && storedAccessToken());
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isStandalone() {
    return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone);
  }

  function promptMode() {
    if (!window.isSecureContext) return "unsupported";
    if (isIOS() && !isStandalone()) return "install";
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "enabled";
    if (Notification.permission === "denied") return "blocked";
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
    return "activate";
  }

  function choiceKey(userId) {
    return `${CHOICE_PREFIX}${userId}`;
  }

  function rememberChoice(userId, choice) {
    if (!userId) return;
    localStorage.setItem(choiceKey(userId), choice);
  }

  function storedChoice(userId) {
    return userId ? localStorage.getItem(choiceKey(userId)) || "" : "";
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

  function showPrompt(userId, mode) {
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
        <p class="notification-login-note">Ce choix sera mémorisé pour ce compte sur cet appareil. Il peut être modifié plus tard depuis la clochette.</p>
      </section>`;

    backdrop.addEventListener("click", event => {
      const choice = event.target.closest("[data-push-prompt-choice]")?.dataset.pushPromptChoice;
      if (choice === "accept") {
        rememberChoice(userId, install ? "install" : "accepted");
        closePrompt();
        if (install) {
          window.setTimeout(() => document.querySelector("#notificationBellButton")?.click(), 50);
        } else {
          triggerPushActivation();
        }
        return;
      }
      if (choice === "decline" || event.target === backdrop) {
        rememberChoice(userId, "declined");
        closePrompt();
      }
    });

    backdrop.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      rememberChoice(userId, "declined");
      closePrompt();
    });

    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-push-prompt-choice="accept"]')?.focus({ preventScroll: true });
  }

  function evaluatePrompt() {
    if (!appIsAvailable()) return;
    const userId = jwtSubject();
    if (!userId || promptedUserId === userId) return;

    const mode = promptMode();
    if (mode === "enabled") {
      rememberChoice(userId, "accepted");
      promptedUserId = userId;
      return;
    }
    if (mode === "blocked") {
      rememberChoice(userId, "blocked");
      promptedUserId = userId;
      return;
    }
    if (mode === "unsupported") {
      promptedUserId = userId;
      return;
    }

    const choice = storedChoice(userId);
    const completedChoice = choice && !(choice === "install" && mode === "activate");
    if (completedChoice) {
      promptedUserId = userId;
      return;
    }

    promptedUserId = userId;
    showPrompt(userId, mode);
  }

  function schedulePrompt(delay = PROMPT_DELAY) {
    clearTimeout(promptTimer);
    promptTimer = window.setTimeout(evaluatePrompt, delay);
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    const shell = document.querySelector("#appShell");
    if (shell) {
      new MutationObserver(() => {
        if (!shell.hidden) schedulePrompt();
        else {
          clearTimeout(promptTimer);
          promptedUserId = "";
          closePrompt();
        }
      }).observe(shell, { attributes: true, attributeFilter: ["hidden"] });
    }
    schedulePrompt();
  });
})();
