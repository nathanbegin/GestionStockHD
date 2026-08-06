(() => {
  const POLL_INTERVAL = 30000;
  const MIN_REFRESH_GAP = 15000;
  const PUSH_OWNER_KEY = "restock_push_owner_v1";
  let notifications = [];
  let requestInFlight = false;
  let initialLoaded = false;
  let lastFetchAt = 0;
  let pollTimer = null;
  let scheduledRefresh = null;
  let pushRequestInFlight = false;
  let pushState = { status: "checking", config: null, subscription: null, message: "" };
  let pendingPushLink = null;
  const knownIds = new Set();

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
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
      return JSON.parse(atob(padded))?.sub || "";
    } catch {
      return "";
    }
  }

  function appIsAvailable() {
    const shell = document.querySelector("#appShell");
    return Boolean(shell && !shell.hidden && storedAccessToken());
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function validDate(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  }

  function formatDate(value) {
    const date = validDate(value);
    if (!date) return "Heure inconnue";
    try {
      return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(date);
    } catch {
      return "Heure inconnue";
    }
  }

  function relativeTime(value) {
    const date = validDate(value);
    if (!date) return "";
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
    return formatter.format(Math.round(hours / 24), "day");
  }

  function toast(message) {
    const element = document.querySelector("#toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("show"), 4200);
  }

  async function apiRequest({ view = "", method = "GET", body = null } = {}) {
    const token = storedAccessToken();
    if (!token) throw new Error("Session introuvable");
    const url = view ? `/api/me?view=${encodeURIComponent(view)}` : "/api/me";
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Notifications indisponibles");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isStandalone() {
    return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone);
  }

  function pushSupported() {
    return Boolean(
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
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
    return { platform, browser, mode: isStandalone() ? "PWA installée" : "Navigateur" };
  }

  function base64UrlToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
  }

  function arrayBufferToBase64Url(value) {
    if (!value) return "";
    const bytes = new Uint8Array(value);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function subscriptionUsesKey(subscription, publicKey) {
    const current = arrayBufferToBase64Url(subscription?.options?.applicationServerKey);
    return !current || current === publicKey;
  }

  async function serviceWorkerRegistration(wait = false) {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) return existing;
    if (!wait) return existing || null;
    return navigator.serviceWorker.ready;
  }

  function installStyles() {
    if (document.querySelector("#notificationCenterStyles")) return;
    const style = document.createElement("style");
    style.id = "notificationCenterStyles";
    style.textContent = `
      .notification-bell-button { position:relative; display:inline-grid; place-items:center; width:42px; height:42px; flex:0 0 42px; padding:0; border:1px solid var(--line); border-radius:13px; background:var(--surface); color:var(--text); cursor:pointer; }
      .notification-bell-button:hover { border-color:rgba(249,99,2,.45); background:#fff7f1; }
      .notification-bell-button svg { width:22px; height:22px; }
      .notification-badge { position:absolute; top:-6px; right:-6px; display:grid; place-items:center; min-width:20px; height:20px; padding:0 5px; border:2px solid var(--surface); border-radius:999px; background:#c84400; color:#fff; font-size:11px; font-weight:900; line-height:1; }
      .notification-badge[hidden] { display:none; }
      .notification-backdrop { position:fixed; inset:0; z-index:1200; display:flex; justify-content:flex-end; background:rgba(35,28,24,.38); backdrop-filter:blur(2px); }
      .notification-backdrop[hidden] { display:none; }
      .notification-drawer { width:min(460px,100%); height:100%; display:grid; grid-template-rows:auto auto minmax(0,1fr); background:#f8f4f1; box-shadow:-16px 0 45px rgba(35,28,24,.18); }
      .notification-drawer-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:max(18px,env(safe-area-inset-top)) 18px 16px; border-bottom:1px solid var(--line); background:var(--surface); }
      .notification-drawer-head h2 { margin:0 0 4px; }
      .notification-drawer-head p { margin:0; }
      .notification-head-actions { display:flex; gap:7px; align-items:center; }
      .notification-close { display:grid; place-items:center; width:38px; height:38px; padding:0; border:1px solid var(--line); border-radius:11px; background:var(--surface); font-size:22px; cursor:pointer; }
      .push-settings { margin:12px 14px 0; padding:13px 14px; border:1px solid var(--line); border-radius:16px; background:var(--surface); }
      .push-settings-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .push-settings-copy { min-width:0; }
      .push-settings-copy strong { display:block; margin-bottom:3px; }
      .push-settings-copy p { margin:0; line-height:1.4; }
      .push-status-dot { display:inline-block; width:9px; height:9px; margin-right:7px; border-radius:50%; background:#aaa; }
      .push-status-dot.enabled { background:var(--success); box-shadow:0 0 0 4px rgba(30,112,80,.12); }
      .push-status-dot.warning { background:#d66a00; }
      .push-status-dot.error { background:#b3261e; }
      .notification-list { overflow-y:auto; overscroll-behavior:contain; padding:14px 14px calc(22px + env(safe-area-inset-bottom)); }
      .notification-item { position:relative; display:grid; grid-template-columns:auto minmax(0,1fr); gap:11px; width:100%; margin:0 0 10px; padding:14px; border:1px solid var(--line); border-radius:16px; background:var(--surface); color:var(--text); text-align:left; cursor:pointer; }
      .notification-item.unread { border-color:rgba(249,99,2,.42); background:#fff9f5; }
      .notification-item:hover { transform:translateY(-1px); box-shadow:0 7px 18px rgba(45,36,31,.07); }
      .notification-item-icon { display:grid; place-items:center; width:38px; height:38px; border-radius:12px; background:rgba(249,99,2,.12); color:#bf4b00; font-size:18px; }
      .notification-item h3 { margin:0 0 5px; font-size:1rem; }
      .notification-item p { margin:0; line-height:1.45; }
      .notification-item-meta { display:flex; flex-wrap:wrap; gap:5px 9px; margin-top:9px; color:var(--muted); font-size:.76rem; }
      .notification-unread-dot { position:absolute; top:12px; right:12px; width:9px; height:9px; border-radius:50%; background:#f96302; }
      .notification-empty { padding:36px 20px; text-align:center; }
      .notification-empty .icon { font-size:34px; margin-bottom:8px; }
      @media (max-width:700px) {
        .notification-bell-button { width:40px; height:40px; flex-basis:40px; }
        .notification-drawer { width:100%; }
        .notification-drawer-head { padding-inline:14px; }
        .notification-head-actions .button { padding-inline:.65rem; }
        .push-settings-row { align-items:stretch; flex-direction:column; }
        .push-settings-row .button { width:100%; }
      }
    `;
    document.head.appendChild(style);
  }

  function mountUI() {
    const actions = document.querySelector(".topbar-actions");
    if (!actions) return false;

    if (!document.querySelector("#notificationBellButton")) {
      const button = document.createElement("button");
      button.id = "notificationBellButton";
      button.className = "notification-bell-button";
      button.type = "button";
      button.setAttribute("aria-label", "Ouvrir les notifications");
      button.setAttribute("aria-haspopup", "dialog");
      button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>
          <path d="M10 21h4"></path>
        </svg>
        <span id="notificationBadge" class="notification-badge" hidden>0</span>`;
      const syncButton = document.querySelector("#syncButton");
      actions.insertBefore(button, syncButton || actions.firstChild);
    }

    if (!document.querySelector("#notificationBackdrop")) {
      const backdrop = document.createElement("div");
      backdrop.id = "notificationBackdrop";
      backdrop.className = "notification-backdrop";
      backdrop.hidden = true;
      backdrop.innerHTML = `
        <aside class="notification-drawer" role="dialog" aria-modal="true" aria-labelledby="notificationTitle">
          <div class="notification-drawer-head">
            <div><h2 id="notificationTitle">Notifications</h2><p class="small muted">Tâches et listes qui te sont attribuées.</p></div>
            <div class="notification-head-actions">
              <button class="button compact" type="button" data-notification-action="read-all">Tout lire</button>
              <button class="notification-close" type="button" data-notification-action="close" aria-label="Fermer">×</button>
            </div>
          </div>
          <div id="pushNotificationSettings" class="push-settings" aria-live="polite"></div>
          <div id="notificationList" class="notification-list" aria-live="polite"></div>
        </aside>`;
      document.body.appendChild(backdrop);
    }
    return true;
  }

  function unreadCount() {
    return notifications.filter(notification => !notification.readAt).length;
  }

  function notificationIcon(type) {
    return type === "pickup_assignment" ? "⇢" : "☑";
  }

  function pushSettingsMarkup() {
    const status = pushState.status;
    if (status === "enabled") {
      const count = Number(pushState.config?.subscriptionCount || 0);
      return `<div class="push-settings-row"><div class="push-settings-copy"><strong><span class="push-status-dot enabled"></span>Notifications système activées</strong><p class="small muted">Cet appareil recevra les nouvelles attributions même lorsque la PWA est fermée.${count > 1 ? ` ${count} appareils sont actuellement abonnés.` : ""}</p></div><button class="button compact" type="button" data-notification-action="push-disable">Désactiver</button></div>`;
    }
    if (status === "install-required") {
      return `<div class="push-settings-row"><div class="push-settings-copy"><strong><span class="push-status-dot warning"></span>Installation requise sur iOS</strong><p class="small muted">Dans Safari, utilise Partager → Ajouter à l’écran d’accueil, puis ouvre la PWA installée pour activer les notifications.</p></div></div>`;
    }
    if (status === "denied") {
      return `<div class="push-settings-row"><div class="push-settings-copy"><strong><span class="push-status-dot error"></span>Notifications bloquées</strong><p class="small muted">Autorise les notifications dans les réglages du système ou du navigateur, puis reviens dans l’application.</p></div><button class="button compact" type="button" data-notification-action="push-refresh">Vérifier</button></div>`;
    }
    if (status === "unsupported") {
      return `<div class="push-settings-row"><div class="push-settings-copy"><strong><span class="push-status-dot warning"></span>Notifications système non prises en charge</strong><p class="small muted">L’historique dans la clochette demeure disponible sur cet appareil.</p></div></div>`;
    }
    if (status === "unavailable" || status === "error") {
      return `<div class="push-settings-row"><div class="push-settings-copy"><strong><span class="push-status-dot error"></span>Web Push temporairement indisponible</strong><p class="small muted">${escapeHTML(pushState.message || "Réessaie dans quelques instants.")}</p></div><button class="button compact" type="button" data-notification-action="push-refresh">Réessayer</button></div>`;
    }
    if (status === "available") {
      return `<div class="push-settings-row"><div class="push-settings-copy"><strong><span class="push-status-dot warning"></span>Alertes système désactivées</strong><p class="small muted">Active-les pour être averti d’une nouvelle tâche lorsque l’application est fermée.</p></div><button class="button primary compact" type="button" data-notification-action="push-enable">Activer</button></div>`;
    }
    return `<div class="push-settings-row"><div class="push-settings-copy"><strong><span class="push-status-dot"></span>Vérification des notifications système…</strong><p class="small muted">L’autorisation ne sera jamais demandée sans ton action.</p></div></div>`;
  }

  function renderPushSettings() {
    const box = document.querySelector("#pushNotificationSettings");
    if (box) box.innerHTML = pushSettingsMarkup();
  }

  function render() {
    if (!mountUI()) return;
    const badge = document.querySelector("#notificationBadge");
    const list = document.querySelector("#notificationList");
    const readAll = document.querySelector('[data-notification-action="read-all"]');
    const unread = unreadCount();

    if (badge) {
      badge.hidden = unread === 0;
      badge.textContent = unread > 99 ? "99+" : String(unread);
    }
    if (readAll) readAll.disabled = unread === 0;
    renderPushSettings();
    if (!list) return;

    list.innerHTML = notifications.length ? notifications.map(notification => `
      <button class="notification-item ${notification.readAt ? "" : "unread"}" type="button" data-notification-open="${escapeHTML(notification.id)}">
        ${notification.readAt ? "" : `<span class="notification-unread-dot" aria-label="Non lue"></span>`}
        <span class="notification-item-icon" aria-hidden="true">${notificationIcon(notification.type)}</span>
        <span>
          <h3>${escapeHTML(notification.title)}</h3>
          <p>${escapeHTML(notification.message)}</p>
          <span class="notification-item-meta"><span>${escapeHTML(relativeTime(notification.createdAt))}</span><span>${escapeHTML(formatDate(notification.createdAt))}</span><span>Par ${escapeHTML(notification.actorName || "Système")}</span></span>
        </span>
      </button>`).join("") : `
      <div class="notification-empty"><div class="icon">🔔</div><h3>Aucune notification</h3><p class="muted">Les nouvelles tâches qui te sont attribuées apparaîtront ici.</p></div>`;
  }

  async function refreshPushStatus({ syncServer = true } = {}) {
    if (!appIsAvailable() || pushRequestInFlight) return;
    if (!pushSupported()) {
      pushState = { status: "unsupported", config: null, subscription: null, message: "" };
      renderPushSettings();
      return;
    }
    if (isIOS() && !isStandalone()) {
      pushState = { status: "install-required", config: null, subscription: null, message: "" };
      renderPushSettings();
      return;
    }
    if (Notification.permission === "denied") {
      pushState = { status: "denied", config: null, subscription: null, message: "" };
      renderPushSettings();
      return;
    }

    pushRequestInFlight = true;
    pushState = { ...pushState, status: "checking", message: "" };
    renderPushSettings();
    try {
      const config = await apiRequest({ view: "push-config" });
      if (!config.enabled || !config.publicKey) throw new Error("La configuration Web Push n’est pas disponible");
      const registration = await serviceWorkerRegistration(false);
      let subscription = await registration?.pushManager?.getSubscription();
      const owner = localStorage.getItem(PUSH_OWNER_KEY) || "";
      const currentUserId = jwtSubject();

      if (subscription && owner && currentUserId && owner !== currentUserId) {
        await subscription.unsubscribe().catch(() => false);
        subscription = null;
        localStorage.removeItem(PUSH_OWNER_KEY);
      }
      if (subscription && !subscriptionUsesKey(subscription, config.publicKey)) {
        const oldEndpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => false);
        await apiRequest({ method: "POST", body: { action: "pushUnsubscribe", endpoint: oldEndpoint } }).catch(() => {});
        subscription = null;
        localStorage.removeItem(PUSH_OWNER_KEY);
      }

      if (subscription && syncServer) {
        await apiRequest({
          method: "POST",
          body: { action: "pushSubscribe", subscription: subscription.toJSON(), device: deviceInfo() }
        });
        if (currentUserId) localStorage.setItem(PUSH_OWNER_KEY, currentUserId);
      }

      pushState = {
        status: subscription ? "enabled" : "available",
        config,
        subscription,
        message: ""
      };
    } catch (error) {
      pushState = { status: "error", config: null, subscription: null, message: error.message };
    } finally {
      pushRequestInFlight = false;
      renderPushSettings();
    }
  }

  async function enablePush() {
    if (pushRequestInFlight) return;
    if (!pushSupported()) {
      pushState = { status: "unsupported", config: null, subscription: null, message: "" };
      return renderPushSettings();
    }
    if (isIOS() && !isStandalone()) {
      pushState = { status: "install-required", config: null, subscription: null, message: "" };
      renderPushSettings();
      return toast("Installe d’abord la PWA sur l’écran d’accueil de l’iPhone ou de l’iPad");
    }

    pushRequestInFlight = true;
    pushState = { ...pushState, status: "checking", message: "" };
    renderPushSettings();
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        pushState = { status: permission === "denied" ? "denied" : "available", config: null, subscription: null, message: "" };
        return;
      }

      const config = await apiRequest({ view: "push-config" });
      if (!config.enabled || !config.publicKey) throw new Error("La configuration Web Push n’est pas disponible");
      const registration = await serviceWorkerRegistration(true);
      if (!registration?.pushManager) throw new Error("Service worker indisponible");
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !subscriptionUsesKey(subscription, config.publicKey)) {
        await subscription.unsubscribe().catch(() => false);
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(config.publicKey)
        });
      }

      await apiRequest({
        method: "POST",
        body: { action: "pushSubscribe", subscription: subscription.toJSON(), device: deviceInfo() }
      });
      const currentUserId = jwtSubject();
      if (currentUserId) localStorage.setItem(PUSH_OWNER_KEY, currentUserId);
      pushState = { status: "enabled", config: { ...config, subscriptionCount: Math.max(1, Number(config.subscriptionCount || 0)) }, subscription, message: "" };
      toast("Notifications système activées sur cet appareil");
    } catch (error) {
      pushState = { status: "error", config: null, subscription: null, message: error.message };
      toast(error.message);
    } finally {
      pushRequestInFlight = false;
      renderPushSettings();
    }
  }

  async function disablePush() {
    if (pushRequestInFlight) return;
    pushRequestInFlight = true;
    renderPushSettings();
    try {
      const registration = await serviceWorkerRegistration(false);
      const subscription = await registration?.pushManager?.getSubscription();
      if (subscription) {
        await apiRequest({ method: "POST", body: { action: "pushUnsubscribe", endpoint: subscription.endpoint } }).catch(() => {});
        await subscription.unsubscribe();
      }
      localStorage.removeItem(PUSH_OWNER_KEY);
      pushState = { status: "available", config: pushState.config, subscription: null, message: "" };
      toast("Notifications système désactivées sur cet appareil");
    } catch (error) {
      pushState = { ...pushState, status: "error", message: error.message };
      toast(error.message);
    } finally {
      pushRequestInFlight = false;
      renderPushSettings();
    }
  }

  function openPanel() {
    if (!mountUI()) return;
    const backdrop = document.querySelector("#notificationBackdrop");
    backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    backdrop.querySelector('[data-notification-action="close"]')?.focus({ preventScroll: true });
    refreshNotifications(true);
    refreshPushStatus({ syncServer: true });
  }

  function closePanel() {
    const backdrop = document.querySelector("#notificationBackdrop");
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.body.style.overflow = "";
    document.querySelector("#notificationBellButton")?.focus({ preventScroll: true });
  }

  function announceNew(count) {
    if (!count) return;
    toast(count === 1 ? "Une nouvelle tâche t’a été attribuée" : `${count} nouvelles tâches t’ont été attribuées`);
    navigator.vibrate?.(120);
  }

  async function refreshNotifications(force = false) {
    if (!appIsAvailable() || requestInFlight) return;
    if (!force && Date.now() - lastFetchAt < MIN_REFRESH_GAP) return;
    requestInFlight = true;
    try {
      const data = await apiRequest({ view: "notifications" });
      const next = Array.isArray(data.notifications) ? data.notifications : [];
      if (initialLoaded) {
        const newUnread = next.filter(notification => !notification.readAt && !knownIds.has(notification.id));
        announceNew(newUnread.length);
      }
      notifications = next;
      next.forEach(notification => knownIds.add(notification.id));
      initialLoaded = true;
      lastFetchAt = Date.now();
      render();
    } catch (error) {
      if (![401, 403].includes(error.status)) console.warn("Notifications", error.message);
    } finally {
      requestInFlight = false;
    }
  }

  async function markRead(notification) {
    if (!notification || notification.readAt) return;
    try {
      await apiRequest({
        method: "POST",
        body: { action: "notificationRead", notificationId: notification.id }
      });
      notification.readAt = new Date().toISOString();
      render();
    } catch (error) {
      toast(error.message);
    }
  }

  async function markAllRead() {
    if (!unreadCount()) return;
    try {
      await apiRequest({ method: "POST", body: { action: "notificationReadAll" } });
      const now = new Date().toISOString();
      notifications.forEach(notification => { if (!notification.readAt) notification.readAt = now; });
      render();
    } catch (error) {
      toast(error.message);
    }
  }

  function navigateDestination(destination) {
    if (destination === "notifications") return openPanel();
    const view = destination === "pickups" ? "pickups" : "assignments";
    closePanel();
    document.querySelector(`[data-nav="${view}"]`)?.click();
    if (view === "assignments") {
      window.setTimeout(() => {
        const filter = document.querySelector("#assignmentFilter");
        if (!filter) return;
        filter.value = "mine";
        filter.dispatchEvent(new Event("change", { bubbles: true }));
      }, 120);
    }
  }

  async function handlePushNavigation(destination, notificationId = "") {
    if (!appIsAvailable()) {
      pendingPushLink = { destination, notificationId };
      return;
    }
    await refreshNotifications(true);
    const notification = notifications.find(entry => entry.id === notificationId);
    if (notification) await markRead(notification);
    navigateDestination(destination || (notification?.type === "pickup_assignment" ? "pickups" : "assignments"));
  }

  function navigateToNotification(notification) {
    markRead(notification).finally(() => {
      navigateDestination(notification.type === "pickup_assignment" ? "pickups" : "assignments");
    });
  }

  function scheduleRefresh(delay = 800) {
    clearTimeout(scheduledRefresh);
    scheduledRefresh = window.setTimeout(() => refreshNotifications(false), delay);
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshNotifications(false);
    }, POLL_INTERVAL);
  }

  function readPushLinkFromUrl() {
    const url = new URL(window.location.href);
    const destination = url.searchParams.get("push");
    if (!destination) return;
    pendingPushLink = {
      destination,
      notificationId: url.searchParams.get("notification") || ""
    };
    url.searchParams.delete("push");
    url.searchParams.delete("notification");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function processPendingPushLink() {
    if (!pendingPushLink || !appIsAvailable()) return;
    const link = pendingPushLink;
    pendingPushLink = null;
    handlePushNavigation(link.destination, link.notificationId);
  }

  async function detachSubscriptionAfterLogout() {
    if (!pushSupported() || !localStorage.getItem(PUSH_OWNER_KEY)) return;
    const registration = await serviceWorkerRegistration(false).catch(() => null);
    const subscription = await registration?.pushManager?.getSubscription().catch(() => null);
    if (subscription) await subscription.unsubscribe().catch(() => false);
    localStorage.removeItem(PUSH_OWNER_KEY);
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    mountUI();
    render();
    startPolling();
    readPushLinkFromUrl();

    document.addEventListener("click", event => {
      if (event.target.closest("#notificationBellButton")) {
        event.preventDefault();
        openPanel();
        return;
      }
      const action = event.target.closest("[data-notification-action]")?.dataset.notificationAction;
      if (action === "close") return closePanel();
      if (action === "read-all") return markAllRead();
      if (action === "push-enable") return enablePush();
      if (action === "push-disable") return disablePush();
      if (action === "push-refresh") return refreshPushStatus({ syncServer: true });

      const item = event.target.closest("[data-notification-open]");
      if (item) {
        const notification = notifications.find(entry => entry.id === item.dataset.notificationOpen);
        if (notification) navigateToNotification(notification);
        return;
      }

      const backdrop = event.target.closest("#notificationBackdrop");
      if (backdrop && event.target === backdrop) closePanel();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closePanel();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh(500);
        window.setTimeout(() => refreshPushStatus({ syncServer: true }), 900);
      }
    });

    navigator.serviceWorker?.addEventListener("message", event => {
      const data = event.data || {};
      if (data.type === "push-received") scheduleRefresh(100);
      if (data.type === "push-notification-click") {
        handlePushNavigation(data.destination || "notifications", data.notificationId || "");
      }
    });

    const syncLabel = document.querySelector("#syncLabel");
    if (syncLabel) new MutationObserver(() => scheduleRefresh(900)).observe(syncLabel, { childList: true, characterData: true, subtree: true });

    const appShell = document.querySelector("#appShell");
    if (appShell) new MutationObserver(() => {
      if (!appShell.hidden) {
        scheduleRefresh(700);
        window.setTimeout(() => refreshPushStatus({ syncServer: true }), 1300);
        window.setTimeout(processPendingPushLink, 1500);
      } else {
        notifications = [];
        knownIds.clear();
        initialLoaded = false;
        lastFetchAt = 0;
        pushState = { status: "checking", config: null, subscription: null, message: "" };
        detachSubscriptionAfterLogout();
        render();
        closePanel();
      }
    }).observe(appShell, { attributes: true, attributeFilter: ["hidden"] });

    scheduleRefresh(1400);
    window.setTimeout(() => refreshPushStatus({ syncServer: true }), 2200);
    window.setInterval(processPendingPushLink, 700);
  });
})();
