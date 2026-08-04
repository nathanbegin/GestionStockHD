const STORAGE_KEY = "restock_app_v1";
const SESSION_KEY = "restock_session_v1";
const STATUSES = ["a_remplir", "recupere", "rempli", "introuvable"];
const STATUS_LABELS = {
  a_remplir: "À remplir",
  recupere: "Récupéré",
  rempli: "Rempli",
  introuvable: "Introuvable"
};
const PRIORITY_LABELS = { high: "Élevée", medium: "Normale", low: "Faible" };

const defaultState = () => ({
  version: 1,
  lists: [
    { id: crypto.randomUUID(), name: "Tournée principale", updatedAt: new Date().toISOString() },
    { id: crypto.randomUUID(), name: "Urgences", updatedAt: new Date().toISOString() }
  ],
  departments: ["Quincaillerie", "Peinture", "Électricité", "Plomberie", "Jardinage", "Matériaux", "Cour extérieure"].map(name => ({ id: crypto.randomUUID(), name, updatedAt: new Date().toISOString() })),
  items: [],
  deletedIds: [],
  settings: { storeName: "Mon magasin", keepPhotos: false },
  meta: { updatedAt: new Date().toISOString(), lastSyncAt: null }
});

let state = loadState();
let session = loadSession();
let currentView = "dashboard";
let editingId = null;
let scanDraft = { photo: null, sku: "", name: "", confidence: null, rawText: "", barcode: "" };
let filters = { search: "", listId: "all", departmentId: "all", status: "open", priority: "all" };
let tourIndex = 0;

const els = {
  loginScreen: document.querySelector("#loginScreen"),
  loginForm: document.querySelector("#loginForm"),
  appShell: document.querySelector("#appShell"),
  appMain: document.querySelector("#appMain"),
  pageTitle: document.querySelector("#pageTitle"),
  syncButton: document.querySelector("#syncButton"),
  syncDot: document.querySelector("#syncDot"),
  syncLabel: document.querySelector("#syncLabel"),
  toast: document.querySelector("#toast"),
  importInput: document.querySelector("#importInput")
};

function loadState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value?.version === 1 ? value : defaultState();
  } catch { return defaultState(); }
}
function saveState({ touch = true } = {}) {
  if (touch) state.meta.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateSyncIndicator();
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
function saveSession(value) {
  session = value;
  localStorage.setItem(SESSION_KEY, JSON.stringify(value));
}
function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function listName(id) { return state.lists.find(x => x.id === id)?.name || "Sans liste"; }
function departmentName(id) { return state.departments.find(x => x.id === id)?.name || "Sans département"; }
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}
function updateSyncIndicator(mode = null) {
  const cloudConfigured = Boolean(state.meta.lastSyncAt);
  els.syncDot.className = `status-dot ${mode === "error" ? "error" : cloudConfigured ? "cloud" : "local"}`;
  els.syncLabel.textContent = mode === "working" ? "Synchro…" : mode === "error" ? "Erreur" : cloudConfigured ? "Cloud" : "Local";
}
function getOpenItems() { return state.items.filter(item => !["rempli", "introuvable"].includes(item.status)); }

