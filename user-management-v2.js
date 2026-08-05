(() => {
  const STORAGE_KEY = "restock_app_v1";
  const ROLE_LABELS = { employee: "Employé", supervisor: "Superviseur", admin: "Administrateur" };
  const ROLE_ORDER = ["admin", "supervisor", "employee"];
  const CACHE_MS = 10000;
  let cachedUsers = [];
  let cacheAt = 0;
  let rendering = false;
  let refreshTimer = null;

  function escapeHTML(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function normalizeRoles(user) {
    const roles = Array.isArray(user?.roles) ? user.roles : [user?.role || "employee"];
    return [...new Set(roles.filter(role => ROLE_LABELS[role]))];
  }

  function normalizeDepartments(user) {
    return [...new Set((Array.isArray(user?.departmentIds) ? user.departmentIds : []).map(String).filter(Boolean))];
  }

  function readDepartments() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return (Array.isArray(snapshot?.departments) ? snapshot.departments : [])
        .map(entry => ({ id: String(entry?.id || ""), name: String(entry?.name || "").trim() }))
        .filter(entry => entry.id && entry.name)
        .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
    } catch {
      return [];
    }
  }

  function storedAccessToken() {
    const stores = [localStorage, sessionStorage];
    for (const storage of stores) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith("sb-") || !key.includes("auth-token")) continue;
        try {
          const parsed = JSON.parse(storage.getItem(key) || "null");
          const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
          if (token) return token;
        } catch { /* clé non pertinente */ }
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

  async function apiRequest(options = {}) {
    const token = storedAccessToken();
    if (!token) throw new Error("Session introuvable. Reconnecte-toi.");
    const response = await fetch("/api/users", {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Gestion des utilisateurs impossible");
    return data;
  }

  function toast(message) {
    const element = document.querySelector("#toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("show"), 3600);
  }

  async function loadUsers(force = false) {
    if (!force && cachedUsers.length && Date.now() - cacheAt < CACHE_MS) return cachedUsers;
    const data = await apiRequest();
    cachedUsers = Array.isArray(data.users) ? data.users : [];
    cacheAt = Date.now();
    return cachedUsers;
  }

  function roleBadges(user) {
    return normalizeRoles(user).map(role => `<span class="tag um-role-${role}">${escapeHTML(ROLE_LABELS[role])}</span>`).join("");
  }

  function departmentBadges(user, departmentById) {
    const names = normalizeDepartments(user).map(id => departmentById.get(id)).filter(Boolean);
    return names.length
      ? names.map(name => `<span class="tag">${escapeHTML(name)}</span>`).join("")
      : `<span class="tag muted">Sans département</span>`;
  }

  function roleControls(user = {}, editable = true) {
    const selected = new Set(normalizeRoles(user));
    if (!selected.size) selected.add("employee");
    return `<fieldset class="um-choice-group" ${editable ? "" : "disabled"}>
      <legend>Rôles</legend>
      <div class="um-checkbox-grid">${ROLE_ORDER.slice().reverse().map(role => `
        <label class="check-card"><span><input type="checkbox" name="roles" value="${role}" ${selected.has(role) ? "checked" : ""}> ${ROLE_LABELS[role]}</span></label>
      `).join("")}</div>
    </fieldset>`;
  }

  function departmentControls(user, departments, editable = true) {
    const selected = new Set(normalizeDepartments(user));
    return `<fieldset class="um-choice-group" ${editable ? "" : "disabled"}>
      <legend>Département(s)</legend>
      ${departments.length ? `<div class="um-checkbox-grid">${departments.map(department => `
        <label class="check-card"><span><input type="checkbox" name="departmentIds" value="${escapeHTML(department.id)}" ${selected.has(department.id) ? "checked" : ""}> ${escapeHTML(department.name)}</span></label>
      `).join("")}</div>` : `<p class="small muted">Aucun département configuré.</p>`}
    </fieldset>`;
  }

  function groupCard(title, users, departmentById) {
    return `<article class="card um-group-card"><h3>${escapeHTML(title)}</h3>
      ${users.length ? `<div class="um-people-list">${users
        .slice()
        .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "fr", { sensitivity: "base" }))
        .map(user => `<div class="um-person-row"><strong>${escapeHTML(user.fullName)}</strong><div class="tags">${roleBadges(user)}${departmentBadges(user, departmentById)}</div></div>`)
        .join("")}</div>` : `<p class="small muted">Aucun employé.</p>`}
    </article>`;
  }

  function groupedOverview(users, departments) {
    const approved = users.filter(user => user.approvalStatus === "approved");
    const departmentById = new Map(departments.map(department => [department.id, department.name]));
    const byRole = ROLE_ORDER.map(role => groupCard(ROLE_LABELS[role], approved.filter(user => normalizeRoles(user).includes(role)), departmentById));
    const assignedIds = new Set(departments.map(department => department.id));
    const byDepartment = departments.map(department => groupCard(
      department.name,
      approved.filter(user => normalizeDepartments(user).includes(department.id)),
      departmentById
    ));
    byDepartment.push(groupCard(
      "Sans département",
      approved.filter(user => !normalizeDepartments(user).some(id => assignedIds.has(id))),
      departmentById
    ));

    return `<section class="section um-overview"><div class="section-head"><div><h2>Employés par rôle</h2><p class="muted">Un utilisateur ayant plusieurs rôles apparaît dans chaque groupe correspondant.</p></div></div><div class="grid um-group-grid">${byRole.join("")}</div></section>
      <section class="section um-overview"><div class="section-head"><div><h2>Employés par département</h2><p class="muted">Un utilisateur affecté à plusieurs départements apparaît dans chacun d’eux.</p></div></div><div class="grid um-group-grid">${byDepartment.join("")}</div></section>`;
  }

  function createUserSection(departments) {
    return `<section class="section"><article class="card"><div class="section-head"><div><h2>Créer un utilisateur</h2><p class="muted">Le compte sera approuvé immédiatement et le courriel sera déjà confirmé.</p></div></div>
      <form class="um-create-user-form">
        <div class="form-grid">
          <label>Nom complet<input name="fullName" required maxlength="80" autocomplete="off"></label>
          <label>Courriel<input name="email" type="email" required autocomplete="off"></label>
          <label>Mot de passe temporaire<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
          ${roleControls({ roles: ["employee"] }, true)}
          ${departmentControls({}, departments, true)}
          <label class="check-card"><span><input type="checkbox" name="hasLiftPermit"> Possède un permis de lift</span></label>
          <label>Numéro de permis<input name="liftPermitNumber" maxlength="80"></label>
          <label>Date d’expiration<input name="liftPermitExpiresAt" type="date"></label>
        </div>
        <div class="form-actions"><button class="button primary" type="submit">Créer le compte</button></div>
      </form>
    </article></section>`;
  }

  function pendingUserCard(user, departments, isAdmin) {
    return `<article class="card user-card"><form class="um-approval-form" data-user-id="${escapeHTML(user.id)}">
      <p class="eyebrow">EN ATTENTE</p><h3>${escapeHTML(user.fullName)}</h3><p class="small muted">${escapeHTML(user.email)}</p>
      ${isAdmin ? roleControls({ roles: ["employee"] }, true) : `<input type="hidden" name="roles" value="employee"><p><strong>Rôle :</strong> Employé</p>`}
      ${departmentControls(user, departments, true)}
      <div class="button-row"><button class="button primary" type="button" data-um-action="approve" data-user-id="${escapeHTML(user.id)}">Approuver</button><button class="button danger" type="button" data-um-action="reject" data-user-id="${escapeHTML(user.id)}">Refuser</button></div>
    </form></article>`;
  }

  function approvedUserCard(user, departments, isAdmin, currentUserId) {
    const isCurrent = user.id === currentUserId;
    return `<article class="card user-card"><form class="um-user-edit-form" data-user-id="${escapeHTML(user.id)}">
      <div class="section-head"><div><div class="tags">${roleBadges(user)}</div><h3>${escapeHTML(user.fullName)}</h3><p class="small muted">${escapeHTML(user.email)}</p></div><span class="status-badge approved">Approuvé</span></div>
      <label>Nom complet<input name="fullName" required maxlength="80" value="${escapeHTML(user.fullName)}"></label>
      ${roleControls(user, isAdmin)}
      ${departmentControls(user, departments, true)}
      <label class="check-card"><span><input type="checkbox" name="hasLiftPermit" ${user.hasLiftPermit ? "checked" : ""}> Possède un permis de lift</span></label>
      <label>Numéro de permis<input name="liftPermitNumber" maxlength="80" value="${escapeHTML(user.liftPermitNumber || "")}"></label>
      <label>Date d’expiration<input name="liftPermitExpiresAt" type="date" value="${escapeHTML(user.liftPermitExpiresAt || "")}"></label>
      ${isAdmin ? `<label>État<select name="approvalStatus"><option value="approved" selected>Approuvé</option><option value="pending">En attente</option><option value="rejected">Refusé</option></select></label>` : ""}
      ${isCurrent ? `<p class="tiny muted">Compte actuellement connecté.</p>` : ""}
      <div class="form-actions"><button class="button primary" type="submit">Enregistrer</button></div>
    </form></article>`;
  }

  function rejectedUserCard(user, departments, isAdmin) {
    return `<article class="card user-card"><form class="um-reactivate-form" data-user-id="${escapeHTML(user.id)}"><h3>${escapeHTML(user.fullName)}</h3><p class="small muted">${escapeHTML(user.email)}</p>
      ${isAdmin ? roleControls(user, true) : `<input type="hidden" name="roles" value="employee">`}
      ${departmentControls(user, departments, true)}
      <div class="button-row"><button class="button primary" type="button" data-um-action="reactivate" data-user-id="${escapeHTML(user.id)}">Réactiver</button></div>
    </form></article>`;
  }

  function renderManagement(users, departments, currentUserId) {
    const current = users.find(user => user.id === currentUserId);
    const isAdmin = normalizeRoles(current).includes("admin");
    const pending = users.filter(user => user.approvalStatus === "pending");
    const approved = users.filter(user => user.approvalStatus === "approved").sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "fr", { sensitivity: "base" }));
    const rejected = users.filter(user => user.approvalStatus === "rejected");

    return `<div id="userManagementV2">
      ${isAdmin ? createUserSection(departments) : ""}
      <section class="section"><div class="section-head"><div><h2>Demandes d’accès</h2><p class="muted">Les inscriptions autonomes demeurent en attente d’approbation.</p></div><button class="button" type="button" data-um-action="refresh">Actualiser</button></div>
        ${pending.length ? `<div class="user-grid">${pending.map(user => pendingUserCard(user, departments, isAdmin)).join("")}</div>` : `<div class="empty-state"><h3>Aucune demande en attente</h3><p>Les nouvelles inscriptions apparaîtront ici.</p></div>`}
      </section>
      ${groupedOverview(users, departments)}
      <section class="section"><div class="section-head"><div><h2>Gestion détaillée</h2><p class="muted">Rôles multiples, départements, permis de lift et état des comptes.</p></div></div><div class="user-grid">${approved.map(user => approvedUserCard(user, departments, isAdmin, currentUserId)).join("")}</div></section>
      ${rejected.length ? `<section class="section"><details class="card"><summary>Comptes refusés (${rejected.length})</summary><div class="user-grid top-gap">${rejected.map(user => rejectedUserCard(user, departments, isAdmin)).join("")}</div></details></section>` : ""}
    </div>`;
  }

  function installStyles() {
    if (document.querySelector("#userManagementV2Styles")) return;
    const style = document.createElement("style");
    style.id = "userManagementV2Styles";
    style.textContent = `
      #userManagementV2 .um-choice-group { margin: .8rem 0; padding: .8rem; border: 1px solid rgba(0,0,0,.1); border-radius: 16px; min-width: 0; }
      #userManagementV2 .um-choice-group legend { padding: 0 .35rem; font-weight: 800; }
      #userManagementV2 .um-checkbox-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: .55rem; }
      #userManagementV2 .um-checkbox-grid .check-card { margin: 0; padding: .7rem; }
      #userManagementV2 .um-group-grid { grid-template-columns: repeat(auto-fit, minmax(235px, 1fr)); }
      #userManagementV2 .um-group-card { min-width: 0; }
      #userManagementV2 .um-people-list { display: grid; gap: .7rem; }
      #userManagementV2 .um-person-row { padding-top: .7rem; border-top: 1px solid rgba(0,0,0,.08); }
      #userManagementV2 .um-person-row:first-child { padding-top: 0; border-top: 0; }
      #userManagementV2 .um-person-row .tags { margin-top: .35rem; }
      #userManagementV2 .um-role-admin { background: rgba(249,99,2,.13); }
      #userManagementV2 .um-role-supervisor { background: rgba(72,83,168,.13); }
      #userManagementV2 .um-role-employee { background: rgba(31,125,91,.12); }
      #userManagementV2 form[aria-busy="true"] { opacity: .65; pointer-events: none; }
      @media (max-width: 560px) {
        #userManagementV2 .um-checkbox-grid { grid-template-columns: 1fr; }
      }
    `;
    document.head.append(style);
  }

  async function renderPage(force = false) {
    const appMain = document.querySelector("#appMain");
    const title = document.querySelector("#pageTitle")?.textContent?.trim();
    if (!appMain || title !== "Utilisateurs" || rendering) return;
    if (!force && appMain.querySelector("#userManagementV2")) return;

    rendering = true;
    try {
      const token = storedAccessToken();
      const users = await loadUsers(force);
      if (document.querySelector("#pageTitle")?.textContent?.trim() !== "Utilisateurs") return;
      appMain.innerHTML = renderManagement(users, readDepartments(), jwtSubject(token));
    } catch (error) {
      appMain.innerHTML = `<section class="section"><div class="card"><h2>Gestion des utilisateurs indisponible</h2><p class="muted">${escapeHTML(error.message)}</p><button class="button" type="button" data-um-action="refresh">Réessayer</button></div></section>`;
    } finally {
      rendering = false;
    }
  }

  function scheduleRender(force = false) {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => renderPage(force), 30);
  }

  function payloadFromForm(form) {
    const data = new FormData(form);
    return {
      fullName: data.get("fullName"),
      email: data.get("email"),
      password: data.get("password"),
      roles: data.getAll("roles"),
      departmentIds: data.getAll("departmentIds"),
      approvalStatus: data.get("approvalStatus"),
      hasLiftPermit: Boolean(data.get("hasLiftPermit")),
      liftPermitNumber: data.get("liftPermitNumber"),
      liftPermitExpiresAt: data.get("liftPermitExpiresAt") || null
    };
  }

  async function submitAction(form, body, successMessage) {
    const button = form.querySelector("button[type='submit'], button[data-um-action]");
    form.setAttribute("aria-busy", "true");
    if (button) button.disabled = true;
    try {
      await apiRequest({ method: "POST", body });
      cachedUsers = [];
      cacheAt = 0;
      toast(successMessage);
      await renderPage(true);
    } catch (error) {
      toast(error.message);
    } finally {
      form.removeAttribute("aria-busy");
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    const appMain = document.querySelector("#appMain");
    if (!appMain) return;

    new MutationObserver(() => scheduleRender()).observe(appMain, { childList: true, subtree: false });
    new MutationObserver(() => scheduleRender()).observe(document.querySelector("#pageTitle"), { childList: true, characterData: true, subtree: true });

    appMain.addEventListener("submit", event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.closest("#userManagementV2")) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      if (form.matches(".um-create-user-form")) {
        const payload = payloadFromForm(form);
        if (!payload.roles.length) return toast("Sélectionne au moins un rôle");
        submitAction(form, { action: "create", ...payload }, "Utilisateur créé sans confirmation par courriel");
      } else if (form.matches(".um-user-edit-form")) {
        const payload = payloadFromForm(form);
        if (form.querySelector('[name="roles"]:not(:disabled)') && !payload.roles.length) return toast("Sélectionne au moins un rôle");
        submitAction(form, { action: "update", userId: form.dataset.userId, ...payload }, "Utilisateur mis à jour");
      }
    }, true);

    appMain.addEventListener("click", event => {
      const button = event.target.closest("[data-um-action]");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const action = button.dataset.umAction;

      if (action === "refresh") {
        cachedUsers = [];
        cacheAt = 0;
        renderPage(true);
        return;
      }

      const form = button.closest("form");
      if (!form) return;
      const payload = payloadFromForm(form);
      if (["approve", "reactivate"].includes(action) && !payload.roles.length) return toast("Sélectionne au moins un rôle");
      if (action === "reject" && !confirm("Refuser cette demande d’accès?")) return;

      if (action === "approve") submitAction(form, { action: "approve", userId: button.dataset.userId, ...payload }, "Utilisateur approuvé");
      if (action === "reactivate") submitAction(form, { action: "approve", userId: button.dataset.userId, ...payload }, "Utilisateur réactivé");
      if (action === "reject") submitAction(form, { action: "reject", userId: button.dataset.userId }, "Demande refusée");
    }, true);

    scheduleRender();
  });
})();
