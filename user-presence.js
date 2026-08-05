(() => {
  const SESSION_ID_KEY = "restock_presence_session_id_v1";
  const SESSION_STARTED_KEY = "restock_presence_started_at_v1";
  const HEARTBEAT_INTERVAL = 45000;
  const LIST_REFRESH_INTERVAL = 30000;
  const ROLE_LABELS = { employee: "Employé", supervisor: "Superviseur", admin: "Administrateur" };
  let heartbeatTimer = null;
  let listTimer = null;
  let startTimer = null;
  let heartbeatInFlight = false;
  let presenceRequestInFlight = false;

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

  function sessionIdentity() {
    let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
    let startedAt = sessionStorage.getItem(SESSION_STARTED_KEY);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    if (!startedAt) {
      startedAt = new Date().toISOString();
      sessionStorage.setItem(SESSION_STARTED_KEY, startedAt);
    }
    return { sessionId, startedAt };
  }

  function deviceInfo() {
    const ua = navigator.userAgent || "";
    const platform = /Android/i.test(ua) ? "Android"
      : /iPhone/i.test(ua) ? "iPhone"
      : /iPad/i.test(ua) ? "iPad"
      : /Windows/i.test(ua) ? "Windows"
      : /Macintosh|Mac OS X/i.test(ua) ? "macOS"
      : /Linux/i.test(ua) ? "Linux"
      : "Appareil inconnu";
    const browser = /SamsungBrowser/i.test(ua) ? "Samsung Internet"
      : /Edg\//i.test(ua) ? "Microsoft Edge"
      : /Firefox\//i.test(ua) ? "Firefox"
      : /CriOS|Chrome\//i.test(ua) ? "Chrome"
      : /Safari\//i.test(ua) ? "Safari"
      : "Navigateur inconnu";
    const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone;
    return { platform, browser, mode: standalone ? "PWA installée" : "Navigateur" };
  }

  async function presenceFetch(options = {}) {
    const token = storedAccessToken();
    if (!token) throw new Error("Session absente");
    const response = await fetch("/api/presence", {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      keepalive: Boolean(options.keepalive)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Présence indisponible");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function sendPresence(action = "heartbeat", keepalive = false) {
    if (heartbeatInFlight && action === "heartbeat") return;
    const token = storedAccessToken();
    const appShell = document.querySelector("#appShell");
    if (!token || !appShell || appShell.hidden) return;

    const identity = sessionIdentity();
    heartbeatInFlight = true;
    try {
      await presenceFetch({
        method: "POST",
        keepalive,
        body: { action, ...identity, device: deviceInfo() }
      });
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) console.warn("Présence", error.message);
    } finally {
      heartbeatInFlight = false;
    }
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function formatDate(value) {
    if (!value) return "Jamais";
    try {
      return new Intl.DateTimeFormat("fr-CA", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(value));
    } catch {
      return "—";
    }
  }

  function relativeTime(value) {
    if (!value) return "Jamais";
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
    const absolute = Math.abs(seconds);
    if (absolute < 60) return formatter.format(seconds, "second");
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
    return formatter.format(Math.round(hours / 24), "day");
  }

  function roleTags(roles = []) {
    return [...new Set(roles)].map(role => `<span class="tag">${escapeHTML(ROLE_LABELS[role] || role)}</span>`).join("");
  }

  function deviceLabel(device) {
    if (!device) return "Appareil non déterminé";
    return [device.platform, device.browser, device.mode].filter(Boolean).join(" · ");
  }

  function activeSessionRows(sessions = []) {
    return sessions.map(session => `
      <div class="presence-session-row">
        <span class="presence-device-icon" aria-hidden="true">▣</span>
        <div><strong>${escapeHTML(deviceLabel(session.device))}</strong><small>Connecté depuis ${formatDate(session.started_at)} · signal ${relativeTime(session.last_seen_at)}</small></div>
      </div>
    `).join("");
  }

  function onlineCard(user) {
    return `<article class="card presence-user-card">
      <div class="presence-user-head"><div><div class="presence-name-row"><span class="presence-dot online"></span><h3>${escapeHTML(user.fullName)}</h3></div><p class="small muted">${escapeHTML(user.email)}</p></div><span class="presence-status online">En ligne</span></div>
      <div class="tags">${roleTags(user.roles)}</div>
      <div class="presence-sessions">${activeSessionRows(user.activeSessions)}</div>
      <p class="tiny muted">Dernière connexion au compte : ${formatDate(user.lastSignInAt)}</p>
    </article>`;
  }

  function offlineRow(user) {
    return `<div class="presence-offline-row">
      <div><strong>${escapeHTML(user.fullName)}</strong><small>${escapeHTML(user.email)}</small></div>
      <div class="presence-offline-meta"><span>${user.lastSeenAt ? `Vu ${relativeTime(user.lastSeenAt)}` : "Aucune présence enregistrée"}</span><small>Dernière connexion : ${formatDate(user.lastSignInAt)}</small></div>
    </div>`;
  }

  function renderPanel(panel, data) {
    const users = Array.isArray(data.users) ? data.users : [];
    const online = users.filter(user => user.online);
    const offline = users.filter(user => !user.online);
    panel.innerHTML = `
      <div class="section-head presence-heading"><div><h2>Connexions à l’application</h2><p class="muted">Présence estimée à partir d’un signal envoyé environ chaque minute.</p></div><button class="button compact" type="button" data-presence-action="refresh">Actualiser</button></div>
      <div class="presence-summary"><div><strong>${online.length}</strong><span>en ligne</span></div><div><strong>${users.length}</strong><span>comptes approuvés</span></div><div><strong>${formatDate(data.serverTime)}</strong><span>heure du serveur</span></div></div>
      ${online.length ? `<div class="presence-online-grid">${online.map(onlineCard).join("")}</div>` : `<div class="card empty"><h3>Personne n’est en ligne</h3><p>Les utilisateurs apparaîtront ici après leur prochain signal de présence.</p></div>`}
      <details class="card presence-offline-details"><summary>Dernières connexions (${offline.length})</summary><div class="presence-offline-list">${offline.map(offlineRow).join("")}</div></details>
    `;
  }

  function ensurePanel() {
    const title = document.querySelector("#pageTitle")?.textContent?.trim();
    const management = document.querySelector("#userManagementV2");
    if (title !== "Utilisateurs" || !management) return null;
    let panel = management.querySelector("#userPresencePanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "userPresencePanel";
      panel.className = "section presence-panel";
      panel.innerHTML = `<div class="card"><p class="muted">Chargement des connexions…</p></div>`;
      management.prepend(panel);
    }
    return panel;
  }

  async function refreshPresence() {
    const panel = ensurePanel();
    if (!panel || presenceRequestInFlight) return;
    presenceRequestInFlight = true;
    try {
      const data = await presenceFetch();
      renderPanel(panel, data);
    } catch (error) {
      if (error.status === 403) panel.remove();
      else panel.innerHTML = `<div class="card"><h2>Connexions indisponibles</h2><p class="muted">${escapeHTML(error.message)}</p><button class="button" type="button" data-presence-action="refresh">Réessayer</button></div>`;
    } finally {
      presenceRequestInFlight = false;
    }
  }

  function installStyles() {
    if (document.querySelector("#userPresenceStyles")) return;
    const style = document.createElement("style");
    style.id = "userPresenceStyles";
    style.textContent = `
      #userPresencePanel { scroll-margin-top: 6rem; }
      #userPresencePanel .presence-heading { align-items: center; }
      #userPresencePanel .presence-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .7rem; margin-bottom: 1rem; }
      #userPresencePanel .presence-summary > div { display: grid; gap: .15rem; padding: .9rem; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
      #userPresencePanel .presence-summary strong { font-size: 1.3rem; overflow-wrap: anywhere; }
      #userPresencePanel .presence-summary span { color: var(--muted); font-size: .78rem; }
      #userPresencePanel .presence-online-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: .8rem; }
      #userPresencePanel .presence-user-card { display: grid; gap: .75rem; border-color: rgba(30,112,80,.28); }
      #userPresencePanel .presence-user-head { display: flex; justify-content: space-between; gap: .75rem; align-items: flex-start; }
      #userPresencePanel .presence-user-head p { margin: .2rem 0 0; }
      #userPresencePanel .presence-name-row { display: flex; align-items: center; gap: .5rem; }
      #userPresencePanel .presence-dot { width: .7rem; height: .7rem; border-radius: 50%; flex: 0 0 auto; }
      #userPresencePanel .presence-dot.online { background: var(--success); box-shadow: 0 0 0 4px rgba(30,112,80,.13); }
      #userPresencePanel .presence-status { padding: .35rem .6rem; border-radius: 999px; font-size: .75rem; font-weight: 850; white-space: nowrap; }
      #userPresencePanel .presence-status.online { color: var(--success); background: rgba(30,112,80,.1); }
      #userPresencePanel .presence-sessions { display: grid; gap: .55rem; }
      #userPresencePanel .presence-session-row { display: grid; grid-template-columns: auto minmax(0,1fr); gap: .55rem; align-items: start; padding: .65rem; background: #fbf7f4; border-radius: 12px; }
      #userPresencePanel .presence-session-row small { display: block; margin-top: .15rem; color: var(--muted); line-height: 1.35; }
      #userPresencePanel .presence-device-icon { font-size: 1.05rem; color: var(--brand); }
      #userPresencePanel .presence-offline-details { margin-top: 1rem; }
      #userPresencePanel .presence-offline-details summary { cursor: pointer; font-weight: 850; }
      #userPresencePanel .presence-offline-list { display: grid; margin-top: .8rem; }
      #userPresencePanel .presence-offline-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: .8rem; padding: .8rem 0; border-top: 1px solid var(--line); }
      #userPresencePanel .presence-offline-row:first-child { border-top: 0; }
      #userPresencePanel .presence-offline-row small { display: block; color: var(--muted); margin-top: .15rem; }
      #userPresencePanel .presence-offline-meta { text-align: right; font-size: .85rem; }
      @media (max-width: 560px) {
        #userPresencePanel .presence-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        #userPresencePanel .presence-summary > div:last-child { grid-column: 1 / -1; }
        #userPresencePanel .presence-offline-row { grid-template-columns: 1fr; }
        #userPresencePanel .presence-offline-meta { text-align: left; }
      }
    `;
    document.head.append(style);
  }

  function start() {
    const token = storedAccessToken();
    const appShell = document.querySelector("#appShell");
    if (!token || !appShell || appShell.hidden) return false;
    sendPresence("heartbeat");
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState === "visible") sendPresence("heartbeat");
    }, HEARTBEAT_INTERVAL);
    clearInterval(listTimer);
    listTimer = setInterval(() => {
      if (document.visibilityState === "visible" && document.querySelector("#pageTitle")?.textContent?.trim() === "Utilisateurs") refreshPresence();
    }, LIST_REFRESH_INTERVAL);
    refreshPresence();
    return true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    startTimer = setInterval(() => {
      if (start()) clearInterval(startTimer);
    }, 2000);

    const appMain = document.querySelector("#appMain");
    if (appMain) new MutationObserver(() => refreshPresence()).observe(appMain, { childList: true, subtree: false });
    const pageTitle = document.querySelector("#pageTitle");
    if (pageTitle) new MutationObserver(() => refreshPresence()).observe(pageTitle, { childList: true, characterData: true, subtree: true });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        sendPresence("heartbeat");
        refreshPresence();
      }
    });

    document.addEventListener("click", event => {
      if (event.target.closest("[data-presence-action='refresh']")) refreshPresence();
      if (event.target.closest("#logoutButton, [data-auth-action='logout']")) sendPresence("offline", true);
    }, true);

    window.addEventListener("pagehide", () => sendPresence("offline", true));
  });
})();