function showApp() {
  els.loginScreen.hidden = true;
  els.appShell.hidden = false;
  render();
}
function showLogin() {
  els.loginScreen.hidden = false;
  els.appShell.hidden = true;
}
function setView(view) {
  currentView = view;
  if (view !== "manual") editingId = null;
  document.querySelectorAll("[data-nav]").forEach(btn => btn.classList.toggle("active", btn.dataset.nav === view));
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function render() {
  const titles = { dashboard: "Aperçu", scan: "Photo", manual: editingId ? "Modifier l’article" : "Ajouter", lists: "Listes", tour: "Mode remplissage", settings: "Réglages" };
  els.pageTitle.textContent = titles[currentView] || "Remplissage";
  const renderer = { dashboard: renderDashboard, scan: renderScan, manual: renderManual, lists: renderLists, tour: renderTour, settings: renderSettings }[currentView] || renderDashboard;
  els.appMain.innerHTML = renderer();
  updateSyncIndicator();
}

function renderDashboard() {
  const open = getOpenItems();
  const high = open.filter(x => x.priority === "high").length;
  const filled = state.items.filter(x => x.status === "rempli").length;
  const depts = new Set(open.map(x => x.departmentId)).size;
  const recent = [...state.items].sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);
  return `
    <section class="section">
      <div class="section-head"><div><h2>Bonjour ${escapeHTML(session?.name || "")}</h2><p class="muted">${escapeHTML(state.settings.storeName)} · ${new Date().toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}</p></div></div>
      <div class="grid stats-grid">
        <article class="card stat-card"><span class="stat-label">À traiter</span><strong>${open.length}</strong></article>
        <article class="card stat-card attention"><span class="stat-label">Priorité élevée</span><strong>${high}</strong></article>
        <article class="card stat-card"><span class="stat-label">Remplis</span><strong>${filled}</strong></article>
        <article class="card stat-card"><span class="stat-label">Départements actifs</span><strong>${depts}</strong></article>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>Actions rapides</h2><p class="muted">Relever un manque ou commencer la tournée.</p></div></div>
      <div class="grid actions-grid">
        <button class="card action-card" data-action="go" data-view="scan"><span class="icon">▣</span><h3>Prendre une photo</h3><p>Lire une étiquette et extraire le numéro d’article.</p></button>
        <button class="card action-card" data-action="go" data-view="manual"><span class="icon">＋</span><h3>Ajouter manuellement</h3><p>Saisir rapidement un article sans photo.</p></button>
        <button class="card action-card" data-action="go" data-view="lists"><span class="icon">☷</span><h3>Voir les listes</h3><p>Filtrer par département, statut ou priorité.</p></button>
        <button class="card action-card" data-action="go" data-view="tour"><span class="icon">→</span><h3>Commencer à remplir</h3><p>Parcourir les articles selon leur emplacement.</p></button>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>Activité récente</h2><p class="muted">Derniers articles modifiés.</p></div><button class="button compact" data-action="go" data-view="lists">Tout voir</button></div>
      ${recent.length ? `<div class="item-list">${recent.map(renderCompactItem).join("")}</div>` : renderEmpty("Aucun article", "Ajoute ton premier produit par photo ou manuellement.")}
    </section>`;
}
function renderCompactItem(item) {
  return `<article class="card item-card"><div class="item-top"><div class="item-title"><div class="item-qty">${Number(item.quantity) || 1}</div><div><h3>${escapeHTML(item.name || "Article sans description")}</h3><p class="sku">${escapeHTML(item.sku)}</p><p class="small muted">${escapeHTML(departmentName(item.departmentId))} · ${escapeHTML(listName(item.listId))}</p></div></div><button class="status-button" data-action="cycle-status" data-id="${item.id}" data-status="${item.status}">${STATUS_LABELS[item.status]}</button></div></article>`;
}
function renderEmpty(title, text) { return `<div class="card empty"><div class="icon">□</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p></div>`; }

