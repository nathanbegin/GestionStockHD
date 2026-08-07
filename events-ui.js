(() => {
  const STORAGE_KEY = "restock_app_v1";
  const REFRESH_INTERVAL = 60000;
  const SESSION_CHECK_INTERVAL = 1500;
  const ROLE_LABELS = {
    employee: "Employé",
    supervisor: "Superviseur",
    admin: "Administrateur"
  };

  let data = { events: [], currentUser: null, canManage: false, users: [] };
  let eventsOpen = false;
  let editorEventId = null;
  let loading = false;
  let lastLoadedAt = 0;
  let activeSessionUserId = "";
  let pendingEventFromPush = "";

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

  function jwtSubject(token = storedAccessToken()) {
    try {
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
      return String(JSON.parse(atob(padded))?.sub || "");
    } catch {
      return "";
    }
  }

  function appAvailable() {
    const shell = document.querySelector("#appShell");
    return Boolean(shell && !shell.hidden && storedAccessToken());
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
    const end = event.endTime && explicitEnd
      ? explicitEnd
      : new Date(start.getTime() + 4 * 60 * 60 * 1000);
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
        : { day: "numeric", month: "short", year: "numeric" }
      ).format(date);
    } catch {
      return event.date || "Date inconnue";
    }
  }

  function monthLabel(event) {
    const date = parseLocalDate(event);
    if (!date) return "";
    return new Intl.DateTimeFormat("fr-CA", { month: "short" })
      .format(date).replace(".", "").toUpperCase();
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
    return (localState().pickupLists || []).find(list => String(list.id) === String(id)) || null;
  }

  function pickupProgress(id) {
    const state = localState();
    const pickup = (state.pickupLists || []).find(list => String(list.id) === String(id));
    if (!pickup) return null;
    const items = (pickup.itemIds || [])
      .map(itemId => (state.items || []).find(item => item.id === itemId))
      .filter(Boolean);
    const completed = items.filter(item => ["rempli", "introuvable"].includes(item.status)).length;
    return { total: items.length, completed };
  }

  function pickupMarkup(event) {
    if (!(event.pickupListIds || []).length) return "";
    const buttons = event.pickupListIds.map(id => {
      const list = pickupById(id);
      const progress = pickupProgress(id);
      const name = list?.name || "Liste indisponible";
      const count = progress ? `${progress.completed}/${progress.total}` : "";
      return `<button class="event-list-chip" type="button" data-event-pickup="${escapeHTML(id)}" ${list ? "" : "disabled"}><span>⇢</span><span>${escapeHTML(name)}</span>${count ? `<small>${escapeHTML(count)}</small>` : ""}</button>`;
    }).join("");
    return `<div class="event-linked-lists"><strong>Listes de ramassage</strong><div class="event-list-chips">${buttons}</div></div>`;
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
    const registration = canRegister
      ? joined
        ? `<button class="button" type="button" data-event-action="leave" data-event-id="${escapeHTML(event.id)}">Se désinscrire</button>`
        : `<button class="button primary" type="button" data-event-action="join" data-event-id="${escapeHTML(event.id)}">S’inscrire à l’événement</button>`
      : "";
    const management = data.canManage
      ? `<button class="button" type="button" data-event-action="edit" data-event-id="${escapeHTML(event.id)}">Modifier</button><button class="button danger" type="button" data-event-action="delete" data-event-id="${escapeHTML(event.id)}">Supprimer</button>`
      : "";
    return `<div class="event-actions">${registration}${management}</div>`;
  }

  function eventCard(event) {
    const status = statusInfo(event);
    const joined = currentUserJoined(event);
    return `<article class="card event-card" data-event-card="${escapeHTML(event.id)}">
      <div class="event-date-tile"><span>${escapeHTML(monthLabel(event))}</span><strong>${escapeHTML(dayLabel(event))}</strong></div>
      <div class="event-card-body">
        <div class="event-card-head">
          <div><div class="event-badges"><span class="event-status ${status.key}">${escapeHTML(status.label)}</span>${joined ? `<span class="event-joined">Inscrit</span>` : ""}</div><h3>${escapeHTML(event.title)}</h3></div>
          <span class="event-time">${escapeHTML(timeLabel(event))}</span>
        </div>
        <p class="event-date-line">${escapeHTML(formatEventDate(event, true))}${event.location ? ` · ${escapeHTML(event.location)}` : ""}</p>
        ${event.description ? `<p class="event-description">${escapeHTML(event.description)}</p>` : ""}
        <div class="event-participants"><strong>Participants (${(event.participantIds || []).length})</strong><div class="event-people">${participantsMarkup(event)}</div></div>
        ${pickupMarkup(event)}
        ${actionMarkup(event)}
      </div>
    </article>`;
  }

  function checkboxList(values, selected, name, kind) {
    const selectedSet = new Set(selected || []);
    if (!values.length) {
      return `<p class="small muted">Aucun ${kind === "users" ? "utilisateur" : "liste de ramassage"} disponible.</p>`;
    }
    return `<div class="event-checkbox-grid">${values.map(value => {
      const subtitle = kind === "users" ? ROLE_LABELS[value.role] || value.role || "Employé" : "";
      return `<label class="event-check"><input type="checkbox" name="${name}" value="${escapeHTML(value.id)}" ${selectedSet.has(value.id) ? "checked" : ""}><span><strong>${escapeHTML(value.name)}</strong>${subtitle ? `<small>${escapeHTML(subtitle)}</small>` : ""}</span></label>`;
    }).join("")}</div>`;
  }

  function editorMarkup() {
    if (!data.canManage || editorEventId === null) return "";
    const existing = editorEventId ? data.events.find(event => event.id === editorEventId) : null;
    const lists = (localState().pickupLists || []).map(list => ({
      id: list.id,
      name: list.name || "Liste de ramassage"
    }));
    return `<div class="event-dialog-backdrop" data-event-backdrop>
      <div class="event-dialog" role="dialog" aria-modal="true" aria-labelledby="eventEditorTitle">
        <div class="section-head"><div><p class="eyebrow">${existing ? "MODIFICATION" : "NOUVEL ÉVÉNEMENT"}</p><h2 id="eventEditorTitle">${existing ? escapeHTML(existing.title) : "Créer un événement"}</h2></div><button class="button compact" type="button" data-event-action="close-editor">Fermer</button></div>
        <form id="eventEditorForm" data-event-id="${escapeHTML(existing?.id || "")}">
          <div class="form-grid">
            <label class="full">Titre<input name="title" required maxlength="120" value="${escapeHTML(existing?.title || "")}" placeholder="Ex. Remplissage saisonnier – soirée"></label>
            <label>Date<input name="date" type="date" required value="${escapeHTML(existing?.date || "")}"></label>
            <label>Lieu / point de rencontre<input name="location" maxlength="160" value="${escapeHTML(existing?.location || "")}" placeholder="Ex. Réception, porte 4"></label>
            <label>Heure de début<input name="startTime" type="time" required value="${escapeHTML(existing?.startTime || "")}"></label>
            <label>Heure de fin <span class="field-hint">facultative</span><input name="endTime" type="time" value="${escapeHTML(existing?.endTime || "")}"></label>
            <label class="full">Description<textarea name="description" maxlength="1500" placeholder="Objectif, consignes et informations utiles…">${escapeHTML(existing?.description || "")}</textarea></label>
            <div class="full event-editor-section"><div class="field-title">Listes de ramassage associées</div><p class="field-hint">Les listes restent indépendantes; l’événement crée simplement des liens vers celles-ci.</p>${checkboxList(lists, existing?.pickupListIds || [], "pickupListIds", "lists")}</div>
            <div class="full event-editor-section"><div class="field-title">Participants</div><p class="field-hint">Les employés peuvent aussi s’inscrire eux-mêmes.</p>${checkboxList(data.users || [], existing?.participantIds || [], "participantIds", "users")}</div>
            ${existing ? `<label class="full check-card"><span><input name="cancelled" type="checkbox" ${existing.cancelled ? "checked" : ""}> Événement annulé</span><span class="field-hint">Les participants seront avisés lors d’une nouvelle annulation.</span></label>` : ""}
          </div>
          <div class="form-actions"><button class="button primary" type="submit">${existing ? "Enregistrer les changements" : "Créer l’événement"}</button><button class="button" type="button" data-event-action="close-editor">Annuler</button></div>
        </form>
      </div>
    </div>`;
  }

  function activateEventsNav() {
    document.querySelectorAll(".bottom-nav .nav-button").forEach(button => {
      const active = button.id === "eventsNavButton";
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function renderEvents() {
    if (!eventsOpen) return;
    const main = document.querySelector("#appMain");
    if (!main) return;
    const title = document.querySelector("#pageTitle");
    if (title) title.textContent = "Événements";
    activateEventsNav();

    const upcoming = data.events.filter(event => !eventIsPast(event));
    const past = data.events
      .filter(eventIsPast)
      .sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`));

    main.innerHTML = `<div data-events-root>
      <section class="section">
        <div class="section-head"><div><h2>Événements</h2><p class="muted">Consulte les événements à venir, inscris-toi et ouvre les listes de travail associées.</p></div>${data.canManage ? `<button class="button primary" type="button" data-event-action="new">+ Nouvel événement</button>` : ""}</div>
        ${loading && !lastLoadedAt ? `<div class="card event-loading">Chargement des événements…</div>` : upcoming.length ? `<div class="event-list">${upcoming.map(eventCard).join("")}</div>` : `<div class="card empty"><div class="icon">▣</div><h3>Aucun événement à venir</h3><p>Les prochains événements apparaîtront ici.</p></div>`}
      </section>
      ${past.length ? `<section class="section"><details class="event-past"><summary>Événements passés (${past.length})</summary><div class="event-list top-gap">${past.map(eventCard).join("")}</div></details></section>` : ""}
      ${editorMarkup()}
    </div>`;
  }

  function activeEvent() {
    return data.events.find(event => statusInfo(event).key === "active") || null;
  }

  function renderDashboardCard() {
    if (eventsOpen || !appAvailable()) return;
    const main = document.querySelector("#appMain");
    const pageTitle = document.querySelector("#pageTitle")?.textContent || "";
    if (!main || pageTitle !== "Aperçu") return;

    const existing = main.querySelector("[data-active-event-dashboard]");
    const event = activeEvent();
    if (!event) {
      existing?.remove();
      return;
    }

    const signature = `${event.id}|${event.updatedAt}|${event.participantIds?.length || 0}|${event.pickupListIds?.length || 0}`;
    if (existing?.dataset.eventSignature === signature) return;
    existing?.remove();

    const firstSection = main.querySelector(".section");
    if (!firstSection) return;
    const section = document.createElement("section");
    section.className = "section";
    section.dataset.activeEventDashboard = "true";
    section.dataset.eventSignature = signature;
    section.innerHTML = `<article class="card active-event-dashboard"><div><p class="eyebrow">ÉVÉNEMENT EN COURS</p><h2>${escapeHTML(event.title)}</h2><p class="muted">${escapeHTML(timeLabel(event))}${event.location ? ` · ${escapeHTML(event.location)}` : ""}</p><div class="tags"><span class="tag">${event.participantIds?.length || 0} participant${event.participantIds?.length === 1 ? "" : "s"}</span><span class="tag">${event.pickupListIds?.length || 0} liste${event.pickupListIds?.length === 1 ? "" : "s"}</span></div></div><button class="button primary" type="button" data-event-action="open" data-event-id="${escapeHTML(event.id)}">Ouvrir l’événement</button></article>`;
    firstSection.insertAdjacentElement("afterend", section);
  }

  async function refreshEvents({ silent = false } = {}) {
    if (loading || !appAvailable()) return;
    loading = true;
    if (eventsOpen && !lastLoadedAt) renderEvents();
    try {
      data = await apiRequest();
      lastLoadedAt = Date.now();
      if (eventsOpen) renderEvents();
      else renderDashboardCard();
    } catch (error) {
      if (!silent) toast(error.message);
    } finally {
      loading = false;
    }
  }

  function openEvents(eventId = "") {
    if (!appAvailable()) {
      pendingEventFromPush = eventId || pendingEventFromPush;
      return;
    }
    eventsOpen = true;
    editorEventId = null;
    renderEvents();
    if (Date.now() - lastLoadedAt > 10000) refreshEvents({ silent: Boolean(lastLoadedAt) });
    if (eventId) {
      window.setTimeout(() => {
        const card = document.querySelector(`[data-event-card="${CSS.escape(eventId)}"]`);
        if (!card) return;
        card.classList.add("event-highlight");
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => card.classList.remove("event-highlight"), 2600);
      }, 180);
    }
  }

  function closeEventsMode() {
    eventsOpen = false;
    editorEventId = null;
  }

  async function mutate(action, body, successMessage) {
    await apiRequest({ method: "POST", body: { action, ...body } });
    toast(successMessage);
    await refreshEvents({ silent: true });
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
    if (button) button.disabled = true;
    try {
      await mutate(
        eventId ? "eventUpdate" : "eventCreate",
        eventId ? { eventId, event: payload } : { event: payload },
        eventId ? "Événement modifié" : "Événement créé"
      );
      editorEventId = null;
      renderEvents();
    } catch (error) {
      toast(error.message);
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function openPickup(pickupId) {
    const list = pickupById(pickupId);
    if (!list) return toast("Cette liste de ramassage n’est plus disponible");
    closeEventsMode();
    document.querySelector('[data-nav="pickups"]')?.click();
    window.setTimeout(() => {
      const button = document.querySelector(`.pickup-card [data-id="${CSS.escape(String(pickupId))}"]`);
      const card = button?.closest(".pickup-card");
      if (!card) return;
      card.classList.add("event-pickup-target");
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => card.classList.remove("event-pickup-target"), 2600);
    }, 180);
  }

  function notificationEventId(notificationId) {
    const parts = String(notificationId || "").split(":");
    return parts.length >= 5 && String(parts[2] || "").startsWith("event_") ? parts[3] : "";
  }

  function checkSession() {
    const nextUserId = appAvailable() ? jwtSubject() : "";
    if (nextUserId === activeSessionUserId) return;

    activeSessionUserId = nextUserId;
    data = { events: [], currentUser: null, canManage: false, users: [] };
    lastLoadedAt = 0;
    loading = false;

    if (!nextUserId) {
      closeEventsMode();
      return;
    }

    refreshEvents({ silent: true }).then(() => {
      if (pendingEventFromPush) {
        const eventId = pendingEventFromPush;
        pendingEventFromPush = "";
        openEvents(eventId);
      } else {
        renderDashboardCard();
      }
    });
  }

  const query = new URLSearchParams(window.location.search);
  pendingEventFromPush = notificationEventId(query.get("notification"));

  document.addEventListener("click", event => {
    const standardNav = event.target.closest(".bottom-nav [data-nav]");
    if (!standardNav) return;
    closeEventsMode();
    if (standardNav.dataset.nav === "dashboard") {
      window.setTimeout(renderDashboardCard, 120);
    }
  }, true);

  document.addEventListener("click", event => {
    const notificationItem = event.target.closest("[data-notification-open]");
    const notificationId = notificationItem?.dataset.notificationOpen || "";
    const linkedEventId = notificationEventId(notificationId);
    if (notificationItem && linkedEventId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.querySelector("#notificationBackdrop")?.setAttribute("hidden", "");
      apiRequest({ method: "POST", body: { action: "notificationRead", notificationId } }).catch(() => {});
      openEvents(linkedEventId);
      return;
    }

    const nav = event.target.closest("#eventsNavButton");
    if (nav) {
      event.preventDefault();
      openEvents();
      return;
    }

    const actionButton = event.target.closest("[data-event-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.eventAction;
    const eventId = actionButton.dataset.eventId || "";

    if (action === "open") return openEvents(eventId);
    if (action === "new") {
      editorEventId = "";
      return renderEvents();
    }
    if (action === "edit") {
      editorEventId = eventId;
      return renderEvents();
    }
    if (action === "close-editor") {
      editorEventId = null;
      return renderEvents();
    }
    if (action === "join") {
      mutate("eventJoin", { eventId }, "Inscription confirmée").catch(error => toast(error.message));
      return;
    }
    if (action === "leave") {
      mutate("eventLeave", { eventId }, "Tu es désinscrit de l’événement").catch(error => toast(error.message));
      return;
    }
    if (action === "delete") {
      const target = data.events.find(entry => entry.id === eventId);
      if (!window.confirm(`Supprimer l’événement « ${target?.title || "Événement"} »? Les participants seront avisés.`)) return;
      mutate("eventDelete", { eventId }, "Événement supprimé").catch(error => toast(error.message));
    }
  }, true);

  document.addEventListener("click", event => {
    const backdrop = event.target.closest("[data-event-backdrop]");
    if (backdrop && event.target === backdrop) {
      editorEventId = null;
      renderEvents();
      return;
    }
    const pickup = event.target.closest("[data-event-pickup]");
    if (pickup) openPickup(pickup.dataset.eventPickup);
  });

  document.addEventListener("submit", event => {
    if (event.target.id !== "eventEditorForm") return;
    event.preventDefault();
    saveEditor(event.target);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", event => {
      const payload = event.data || {};
      if (payload.type !== "push-notification-click") return;
      const eventId = notificationEventId(payload.notificationId);
      if (!eventId) return;
      event.stopImmediatePropagation();
      if (appAvailable()) openEvents(eventId);
      else pendingEventFromPush = eventId;
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !appAvailable()) return;
    if (Date.now() - lastLoadedAt > REFRESH_INTERVAL) refreshEvents({ silent: true });
  });

  document.addEventListener("DOMContentLoaded", () => {
    checkSession();
    window.setInterval(checkSession, SESSION_CHECK_INTERVAL);
    window.setInterval(() => {
      if (!appAvailable() || document.visibilityState !== "visible") return;
      refreshEvents({ silent: true });
    }, REFRESH_INTERVAL);
  });
})();
