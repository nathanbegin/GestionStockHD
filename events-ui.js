(() => {
  const STORAGE_KEY = "restock_app_v1";
  const REFRESH_INTERVAL = 60000;
  let data = { events: [], currentUser: null, canManage: false, users: [] };
  let eventsOpen = false;
  let editorEventId = null;
  let loading = false;
  let rendering = false;
  let lastLoadedAt = 0;
  let highlightEventId = "";

  function storedAccessToken() {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith("sb-") || !key.includes("auth-token")) continue;
        try {
          const parsed = JSON.parse(storage.getItem(key) || "null");
          const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
          if (token) return token;
        } catch { /* autre donnée */ }
      }
    }
    return "";
  }

  function localState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return parsed && typeof parsed === "object" ? parsed : { pickupLists: [], items: [] };
    } catch {
      return { pickupLists: [], items: [] };
    }
  }

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function toast(message) {
    const element = document.querySelector("#toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("show"), 4000);
  }

  async function apiRequest({ method = "GET", body = null } = {}) {
    const token = storedAccessToken();
    if (!token) throw new Error("Connexion requise");
    const response = await fetch(method === "GET" ? "/api/me?view=events" : "/api/me", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Événements indisponibles");
    return result;
  }

  function appAvailable() {
    const shell = document.querySelector("#appShell");
    return Boolean(shell && !shell.hidden && storedAccessToken());
  }

  function parseLocalDate(event, useEnd = false) {
    const time = useEnd && event.endTime ? event.endTime : event.startTime;
    const date = new Date(`${event.date}T${time || "00:00"}:00`);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function statusInfo(event) {
    if (event.cancelled) return { key: "cancelled", label: "Annulé" };
    const start = parseLocalDate(event);
    if (!start) return { key: "upcoming", label: "À venir" };
    const explicitEnd = parseLocalDate(event, true);
    const end = event.endTime && explicitEnd ? explicitEnd : new Date(start.getTime() + 4 * 60 * 60 * 1000);
    const now = new Date();
    if (now < start) return { key: "upcoming", label: "À venir" };
    if (now <= end) return { key: "active", label: "En cours" };
    return { key: "completed", label: "Terminé" };
  }

  function eventIsPast(event) {
    const status = statusInfo(event);
    if (status.key === "completed") return true;
    if (status.key !== "cancelled") return false;
    const start = parseLocalDate(event);
    return Boolean(start && start.getTime() < Date.now());
  }

  function formatEventDate(event, long = false) {
    const date = parseLocalDate(event);
    if (!date) return event.date || "Date inconnue";
    try {
      return new Intl.DateTimeFormat("fr-CA", long
        ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
        : { day: "numeric", month: "short", year: "numeric" }).format(date);
    } catch {
      return event.date;
    }
  }

  function monthLabel(event) {
    const date = parseLocalDate(event);
    if (!date) return "";
    return new Intl.DateTimeFormat("fr-CA", { month: "short" }).format(date).replace(".", "").toUpperCase();
  }

  function dayLabel(event) {
    const date = parseLocalDate(event);
    return date ? String(date.getDate()) : "—";
  }

  function timeLabel(event) {
    return event.endTime ? `${event.startTime} – ${event.endTime}` : event.startTime;
  }

  function currentUserJoined(event) {
    return Boolean(data.currentUser?.id && (event.participantIds || []).includes(data.currentUser.id));
  }

  function pickupById(id) {
    return (localState().pickupLists || []).find(list => list.id === id) || null;
  }

  function pickupProgress(id) {
    const state = localState();
    const pickup = (state.pickupLists || []).find(list => list.id === id);
    if (!pickup) return null;
    const items = (pickup.itemIds || []).map(itemId => (state.items || []).find(item => item.id === itemId)).filter(Boolean);
    const completed = items.filter(item => ["rempli", "introuvable"].includes(item.status)).length;
    return { total: items.length, completed };
  }

  function pickupMarkup(event) {
    if (!(event.pickupListIds || []).length) return "";
    return `<div class="event-linked-lists"><strong>Listes de ramassage</strong><div class="event-list-chips">${event.pickupListIds.map(id => {
      const list = pickupById(id);
      const progress = pickupProgress(id);
      const name = list?.name || "Liste indisponible";
      const count = progress ? `${progress.completed}/${progress.total}` : "";
      return `<button class="event-list-chip" type="button" data-event-pickup="${escapeHTML(id)}" ${list ? "" : "disabled"}><span>⇢</span><span>${escapeHTML(name)}</span>${count ? `<small>${count}</small>` : ""}</button>`;
    }).join("")}</div></div>`;
  }

  function participantsMarkup(event) {
    const participants = event.participants || [];
    if (!participants.length) return `<span class="muted">Aucun participant inscrit</span>`;
    return participants.map(person => `<span class="event-person">${escapeHTML(person.name)}</span>`).join("");
  }

  function actionMarkup(event) {
    const status = statusInfo(event);
    const joined = currentUserJoined(event);
    const canRegister = !event.cancelled && status.key !== "completed";
    return `<div class="event-actions">
      ${canRegister ? joined
        ? `<button class="button" type="button" data-event-action="leave" data-event-id="${event.id}">Se désinscrire</button>`
        : `<button class="button primary" type="button" data-event-action="join" data-event-id="${event.id}">S’inscrire à l’événement</button>` : ""}
      ${data.canManage ? `<button class="button" type="button" data-event-action="edit" data-event-id="${event.id}">Modifier</button><button class="button danger" type="button" data-event-action="delete" data-event-id="${event.id}">Supprimer</button>` : ""}
    </div>`;
  }

  function eventCard(event) {
    const status = statusInfo(event);
    const joined = currentUserJoined(event);
    return `<article class="card event-card ${highlightEventId === event.id ? "event-highlight" : ""}" data-event-card="${event.id}">
      <div class="event-date-tile"><span>${escapeHTML(monthLabel(event))}</span><strong>${escapeHTML(dayLabel(event))}</strong></div>
      <div class="event-card-body">
        <div class="event-card-head"><div><div class="event-badges"><span class="event-status ${status.key}">${status.label}</span>${joined ? `<span class="event-joined">Inscrit</span>` : ""}</div><h3>${escapeHTML(event.title)}</h3></div><span class="event-time">${escapeHTML(timeLabel(event))}</span></div>
        <p class="event-date-line">${escapeHTML(formatEventDate(event, true))}${event.location ? ` · ${escapeHTML(event.location)}` : ""}</p>
        ${event.description ? `<p class="event-description">${escapeHTML(event.description)}</p>` : ""}
        <div class="event-participants"><strong>Participants (${(event.participantIds || []).length})</strong><div class="event-people">${participantsMarkup(event)}</div></div>
        ${pickupMarkup(event)}
        ${actionMarkup(event)}
      </div>
    </article>`;
  }

  function checkboxList(values, selected, name, type) {
    const selectedSet = new Set(selected || []);
    if (!values.length) return `<p class="small muted">Aucun ${type === "users" ? "utilisateur" : "liste de ramassage"} disponible.</p>`;
    return `<div class="event-checkbox-grid">${values.map(value => `<label class="event-check"><input type="checkbox" name="${name}" value="${escapeHTML(value.id)}" ${selectedSet.has(value.id) ? "checked" : ""}><span><strong>${escapeHTML(value.name)}</strong>${type === "users" ? `<small>${escapeHTML(value.role || "employee")}</small>` : ""}</span></label>`).join("")}</div>`;
  }

  function editorMarkup() {
    if (!data.canManage || editorEventId === null) return "";
    const existing = editorEventId ? data.events.find(event => event.id === editorEventId) : null;
    const state = localState();
    const lists = (state.pickupLists || []).map(list => ({ id: list.id, name: list.name || "Liste de ramassage" }));
    return `<div class="event-dialog-backdrop" data-event-action="close-editor"><div class="event-dialog" role="dialog" aria-modal="true" aria-labelledby="eventEditorTitle">
      <div class="section-head"><div><p class="eyebrow">${existing ? "MODIFICATION" : "NOUVEL ÉVÉNEMENT"}</p><h2 id="eventEditorTitle">${existing ? escapeHTML(existing.title) : "Créer un événement"}</h2></div><button class="button compact" type="button" data-event-action="close-editor">Fermer</button></div>
      <form id="eventEditorForm" data-event-id="${existing?.id || ""}">
        <div class="form-grid">
          <label class="full">Titre<input name="title" required maxlength="120" value="${escapeHTML(existing?.title || "")}" placeholder="Ex. Remplissage saisonnier – soirée"></label>
          <label>Date<input name="date" type="date" required value="${escapeHTML(existing?.date || "")}"></label>
          <label>Lieu / point de rencontre<input name="location" maxlength="160" value="${escapeHTML(existing?.location || "")}" placeholder="Ex. Réception, porte 4"></label>
          <label>Heure de début<input name="startTime" type="time" required value="${escapeHTML(existing?.startTime || "")}"></label>
          <label>Heure de fin <span class="field-hint">facultative</span><input name="endTime" type="time" value="${escapeHTML(existing?.endTime || "")}"></label>
          <label class="full">Description<textarea name="description" maxlength="1500" placeholder="Objectif, consignes et informations utiles…">${escapeHTML(existing?.description || "")}</textarea></label>
          <div class="full event-editor-section"><div class="field-title">Listes de ramassage associées</div><p class="field-hint">Les listes restent indépendantes; l’événement crée simplement des liens vers celles-ci.</p>${checkboxList(lists, existing?.pickupListIds || [], "pickupListIds", "lists")}</div>
          <div class="full event-editor-section"><div class="field-title">Participants</div><p class="field-hint">Les employés peuvent aussi s’inscrire eux-mêmes depuis l’événement.</p>${checkboxList(data.users || [], existing?.participantIds || [], "participantIds", "users")}</div>
          ${existing ? `<label class="full check-card"><span><input name="cancelled" type="checkbox" ${existing.cancelled ? "checked" : ""}> Événement annulé</span><span class="field-hint">Les participants seront notifiés lors d’une nouvelle annulation.</span></label>` : ""}
        </div>
        <div class="form-actions"><button class="button primary" type="submit">${existing ? "Enregistrer les changements" : "Créer l’événement"}</button><button class="button" type="button" data-event-action="close-editor">Annuler</button></div>
      </form>
    </div></div>`;
  }

  function renderEvents() {
    const main = document.querySelector("#appMain");
    if (!main || !eventsOpen) return;
    rendering = true;
    document.querySelector("#pageTitle").textContent = "Événements";
    activateEventsNav();

    const upcoming = data.events.filter(event => !eventIsPast(event));
    const past = data.events.filter(eventIsPast).sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`));
    main.innerHTML = `<div data-events-root>
      <section class="section"><div class="section-head"><div><h2>Événements</h2><p class="muted">Consulte les événements à venir, inscris-toi et ouvre les listes de travail associées.</p></div>${data.canManage ? `<button class="button primary" type="button" data-event-action="new">+ Nouvel événement</button>` : ""}</div>
        ${loading && !data.events.length ? `<div class="card event-loading">Chargement des événements…</div>` : ""}
        ${upcoming.length ? `<div class="event-list">${upcoming.map(eventCard).join("")}</div>` : `<div class="card empty"><div class="icon">▣</div><h3>Aucun événement à venir</h3><p>Les prochains événements apparaîtront ici.</p></div>`}
      </section>
      ${past.length ? `<section class="section"><details class="event-past" open><summary>Événements passés (${past.length})</summary><div class="event-list top-gap">${past.map(eventCard).join("")}</div></details></section>` : ""}
      ${editorMarkup()}
    </div>`;
    rendering = false;
    if (highlightEventId) {
      requestAnimationFrame(() => {
        const card = main.querySelector(`[data-event-card="${CSS.escape(highlightEventId)}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => { highlightEventId = ""; card?.classList.remove("event-highlight"); }, 2800);
      });
    }
  }

  function activateEventsNav() {
    document.querySelectorAll(".bottom-nav .nav-button").forEach(button => {
      const active = button.id === "eventsNavButton";
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
  }

  async function refreshEvents({ silent = false } = {}) {
    if (loading || !appAvailable()) return;
    loading = true;
    if (eventsOpen && !silent) renderEvents();
    try {
      data = await apiRequest();
      lastLoadedAt = Date.now();
      if (eventsOpen) renderEvents(); else enhanceDashboard();
    } catch (error) {
      if (!silent) toast(error.message);
    } finally {
      loading = false;
      if (eventsOpen) renderEvents();
    }
  }

  function openEvents(eventId = "") {
    eventsOpen = true;
    editorEventId = null;
    highlightEventId = eventId || "";
    activateEventsNav();
    renderEvents();
    if (Date.now() - lastLoadedAt > 5000) refreshEvents({ silent: Boolean(data.events.length) });
  }

  function closeEventsMode() {
    eventsOpen = false;
    editorEventId = null;
  }

  async function mutate(action, body, successMessage) {
    try {
      await apiRequest({ method: "POST", body: { action, ...body } });
      toast(successMessage);
      await refreshEvents({ silent: true });
      document.dispatchEvent(new CustomEvent("events:changed"));
    } catch (error) {
      toast(error.message);
      throw error;
    }
  }

  async function saveEditor(form) {
    const formData = new FormData(form);
    const eventId = String(form.dataset.eventId || "");
    const payload = {
      title: formData.get("title"),
      date: formData.get("date"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
      location: formData.get("location"),
      description: formData.get("description"),
      pickupListIds: formData.getAll("pickupListIds"),
      participantIds: formData.getAll("participantIds"),
      cancelled: Boolean(formData.get("cancelled"))
    };
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await mutate(eventId ? "eventUpdate" : "eventCreate", eventId ? { eventId, event: payload } : { event: payload }, eventId ? "Événement modifié" : "Événement créé");
      editorEventId = null;
      renderEvents();
    } finally {
      button.disabled = false;
    }
  }

  async function openPickup(pickupId) {
    const list = pickupById(pickupId);
    if (!list) return toast("Cette liste de ramassage n’est plus disponible");
    closeEventsMode();
    document.querySelector('[data-nav="pickups"]')?.click();
    await new Promise(resolve => setTimeout(resolve, 180));
    const button = document.querySelector(`.pickup-card [data-id="${CSS.escape(pickupId)}"]`);
    const card = button?.closest(".pickup-card");
    if (!card) return;
    card.classList.add("event-pickup-target");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => card.classList.remove("event-pickup-target"), 2600);
  }

  function activeEvent() {
    return data.events.find(event => statusInfo(event).key === "active") || null;
  }

  function enhanceDashboard() {
    if (eventsOpen || !appAvailable()) return;
    const main = document.querySelector("#appMain");
    if (!main || document.querySelector("#pageTitle")?.textContent !== "Aperçu") return;
    main.querySelector("[data-active-event-dashboard]")?.remove();
    const event = activeEvent();
    if (!event) return;
    const firstSection = main.querySelector(".section");
    if (!firstSection) return;
    const section = document.createElement("section");
    section.className = "section";
    section.dataset.activeEventDashboard = "true";
    section.innerHTML = `<article class="card active-event-dashboard"><div><p class="eyebrow">ÉVÉNEMENT EN COURS</p><h2>${escapeHTML(event.title)}</h2><p class="muted">${escapeHTML(timeLabel(event))}${event.location ? ` · ${escapeHTML(event.location)}` : ""}</p><div class="tags"><span class="tag">${(event.participantIds || []).length} participant${event.participantIds?.length === 1 ? "" : "s"}</span><span class="tag">${(event.pickupListIds || []).length} liste${event.pickupListIds?.length === 1 ? "" : "s"}</span></div></div><button class="button primary" type="button" data-event-action="open" data-event-id="${event.id}">Ouvrir l’événement</button></article>`;
    firstSection.insertAdjacentElement("afterend", section);
  }

  function installStyles() {
    if (document.querySelector("#eventsUiStyles")) return;
    const style = document.createElement("style");
    style.id = "eventsUiStyles";
    style.textContent = `
      .event-list{display:grid;gap:14px}.event-card{display:grid;grid-template-columns:72px minmax(0,1fr);gap:16px;align-items:start}.event-date-tile{display:grid;place-items:center;padding:10px 6px;border-radius:16px;background:var(--surface-2);color:var(--brand-2)}.event-date-tile span{font-size:11px;font-weight:900;letter-spacing:.08em}.event-date-tile strong{font-size:30px;line-height:1.1}.event-card-body{min-width:0}.event-card-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.event-card-head h3{margin-top:7px;font-size:19px}.event-badges{display:flex;gap:6px;flex-wrap:wrap}.event-status,.event-joined{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:850}.event-status.upcoming{background:#fff1d7;color:#805500}.event-status.active{background:#def2e7;color:#176443}.event-status.completed{background:#ece8e5;color:#655952}.event-status.cancelled{background:#fee5e5;color:#8c3232}.event-joined{background:#ffe0cc;color:#8d3500}.event-time{font-weight:850;white-space:nowrap}.event-date-line,.event-description{margin:8px 0;color:var(--muted)}.event-description{white-space:pre-line;color:var(--text)}.event-participants,.event-linked-lists{margin-top:14px}.event-people,.event-list-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}.event-person{display:inline-flex;padding:6px 9px;border-radius:999px;background:#f6f0ec;font-size:12px}.event-list-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:12px;background:white;padding:8px 10px;color:var(--text);font-weight:750}.event-list-chip small{padding:2px 5px;border-radius:999px;background:var(--surface-2);color:var(--brand-2)}.event-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.event-past>summary{font-weight:850;cursor:pointer;padding:8px 2px}.event-dialog-backdrop{position:fixed;inset:0;z-index:1100;background:rgba(35,28,24,.45);display:grid;place-items:center;padding:18px}.event-dialog{width:min(760px,100%);max-height:calc(100vh - 36px);overflow:auto;background:var(--surface);border-radius:22px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.28)}.event-editor-section{margin-top:16px}.event-checkbox-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.event-check{display:flex;grid-template-columns:none;flex-direction:row;align-items:center;gap:9px;margin:0;padding:10px;border:1px solid var(--line);border-radius:12px;background:#fbf7f4}.event-check input{width:19px;height:19px;flex:0 0 auto}.event-check span{display:grid;gap:2px}.event-check small{color:var(--muted);font-weight:500}.active-event-dashboard{display:flex;justify-content:space-between;align-items:center;gap:16px;border-color:rgba(249,99,2,.38);background:#fff9f5}.event-highlight,.event-pickup-target{animation:eventTarget 2.6s ease}.event-loading{text-align:center;color:var(--muted)}@keyframes eventTarget{0%,100%{box-shadow:0 3px 12px rgba(92,46,18,.05)}18%,72%{border-color:var(--brand);box-shadow:0 0 0 4px rgba(249,99,2,.18),var(--shadow)}}@media(max-width:700px){.event-card{grid-template-columns:58px minmax(0,1fr);gap:11px;padding:14px}.event-date-tile strong{font-size:25px}.event-card-head{display:block}.event-time{display:block;margin-top:8px}.event-checkbox-grid{grid-template-columns:1fr}.active-event-dashboard{align-items:stretch;flex-direction:column}.active-event-dashboard .button{width:100%}.bottom-nav{width:min(680px,calc(100% - 12px));gap:2px;padding:6px}.bottom-nav .nav-button small{font-size:8.5px}.bottom-nav .nav-button span{font-size:18px}}
    `;
    document.head.appendChild(style);
  }

  function enhanceNotificationIcons() {
    document.querySelectorAll('[data-notification-open*=":event_"]').forEach(item => {
      const icon = item.querySelector(".notification-item-icon");
      if (icon) icon.textContent = "▣";
    });
  }

  function notificationEventId(notificationId) {
    const parts = String(notificationId || "").split(":");
    return parts.length >= 5 && String(parts[2] || "").startsWith("event_") ? parts[3] : "";
  }

  document.addEventListener("click", event => {
    const standardNav = event.target.closest(".bottom-nav [data-nav]");
    if (standardNav) closeEventsMode();
  }, true);

  document.addEventListener("click", async event => {
    const notificationItem = event.target.closest("[data-notification-open]");
    const notificationId = notificationItem?.dataset.notificationOpen || "";
    const linkedEventId = notificationEventId(notificationId);
    if (notificationItem && linkedEventId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.querySelector("#notificationBackdrop")?.setAttribute("hidden", "");
      apiRequest({ method: "POST", body: { action: "notificationRead", notificationId } }).catch(() => {});
      return openEvents(linkedEventId);
    }

    const nav = event.target.closest("#eventsNavButton");
    if (nav) return openEvents();
    const actionButton = event.target.closest("[data-event-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.eventAction;
    const eventId = actionButton.dataset.eventId || "";
    if (action === "open") return openEvents(eventId);
    if (action === "new") { editorEventId = ""; return renderEvents(); }
    if (action === "edit") { editorEventId = eventId; return renderEvents(); }
    if (action === "close-editor") {
      if (event.target === actionButton || actionButton.matches("button")) { editorEventId = null; return renderEvents(); }
      return;
    }
    if (action === "join") return mutate("eventJoin", { eventId }, "Inscription confirmée");
    if (action === "leave") return mutate("eventLeave", { eventId }, "Tu es désinscrit de l’événement");
    if (action === "delete") {
      const target = data.events.find(entry => entry.id === eventId);
      if (!confirm(`Supprimer l’événement « ${target?.title || "Événement"} »? Les participants seront avisés.`)) return;
      return mutate("eventDelete", { eventId }, "Événement supprimé");
    }
  }, true);

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-event-pickup]");
    if (button) openPickup(button.dataset.eventPickup);
  });

  document.addEventListener("submit", event => {
    if (event.target.id !== "eventEditorForm") return;
    event.preventDefault();
    saveEditor(event.target).catch(() => {});
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", event => {
      const payload = event.data || {};
      if (payload.type !== "push-notification-click") return;
      const eventId = notificationEventId(payload.notificationId);
      if (!eventId) return;
      event.stopImmediatePropagation?.();
      openEvents(eventId);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    const main = document.querySelector("#appMain");
    if (main) {
      new MutationObserver(() => {
        if (rendering) return;
        enhanceNotificationIcons();
        if (eventsOpen && !main.querySelector("[data-events-root]")) renderEvents();
        else if (!eventsOpen) enhanceDashboard();
      }).observe(main, { childList: true, subtree: true });
    }
    new MutationObserver(enhanceNotificationIcons).observe(document.body, { childList: true, subtree: true });

    const query = new URLSearchParams(location.search);
    const initialEventId = notificationEventId(query.get("notification"));
    const waitForApp = window.setInterval(() => {
      if (!appAvailable()) return;
      window.clearInterval(waitForApp);
      refreshEvents({ silent: true }).then(() => {
        if (initialEventId) openEvents(initialEventId);
        else enhanceDashboard();
      });
    }, 350);

    window.setInterval(() => {
      if (!appAvailable() || document.visibilityState !== "visible") return;
      refreshEvents({ silent: true });
    }, REFRESH_INTERVAL);
  });
})();