function options(collection, selected, allLabel = null) {
  const head = allLabel !== null ? `<option value="all" ${selected === "all" ? "selected" : ""}>${escapeHTML(allLabel)}</option>` : "";
  return head + collection.map(x => `<option value="${x.id}" ${selected === x.id ? "selected" : ""}>${escapeHTML(x.name)}</option>`).join("");
}
function itemForm(item = {}) {
  const listId = item.listId || state.lists[0]?.id || "";
  const departmentId = item.departmentId || state.departments[0]?.id || "";
  return `<form id="itemForm" class="card">
    <div class="form-grid">
      <label>Numéro d’article / SKU<input name="sku" required maxlength="80" value="${escapeHTML(item.sku || "")}" placeholder="Ex. 1045832"></label>
      <label>Description<input name="name" maxlength="140" value="${escapeHTML(item.name || "")}" placeholder="Ex. Perceuse sans fil 20 V"></label>
      <label>Liste<select name="listId" required>${options(state.lists, listId)}</select></label>
      <label>Département<select name="departmentId" required>${options(state.departments, departmentId)}</select></label>
      <label>Quantité à remplir<input name="quantity" type="number" inputmode="numeric" min="1" max="999" required value="${Number(item.quantity) || 1}"></label>
      <label>Priorité<select name="priority"><option value="high" ${item.priority === "high" ? "selected" : ""}>Élevée</option><option value="medium" ${!item.priority || item.priority === "medium" ? "selected" : ""}>Normale</option><option value="low" ${item.priority === "low" ? "selected" : ""}>Faible</option></select></label>
      <label>Emplacement en tablette<input name="salesLocation" maxlength="120" value="${escapeHTML(item.salesLocation || "")}" placeholder="Allée 12, section B, tablette 3"></label>
      <label>Emplacement pour récupérer<input name="stockLocation" maxlength="120" value="${escapeHTML(item.stockLocation || "")}" placeholder="Entrepôt R4, niveau 2 ou cour zone B"></label>
      <label class="full">Note<textarea name="note" maxlength="500" placeholder="Détail utile, palette, variante…">${escapeHTML(item.note || "")}</textarea></label>
    </div>
    <div class="form-actions"><button class="button primary" type="submit">${editingId ? "Enregistrer les changements" : "Ajouter à la liste"}</button>${editingId ? `<button class="button" type="button" data-action="cancel-edit">Annuler</button>` : ""}</div>
  </form>`;
}
function renderManual() {
  const item = editingId ? state.items.find(x => x.id === editingId) : null;
  return `<section class="section"><div class="section-head"><div><h2>${item ? "Modifier l’article" : "Nouvel article"}</h2><p class="muted">Saisie rapide sans photographie.</p></div></div>${itemForm(item || {})}</section>`;
}

function renderScan() {
  return `<section class="section"><div class="section-head"><div><h2>Lire une étiquette</h2><p class="muted">Prends une photo nette, puis confirme le résultat avant l’ajout.</p></div></div>
    <div class="card">
      <label class="scan-zone" for="photoInput"><span class="scan-icon">▣</span><strong>${scanDraft.photo ? "Remplacer la photo" : "Prendre ou choisir une photo"}</strong><span class="small muted">Appuie ici pour ouvrir la caméra ou la galerie.</span><input id="photoInput" type="file" accept="image/*" capture="environment"></label>
      ${scanDraft.photo ? `<div class="preview"><img src="${scanDraft.photo}" alt="Aperçu de l’étiquette"></div><div class="button-row" style="margin-top:14px"><button class="button primary" data-action="analyze-photo">Analyser l’étiquette</button><button class="button" data-action="clear-photo">Effacer</button></div>` : ""}
      ${scanDraft.confidence !== null ? `<div class="analysis-box"><div class="button-row"><span class="confidence">Confiance ${Math.round(scanDraft.confidence * 100)} %</span>${scanDraft.barcode ? `<span class="tag">Code-barres ${escapeHTML(scanDraft.barcode)}</span>` : ""}</div><p class="small muted">${escapeHTML(scanDraft.rawText || "Résultat extrait. Vérifie les champs ci-dessous.")}</p></div>` : ""}
    </div></section>
    <section class="section"><div class="section-head"><div><h2>Résultat à confirmer</h2><p class="muted">La validation humaine évite les erreurs de lecture.</p></div></div>
      <form id="scanForm" class="card"><div class="form-grid">
        <label>Numéro d’article / SKU<input name="sku" required value="${escapeHTML(scanDraft.sku)}" placeholder="Numéro détecté"></label>
        <label>Description<input name="name" value="${escapeHTML(scanDraft.name)}" placeholder="Description détectée ou manuelle"></label>
        <label>Liste<select name="listId" required>${options(state.lists, state.lists[0]?.id || "")}</select></label>
        <label>Département<select name="departmentId" required>${options(state.departments, state.departments[0]?.id || "")}</select></label>
        <label>Quantité<input name="quantity" type="number" min="1" max="999" value="1" required></label>
        <label>Priorité<select name="priority"><option value="high">Élevée</option><option value="medium" selected>Normale</option><option value="low">Faible</option></select></label>
        <label>Emplacement tablette<input name="salesLocation" placeholder="Allée, section, tablette"></label>
        <label>Emplacement réserve<input name="stockLocation" placeholder="Entrepôt, rangée, cour"></label>
        <label class="full">Note<textarea name="note"></textarea></label>
        <label class="full"><span><input name="keepPhoto" type="checkbox" style="width:auto" ${state.settings.keepPhotos ? "checked" : ""}> Conserver une miniature de la photo avec l’article</span><span class="field-hint">Les photos occupent de l’espace dans le navigateur.</span></label>
      </div><div class="form-actions"><button class="button primary" type="submit">Ajouter à la liste</button></div></form>
    </section>`;
}

function filteredItems() {
  const q = filters.search.trim().toLowerCase();
  return state.items.filter(item => {
    if (q && ![item.sku, item.name, item.salesLocation, item.stockLocation, item.note].some(v => String(v || "").toLowerCase().includes(q))) return false;
    if (filters.listId !== "all" && item.listId !== filters.listId) return false;
    if (filters.departmentId !== "all" && item.departmentId !== filters.departmentId) return false;
    if (filters.priority !== "all" && item.priority !== filters.priority) return false;
    if (filters.status === "open" && ["rempli", "introuvable"].includes(item.status)) return false;
    if (filters.status !== "all" && filters.status !== "open" && item.status !== filters.status) return false;
    return true;
  }).sort((a,b) => {
    const p = { high: 0, medium: 1, low: 2 };
    return p[a.priority] - p[b.priority] || String(a.stockLocation || "zzz").localeCompare(String(b.stockLocation || "zzz"), "fr") || new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}
function renderLists() {
  const items = filteredItems();
  return `<section class="section"><div class="section-head"><div><h2>${items.length} article${items.length > 1 ? "s" : ""}</h2><p class="muted">Les articles ouverts sont triés par priorité puis emplacement de réserve.</p></div><button class="button primary" data-action="go" data-view="tour">Mode remplissage</button></div>
    <div class="toolbar">
      <input id="filterSearch" value="${escapeHTML(filters.search)}" placeholder="Rechercher SKU, produit ou emplacement">
      <select id="filterList">${options(state.lists, filters.listId, "Toutes les listes")}</select>
      <select id="filterDepartment">${options(state.departments, filters.departmentId, "Tous les départements")}</select>
      <select id="filterStatus"><option value="open" ${filters.status === "open" ? "selected" : ""}>À traiter</option><option value="all" ${filters.status === "all" ? "selected" : ""}>Tous les statuts</option>${STATUSES.map(s => `<option value="${s}" ${filters.status === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}</select>
      <select id="filterPriority"><option value="all">Toutes priorités</option><option value="high" ${filters.priority === "high" ? "selected" : ""}>Élevée</option><option value="medium" ${filters.priority === "medium" ? "selected" : ""}>Normale</option><option value="low" ${filters.priority === "low" ? "selected" : ""}>Faible</option></select>
    </div>
    ${items.length ? `<div class="item-list">${items.map(renderItemCard).join("")}</div>` : renderEmpty("Aucun résultat", "Modifie les filtres ou ajoute un nouvel article.")}
  </section>`;
}
function renderItemCard(item) {
  return `<article class="card item-card">
    <div class="item-top"><div class="item-title"><div class="item-qty">${Number(item.quantity) || 1}</div><div><h3>${escapeHTML(item.name || "Article sans description")}</h3><p class="sku">${escapeHTML(item.sku)}</p></div></div><button class="status-button" data-action="cycle-status" data-id="${item.id}" data-status="${item.status}">${STATUS_LABELS[item.status]}</button></div>
    <div class="tags"><span class="tag">${escapeHTML(listName(item.listId))}</span><span class="tag">${escapeHTML(departmentName(item.departmentId))}</span><span class="tag ${item.priority}">${PRIORITY_LABELS[item.priority]}</span><span class="tag">Par ${escapeHTML(item.updatedBy || item.createdBy || "—")}</span></div>
    <div class="location-grid"><div><strong>Tablette</strong>${escapeHTML(item.salesLocation || "Non précisé")}</div><div><strong>Réserve / récupération</strong>${escapeHTML(item.stockLocation || "Non précisé")}</div></div>
    ${item.note ? `<p class="small"><strong>Note :</strong> ${escapeHTML(item.note)}</p>` : ""}
    ${item.photo ? `<div class="preview"><img src="${item.photo}" alt="Photo de l’étiquette"></div>` : ""}
    <div class="item-actions"><button class="button compact" data-action="edit-item" data-id="${item.id}">Modifier</button><button class="button compact danger" data-action="delete-item" data-id="${item.id}">Supprimer</button><span class="tiny muted" style="align-self:center">Mis à jour ${formatDate(item.updatedAt)}</span></div>
  </article>`;
}

function renderTour() {
  const items = filteredItems().filter(x => !["rempli", "introuvable"].includes(x.status));
  if (!items.length) return `<section class="section">${renderEmpty("Tournée terminée", "Aucun article ouvert ne correspond aux filtres actuels.")}<div class="button-row" style="justify-content:center;margin-top:14px"><button class="button" data-action="go" data-view="lists">Retour aux listes</button></div></section>`;
  tourIndex = Math.max(0, Math.min(tourIndex, items.length - 1));
  const item = items[tourIndex];
  const pct = ((tourIndex + 1) / items.length) * 100;
  return `<section class="section"><article class="card tour-card">
    <div class="section-head"><div><p class="tour-number">Article ${tourIndex + 1} sur ${items.length}</p><h2>${escapeHTML(item.name || "Article sans description")}</h2><p class="sku">${escapeHTML(item.sku)}</p></div><div class="item-qty">${item.quantity}</div></div>
    <div class="tour-progress"><span style="width:${pct}%"></span></div>
    <div class="tags"><span class="tag">${escapeHTML(departmentName(item.departmentId))}</span><span class="tag ${item.priority}">${PRIORITY_LABELS[item.priority]}</span></div>
    <div class="location-grid" style="margin-top:16px"><div><strong>Aller chercher</strong>${escapeHTML(item.stockLocation || "Emplacement non précisé")}</div><div><strong>Remplir à</strong>${escapeHTML(item.salesLocation || "Emplacement non précisé")}</div></div>
    ${item.note ? `<p><strong>Note :</strong> ${escapeHTML(item.note)}</p>` : ""}
    <hr><div class="button-row"><button class="button secondary" data-action="tour-status" data-status="recupere" data-id="${item.id}">Marquer récupéré</button><button class="button primary" data-action="tour-status" data-status="rempli" data-id="${item.id}">Marquer rempli</button><button class="button danger" data-action="tour-status" data-status="introuvable" data-id="${item.id}">Introuvable</button></div>
    <div class="button-row" style="justify-content:space-between;margin-top:18px"><button class="button" data-action="tour-prev" ${tourIndex === 0 ? "disabled" : ""}>← Précédent</button><button class="button" data-action="tour-next" ${tourIndex >= items.length - 1 ? "disabled" : ""}>Suivant →</button></div>
  </article></section>`;
}

function renderSettings() {
  return `<section class="section"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(290px,1fr))">
    <article class="card"><h2>Magasin et utilisateur</h2><form id="storeForm"><label>Nom du magasin<input name="storeName" value="${escapeHTML(state.settings.storeName)}"></label><label><span><input type="checkbox" name="keepPhotos" style="width:auto" ${state.settings.keepPhotos ? "checked" : ""}> Conserver les photos par défaut</span></label><div class="form-actions"><button class="button primary" type="submit">Enregistrer</button><button class="button" type="button" data-action="logout">Déconnexion</button></div></form></article>
    <article class="card"><h2>Synchronisation</h2><p class="muted small">Les données fonctionnent localement. Supabase permet de les partager entre appareils.</p><p class="small"><strong>Dernière synchro :</strong> ${formatDate(state.meta.lastSyncAt)}</p><div class="button-row"><button class="button primary" data-action="sync">Synchroniser maintenant</button><button class="button" data-action="health">Tester les services</button></div><div id="healthResult" class="analysis-box" hidden></div></article>
    <article class="card"><h2>Listes</h2><form id="listForm" class="inline-form"><label>Nouvelle liste<input name="name" required maxlength="60" placeholder="Ex. Peinture du matin"></label><button class="button primary" type="submit">Ajouter</button></form><div class="manage-list">${state.lists.map(x => `<div class="manage-row"><span>${escapeHTML(x.name)}</span><button class="button compact danger" data-action="delete-list" data-id="${x.id}">Supprimer</button></div>`).join("")}</div></article>
    <article class="card"><h2>Départements</h2><form id="departmentForm" class="inline-form"><label>Nouveau département<input name="name" required maxlength="60" placeholder="Ex. Saisonnier"></label><button class="button primary" type="submit">Ajouter</button></form><div class="manage-list">${state.departments.map(x => `<div class="manage-row"><span>${escapeHTML(x.name)}</span><button class="button compact danger" data-action="delete-department" data-id="${x.id}">Supprimer</button></div>`).join("")}</div></article>
    <article class="card"><h2>Sauvegarde</h2><p class="muted small">Exporte une copie ou importe une sauvegarde existante.</p><div class="button-row"><button class="button" data-action="export-json">Exporter JSON</button><button class="button" data-action="export-csv">Exporter CSV</button><button class="button" data-action="import-json">Importer JSON</button></div></article>
  </div></section>`;
}

function formToItem(form, existing = {}) {
  const data = new FormData(form);
  const now = new Date().toISOString();
  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    sku: String(data.get("sku") || "").trim(),
    name: String(data.get("name") || "").trim(),
    listId: String(data.get("listId") || ""),
    departmentId: String(data.get("departmentId") || ""),
    quantity: Math.max(1, Number(data.get("quantity") || 1)),
    priority: String(data.get("priority") || "medium"),
    salesLocation: String(data.get("salesLocation") || "").trim(),
    stockLocation: String(data.get("stockLocation") || "").trim(),
    note: String(data.get("note") || "").trim(),
    status: existing.status || "a_remplir",
    createdAt: existing.createdAt || now,
    createdBy: existing.createdBy || session.name,
    updatedAt: now,
    updatedBy: session.name
  };
}
function upsertItem(item) {
  const index = state.items.findIndex(x => x.id === item.id);
  if (index >= 0) state.items[index] = item; else state.items.unshift(item);
  saveState();
}
function setStatus(id, status) {
  const item = state.items.find(x => x.id === id);
  if (!item) return;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  item.updatedBy = session.name;
  saveState();
}
function nextStatus(current) { return STATUSES[(STATUSES.indexOf(current) + 1) % STATUSES.length]; }

els.loginForm.addEventListener("submit", e => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  saveSession({ name: String(data.get("name")).trim(), pin: String(data.get("pin")) });
  showApp();
});
document.querySelectorAll("[data-nav]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.nav)));
els.syncButton.addEventListener("click", syncNow);

els.appMain.addEventListener("submit", e => {
  e.preventDefault();
  const form = e.target;
  if (form.id === "itemForm") {
    const existing = editingId ? state.items.find(x => x.id === editingId) : {};
    upsertItem(formToItem(form, existing));
    toast(editingId ? "Article modifié" : "Article ajouté");
    editingId = null;
    setView("lists");
  }
  if (form.id === "scanForm") {
    const item = formToItem(form);
    if (new FormData(form).get("keepPhoto") && scanDraft.photo) item.photo = scanDraft.photo;
    upsertItem(item);
    scanDraft = { photo: null, sku: "", name: "", confidence: null, rawText: "", barcode: "" };
    toast("Article ajouté depuis la photo");
    setView("lists");
  }
  if (form.id === "listForm" || form.id === "departmentForm") {
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;
    const target = form.id === "listForm" ? state.lists : state.departments;
    target.push({ id: crypto.randomUUID(), name, updatedAt: new Date().toISOString() });
    saveState(); render(); toast("Ajout enregistré");
  }
  if (form.id === "storeForm") {
    const data = new FormData(form);
    state.settings.storeName = String(data.get("storeName") || "Mon magasin").trim();
    state.settings.keepPhotos = Boolean(data.get("keepPhotos"));
    saveState(); toast("Réglages enregistrés"); render();
  }
});

els.appMain.addEventListener("change", async e => {
  if (e.target.id === "photoInput" && e.target.files?.[0]) await handlePhoto(e.target.files[0]);
  if (["filterList", "filterDepartment", "filterStatus", "filterPriority"].includes(e.target.id)) {
    const map = { filterList: "listId", filterDepartment: "departmentId", filterStatus: "status", filterPriority: "priority" };
    filters[map[e.target.id]] = e.target.value; render();
  }
});
els.appMain.addEventListener("input", e => {
  if (e.target.id === "filterSearch") { filters.search = e.target.value; clearTimeout(render.searchTimer); render.searchTimer = setTimeout(render, 180); }
});

els.appMain.addEventListener("click", async e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "go") setView(btn.dataset.view);
  if (action === "cancel-edit") { editingId = null; setView("lists"); }
  if (action === "edit-item") { editingId = btn.dataset.id; currentView = "manual"; render(); }
  if (action === "cycle-status") { setStatus(btn.dataset.id, nextStatus(btn.dataset.status)); render(); }
  if (action === "tour-status") { setStatus(btn.dataset.id, btn.dataset.status); toast(`Statut : ${STATUS_LABELS[btn.dataset.status]}`); render(); }
  if (action === "tour-next") { tourIndex++; render(); }
  if (action === "tour-prev") { tourIndex--; render(); }
  if (action === "delete-item") {
    if (!confirm("Supprimer cet article?")) return;
    state.items = state.items.filter(x => x.id !== btn.dataset.id); state.deletedIds.push(btn.dataset.id); saveState(); render(); toast("Article supprimé");
  }
  if (action === "delete-list") deleteManaged("list", btn.dataset.id);
  if (action === "delete-department") deleteManaged("department", btn.dataset.id);
  if (action === "clear-photo") { scanDraft = { photo: null, sku: "", name: "", confidence: null, rawText: "", barcode: "" }; render(); }
  if (action === "analyze-photo") await analyzePhoto(btn);
  if (action === "sync") await syncNow();
  if (action === "health") await checkHealth();
  if (action === "export-json") exportJSON();
  if (action === "export-csv") exportCSV();
  if (action === "import-json") els.importInput.click();
  if (action === "logout") { localStorage.removeItem(SESSION_KEY); session = null; showLogin(); }
});

function deleteManaged(type, id) {
  const inUse = state.items.some(x => type === "list" ? x.listId === id : x.departmentId === id);
  if (inUse) return toast("Impossible : cet élément est utilisé par des articles");
  const collection = type === "list" ? "lists" : "departments";
  if (state[collection].length <= 1) return toast("Il faut conserver au moins un élément");
  if (!confirm("Supprimer cet élément?")) return;
  state[collection] = state[collection].filter(x => x.id !== id); saveState(); render();
}
async function handlePhoto(file) {
  if (!file.type.startsWith("image/")) return toast("Choisis une image valide");
  scanDraft.photo = await compressImage(file, 1280, .75);
  scanDraft.confidence = null;
  render();
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      if (codes[0]?.rawValue) { scanDraft.barcode = codes[0].rawValue; if (!scanDraft.sku) scanDraft.sku = codes[0].rawValue; scanDraft.confidence = .9; render(); toast("Code-barres détecté"); }
    } catch { /* analyse IA disponible en repli */ }
  }
}
function compressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function analyzePhoto(btn) {
  if (!scanDraft.photo) return toast("Ajoute d’abord une photo");
  btn.disabled = true; btn.textContent = "Analyse…";
  try {
    const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", "x-app-pin": session.pin }, body: JSON.stringify({ image: scanDraft.photo }) });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { /* réponse non JSON */ }
    if (!response.ok) throw new Error(data.error || `Analyse impossible (HTTP ${response.status})`);
    scanDraft.sku = data.sku || data.barcode || scanDraft.sku;
    scanDraft.name = data.productName || scanDraft.name;
    scanDraft.barcode = data.barcode || scanDraft.barcode;
    scanDraft.confidence = typeof data.confidence === "number" ? data.confidence : .5;
    scanDraft.rawText = data.summary || data.visibleText || "Étiquette analysée";
    render(); toast("Analyse terminée — vérifie le résultat");
  } catch (error) { toast(error.message); btn.disabled = false; btn.textContent = "Analyser l’étiquette"; }
}
async function syncNow() {
  if (!session?.pin) return toast("Reconnecte-toi pour synchroniser");
  updateSyncIndicator("working");
  try {
    const response = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json", "x-app-pin": session.pin }, body: JSON.stringify({ snapshot: state }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Synchronisation impossible");
    state = data.snapshot;
    state.meta.lastSyncAt = new Date().toISOString();
    saveState({ touch: false }); render(); toast("Synchronisation terminée");
  } catch (error) { updateSyncIndicator("error"); toast(error.message); }
}
async function checkHealth() {
  const box = document.querySelector("#healthResult");
  box.hidden = false; box.textContent = "Vérification…";
  try {
    const response = await fetch("/api/health"); const data = await response.json();
    box.innerHTML = `<strong>Vercel :</strong> opérationnel<br><strong>Analyse photo :</strong> ${data.openaiConfigured ? "configurée" : "clé manquante"}<br><strong>Synchronisation :</strong> ${data.supabaseConfigured ? "configurée" : "variables manquantes"}`;
  } catch { box.textContent = "Fonctions Vercel inaccessibles."; }
}
function downloadBlob(content, type, filename) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
function exportJSON() { downloadBlob(JSON.stringify(state, null, 2), "application/json", `remplissage-${new Date().toISOString().slice(0,10)}.json`); }
function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function exportCSV() {
  const headers = ["SKU", "Description", "Liste", "Département", "Quantité", "Priorité", "Statut", "Emplacement tablette", "Emplacement réserve", "Note", "Mis à jour par", "Date"];
  const rows = state.items.map(x => [x.sku, x.name, listName(x.listId), departmentName(x.departmentId), x.quantity, PRIORITY_LABELS[x.priority], STATUS_LABELS[x.status], x.salesLocation, x.stockLocation, x.note, x.updatedBy, x.updatedAt]);
  downloadBlob("\ufeff" + [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8", `remplissage-${new Date().toISOString().slice(0,10)}.csv`);
}
els.importInput.addEventListener("change", async e => {
  const file = e.target.files?.[0]; if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (imported?.version !== 1 || !Array.isArray(imported.items)) throw new Error("Format invalide");
    state = imported; saveState(); render(); toast("Sauvegarde importée");
  } catch (error) { toast(error.message); }
  e.target.value = "";
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
if (session?.name && session?.pin) showApp(); else showLogin();
