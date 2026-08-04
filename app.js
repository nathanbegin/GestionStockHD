const STORAGE_KEY = "restock_app_v1";
const SESSION_KEY = "restock_session_v1";
const CLIENT_ID_KEY = "restock_client_id_v1";
const STATUSES = ["a_remplir", "recupere", "rempli", "introuvable"];
const STATUS_LABELS = {
  a_remplir: "À remplir",
  recupere: "Récupéré",
  rempli: "Rempli",
  introuvable: "Introuvable"
};
const PRIORITY_LABELS = { high: "Élevée", medium: "Normale", low: "Faible" };
const DEFAULT_DEPARTMENTS = ["Quincaillerie", "Peinture", "Électricité", "Plomberie", "Jardinage", "Matériaux", "Cour extérieure"];
const AUTOSYNC_DELAY = 700;
const POLL_INTERVAL = 15000;

const nowIso = () => new Date().toISOString();
const makeNamedEntry = name => ({ id: crypto.randomUUID(), name, updatedAt: nowIso() });
const makeEmployee = name => ({
  id: crypto.randomUUID(),
  name,
  hasLiftPermit: false,
  liftPermitNumber: "",
  liftPermitExpiresAt: "",
  updatedAt: nowIso()
});

const defaultState = () => ({
  version: 1,
  lists: [makeNamedEntry("Tournée principale"), makeNamedEntry("Urgences")],
  departments: DEFAULT_DEPARTMENTS.map(makeNamedEntry),
  employees: [],
  items: [],
  deletedIds: [],
  deletedListIds: [],
  deletedDepartmentIds: [],
  deletedEmployeeIds: [],
  settings: { storeName: "Mon magasin", keepPhotos: false },
  meta: { updatedAt: nowIso(), lastSyncAt: null }
});

let state = loadState();
let session = loadSession();
let currentView = "dashboard";
let editingId = null;
let editingEmployeeId = null;
let scanDraft = emptyScanDraft();
let stockPhotoDraft = emptyStockPhotoDraft();
let filters = { search: "", listId: "all", departmentId: "all", status: "open", priority: "all", employeeId: "all" };
let tourIndex = 0;
let selectedIds = new Set();
let bulkEditOpen = false;
let formDirty = false;
let remoteUpdatePending = false;
let cloudStarted = false;
let realtimeClient = null;
let realtimeChannel = null;
let realtimeActive = false;
let pollTimer = null;
let autoSyncTimer = null;
let syncInFlight = null;
let syncAgain = false;
let syncAgainBroadcast = false;
let syncMode = navigator.onLine ? "local" : "offline";
const photoUrlCache = new Map();
const clientId = localStorage.getItem(CLIENT_ID_KEY) || crypto.randomUUID();
localStorage.setItem(CLIENT_ID_KEY, clientId);

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

function emptyScanDraft() {
  return { photo: null, sku: "", name: "", confidence: null, rawText: "", barcode: "" };
}
function emptyStockPhotoDraft() {
  return { dataUrl: null, remove: false, existingPath: "" };
}
function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
function extractSkuDigits(...values) {
  for (const value of values) {
    const text = String(value || "").replace(/[–—−]/g, "-");
    const match = text.match(/(?:^|\D)((?:1000|1001)(?:[\s-]*\d){6})(?!\d)/);
    if (!match) continue;
    const digits = match[1].replace(/\D/g, "");
    if (/^(?:1000|1001)\d{6}$/.test(digits)) return digits;
  }
  return "";
}
function formatSku(value) {
  const digits = extractSkuDigits(value);
  return digits ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}` : String(value || "").trim();
}
function normalizeRequiredSku(value) {
  const digits = extractSkuDigits(value);
  return digits ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}` : "";
}
function dedupeNamedCollection(collection, fallbackNames = []) {
  const source = Array.isArray(collection) && collection.length ? collection : fallbackNames.map(makeNamedEntry);
  const kept = [];
  const byName = new Map();
  const idMap = new Map();
  for (const raw of source) {
    const name = String(raw?.name || "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = normalizeName(name);
    const existing = byName.get(key);
    if (existing) {
      if (raw?.id) idMap.set(raw.id, existing.id);
      if (new Date(raw?.updatedAt || 0) > new Date(existing.updatedAt || 0)) Object.assign(existing, raw, { id: existing.id, name });
      continue;
    }
    const entry = { ...raw, id: raw?.id || crypto.randomUUID(), name, updatedAt: raw?.updatedAt || nowIso() };
    byName.set(key, entry);
    idMap.set(entry.id, entry.id);
    kept.push(entry);
  }
  if (!kept.length) {
    for (const name of fallbackNames) {
      const entry = makeNamedEntry(name);
      kept.push(entry);
      idMap.set(entry.id, entry.id);
    }
  }
  return { collection: kept, idMap };
}
function sanitizeState(raw) {
  const fallback = defaultState();
  const source = raw && raw.version === 1 ? raw : fallback;
  const deletedListIds = new Set(Array.isArray(source.deletedListIds) ? source.deletedListIds : []);
  const deletedDepartmentIds = new Set(Array.isArray(source.deletedDepartmentIds) ? source.deletedDepartmentIds : []);
  const deletedEmployeeIds = new Set(Array.isArray(source.deletedEmployeeIds) ? source.deletedEmployeeIds : []);
  const listsResult = dedupeNamedCollection((source.lists || []).filter(x => !deletedListIds.has(x?.id)), ["Tournée principale"]);
  const departmentsResult = dedupeNamedCollection((source.departments || []).filter(x => !deletedDepartmentIds.has(x?.id)), DEFAULT_DEPARTMENTS);
  const employeesResult = dedupeNamedCollection((source.employees || []).filter(x => !deletedEmployeeIds.has(x?.id)), []);
  const listFallback = listsResult.collection[0]?.id || "";
  const departmentFallback = departmentsResult.collection[0]?.id || "";
  const employees = employeesResult.collection.map(employee => ({
    ...employee,
    hasLiftPermit: Boolean(employee.hasLiftPermit),
    liftPermitNumber: String(employee.liftPermitNumber || ""),
    liftPermitExpiresAt: String(employee.liftPermitExpiresAt || "")
  }));
  const employeeIds = new Set(employees.map(x => x.id));
  const deletedItems = new Set(Array.isArray(source.deletedIds) ? source.deletedIds : []);
  const seenItems = new Set();
  const items = [];
  for (const rawItem of Array.isArray(source.items) ? source.items : []) {
    if (!rawItem?.id || seenItems.has(rawItem.id) || deletedItems.has(rawItem.id)) continue;
    seenItems.add(rawItem.id);
    items.push({
      ...rawItem,
      sku: formatSku(rawItem.sku),
      listId: listsResult.idMap.get(rawItem.listId) || listFallback,
      departmentId: departmentsResult.idMap.get(rawItem.departmentId) || departmentFallback,
      assignedEmployeeIds: [...new Set((rawItem.assignedEmployeeIds || [])
        .map(id => employeesResult.idMap.get(id) || id)
        .filter(id => employeeIds.has(id)))],
      requiresForklift: Boolean(rawItem.requiresForklift),
      stockPhotoPath: String(rawItem.stockPhotoPath || ""),
      status: STATUSES.includes(rawItem.status) ? rawItem.status : "a_remplir",
      priority: ["high", "medium", "low"].includes(rawItem.priority) ? rawItem.priority : "medium",
      quantity: Math.max(1, Number(rawItem.quantity) || 1)
    });
  }
  return {
    version: 1,
    lists: listsResult.collection,
    departments: departmentsResult.collection,
    employees,
    items,
    deletedIds: [...deletedItems],
    deletedListIds: [...deletedListIds],
    deletedDepartmentIds: [...deletedDepartmentIds],
    deletedEmployeeIds: [...deletedEmployeeIds],
    settings: {
      storeName: String(source.settings?.storeName || "Mon magasin"),
      keepPhotos: Boolean(source.settings?.keepPhotos)
    },
    meta: {
      updatedAt: source.meta?.updatedAt || nowIso(),
      lastSyncAt: source.meta?.lastSyncAt || null
    }
  };
}
function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const cleaned = sanitizeState(parsed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch {
    return defaultState();
  }
}
function saveState({ touch = true, sync = true } = {}) {
  state = sanitizeState(state);
  if (touch) state.meta.updatedAt = nowIso();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (sync) scheduleAutoSync();
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
  try { return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return "—"; }
}
function listName(id) { return state.lists.find(x => x.id === id)?.name || "Sans liste"; }
function departmentName(id) { return state.departments.find(x => x.id === id)?.name || "Sans département"; }
function employeeById(id) { return state.employees.find(x => x.id === id) || null; }
function assignedEmployees(item) { return (item.assignedEmployeeIds || []).map(employeeById).filter(Boolean); }
function isLiftPermitValid(employee) {
  if (!employee?.hasLiftPermit) return false;
  if (!employee.liftPermitExpiresAt) return true;
  const expiry = new Date(`${employee.liftPermitExpiresAt}T23:59:59`);
  return !Number.isNaN(expiry.getTime()) && expiry >= new Date();
}
function liftPermitLabel(employee) {
  if (!employee?.hasLiftPermit) return "Sans permis";
  if (isLiftPermitValid(employee)) return employee.liftPermitExpiresAt ? `Permis valide jusqu’au ${employee.liftPermitExpiresAt}` : "Permis déclaré valide";
  return "Permis expiré";
}
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3500);
}
function updateSyncIndicator(mode = syncMode) {
  const effective = navigator.onLine ? mode : "offline";
  const classes = { error: "error", cloud: "cloud", realtime: "cloud", working: "working", pending: "pending", offline: "offline", local: "local" };
  const labels = { error: "Erreur", cloud: "Cloud", realtime: "En direct", working: "Envoi…", pending: "À envoyer", offline: "Hors ligne", local: "Local" };
  els.syncDot.className = `status-dot ${classes[effective] || "local"}`;
  els.syncLabel.textContent = labels[effective] || "Local";
}
function getOpenItems() { return state.items.filter(item => !["rempli", "introuvable"].includes(item.status)); }
function ensureSessionEmployee() {
  if (!session?.name) return null;
  let employee = state.employees.find(x => normalizeName(x.name) === normalizeName(session.name));
  if (!employee) {
    employee = makeEmployee(session.name.trim());
    state.employees.push(employee);
    saveState({ sync: false });
  }
  if (session.employeeId !== employee.id) saveSession({ ...session, employeeId: employee.id });
  return employee;
}

function showApp() {
  ensureSessionEmployee();
  els.loginScreen.hidden = true;
  els.appShell.hidden = false;
  render();
  startCloudServices();
}
function showLogin() {
  els.loginScreen.hidden = false;
  els.appShell.hidden = true;
}
function setView(view) {
  const previousView = currentView;
  currentView = view;
  formDirty = false;
  if (previousView !== view && ["manual", "scan"].includes(view)) stockPhotoDraft = emptyStockPhotoDraft();
  if (view !== "manual") editingId = null;
  if (view !== "settings") editingEmployeeId = null;
  if (view !== "lists") {
    selectedIds.clear();
    bulkEditOpen = false;
  }
  if (!["manual", "scan"].includes(view)) stockPhotoDraft = emptyStockPhotoDraft();
  document.querySelectorAll("[data-nav]").forEach(btn => btn.classList.toggle("active", btn.dataset.nav === view));
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (remoteUpdatePending) {
    remoteUpdatePending = false;
    syncNow({ silent: true, broadcast: false, source: "deferred" });
  }
}
function render() {
  selectedIds = new Set([...selectedIds].filter(id => state.items.some(item => item.id === id)));
  const titles = {
    dashboard: "Aperçu",
    scan: "Photo",
    manual: editingId ? "Modifier l’article" : "Ajouter",
    lists: "Listes",
    tour: "Mode remplissage",
    settings: "Réglages"
  };
  els.pageTitle.textContent = titles[currentView] || "Remplissage";
  const renderer = {
    dashboard: renderDashboard,
    scan: renderScan,
    manual: renderManual,
    lists: renderLists,
    tour: renderTour,
    settings: renderSettings
  }[currentView] || renderDashboard;
  els.appMain.innerHTML = renderer();
  updateSyncIndicator();
  queueMicrotask(hydrateStockPhotos);
}
function renderDashboard() {
  const open = getOpenItems();
  const high = open.filter(x => x.priority === "high").length;
  const mine = open.filter(x => (x.assignedEmployeeIds || []).includes(session?.employeeId)).length;
  const liftWarnings = open.filter(x => x.requiresForklift && !assignedEmployees(x).some(isLiftPermitValid)).length;
  const recent = [...state.items].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);
  return `
    <section class="section">
      <div class="section-head"><div><h2>Bonjour ${escapeHTML(session?.name || "")}</h2><p class="muted">${escapeHTML(state.settings.storeName)} · ${new Date().toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}</p></div></div>
      <div class="grid stats-grid">
        <article class="card stat-card"><span class="stat-label">À traiter</span><strong>${open.length}</strong></article>
        <article class="card stat-card attention"><span class="stat-label">Priorité élevée</span><strong>${high}</strong></article>
        <article class="card stat-card"><span class="stat-label">Assignés à moi</span><strong>${mine}</strong></article>
        <article class="card stat-card ${liftWarnings ? "danger-card" : ""}"><span class="stat-label">Permis lift à vérifier</span><strong>${liftWarnings}</strong></article>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>Actions rapides</h2><p class="muted">Relever un manque ou commencer une tournée.</p></div></div>
      <div class="grid actions-grid">
        <button class="card action-card" data-action="go" data-view="scan"><span class="icon">▣</span><h3>Photographier une étiquette</h3><p>Prendre une photo ou choisir une image existante.</p></button>
        <button class="card action-card" data-action="go" data-view="manual"><span class="icon">＋</span><h3>Ajouter manuellement</h3><p>Saisir un article, l’assigner et ajouter son emplacement.</p></button>
        <button class="card action-card" data-action="go" data-view="lists"><span class="icon">☷</span><h3>Voir les listes</h3><p>Filtrer par département, employé, statut ou priorité.</p></button>
        <button class="card action-card" data-action="go" data-view="tour"><span class="icon">→</span><h3>Commencer à remplir</h3><p>Voir l’emplacement et sa photo avant de récupérer l’article.</p></button>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>Activité récente</h2><p class="muted">Derniers articles modifiés.</p></div><button class="button compact" data-action="go" data-view="lists">Tout voir</button></div>
      ${recent.length ? `<div class="item-list">${recent.map(renderCompactItem).join("")}</div>` : renderEmpty("Aucun article", "Ajoute ton premier produit par photo ou manuellement.")}
    </section>`;
}
function renderCompactItem(item) {
  const names = assignedEmployees(item).map(x => x.name).join(", ") || "Non assigné";
  return `<article class="card item-card"><div class="item-top"><div class="item-title"><div class="item-qty">${Number(item.quantity) || 1}</div><div><h3>${escapeHTML(item.name || "Article sans description")}</h3><p class="sku">${escapeHTML(formatSku(item.sku))}</p><p class="small muted">${escapeHTML(departmentName(item.departmentId))} · ${escapeHTML(names)}</p></div></div><button class="status-button" data-action="cycle-status" data-id="${item.id}" data-status="${item.status}">${STATUS_LABELS[item.status]}</button></div></article>`;
}
function renderEmpty(title, text) {
  return `<div class="card empty"><div class="icon">□</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p></div>`;
}
function options(collection, selected, allLabel = null) {
  const head = allLabel !== null ? `<option value="all" ${selected === "all" ? "selected" : ""}>${escapeHTML(allLabel)}</option>` : "";
  return head + collection.map(x => `<option value="${x.id}" ${selected === x.id ? "selected" : ""}>${escapeHTML(x.name)}</option>`).join("");
}
function skuField(value = "") {
  return `<input name="sku" required inputmode="numeric" autocomplete="off" maxlength="14" value="${escapeHTML(formatSku(value))}" placeholder="Ex. 1001 123 456"><span class="field-hint">Formats acceptés : 1001-123456, 1001123456 ou 1001 123 456.</span>`;
}
function renderEmployeePicker(selected = []) {
  if (!state.employees.length) return `<p class="small muted">Aucun employé. Ajoute les employés dans Réglages.</p>`;
  const selectedSet = new Set(selected || []);
  return `<div class="employee-picker">${state.employees.map(employee => {
    const valid = isLiftPermitValid(employee);
    return `<label class="employee-option"><input type="checkbox" name="assignedEmployeeIds" value="${employee.id}" ${selectedSet.has(employee.id) ? "checked" : ""}><span><strong>${escapeHTML(employee.name)}</strong><small class="${valid ? "permit-ok" : "permit-bad"}">${escapeHTML(liftPermitLabel(employee))}</small></span></label>`;
  }).join("")}</div>`;
}
function renderStockPhotoField(item = {}) {
  const path = stockPhotoDraft.remove ? "" : (stockPhotoDraft.existingPath || item.stockPhotoPath || "");
  const local = stockPhotoDraft.dataUrl;
  const hasPreview = Boolean(local || path);
  return `<div class="full stock-photo-field">
    <div class="field-title">Photo de l’emplacement d’entreposage</div>
    <p class="field-hint">Cette photo est enregistrée dans Supabase Storage afin d’être visible par les autres employés.</p>
    <div class="photo-choice-grid compact-grid">
      <label class="button primary photo-choice" for="stockCameraInput">📷 Prendre une photo</label>
      <label class="button photo-choice" for="stockGalleryInput">🖼 Choisir une photo</label>
    </div>
    <input id="stockCameraInput" class="hidden-file" type="file" accept="image/*" capture="environment">
    <input id="stockGalleryInput" class="hidden-file" type="file" accept="image/*">
    <div id="stockPhotoPreviewWrap" class="preview stock-preview" ${hasPreview ? "" : "hidden"}>
      <img id="stockPhotoPreview" ${local ? `src="${local}"` : ""} ${!local && path ? `data-stock-photo-path="${escapeHTML(path)}"` : ""} alt="Photo de l’emplacement d’entreposage">
    </div>
    <button id="removeStockPhotoButton" class="button compact danger" type="button" data-action="remove-stock-photo" ${hasPreview ? "" : "hidden"}>Retirer la photo</button>
  </div>`;
}
function commonItemFields(item = {}) {
  const listId = item.listId || state.lists[0]?.id || "";
  const departmentId = item.departmentId || state.departments[0]?.id || "";
  return `
    <label>Numéro d’article / SKU${skuField(item.sku || "")}</label>
    <label>Description<input name="name" maxlength="140" value="${escapeHTML(item.name || "")}" placeholder="Ex. Perceuse sans fil 20 V"></label>
    <label>Liste<select name="listId" required>${options(state.lists, listId)}</select></label>
    <label>Département<select name="departmentId" required>${options(state.departments, departmentId)}</select></label>
    <label>Quantité à remplir<input name="quantity" type="number" inputmode="numeric" min="1" max="999" required value="${Number(item.quantity) || 1}"></label>
    <label>Priorité<select name="priority"><option value="high" ${item.priority === "high" ? "selected" : ""}>Élevée</option><option value="medium" ${!item.priority || item.priority === "medium" ? "selected" : ""}>Normale</option><option value="low" ${item.priority === "low" ? "selected" : ""}>Faible</option></select></label>
    <label>Emplacement en tablette<input name="salesLocation" maxlength="120" value="${escapeHTML(item.salesLocation || "")}" placeholder="Allée 12, section B, tablette 3"></label>
    <label>Emplacement pour récupérer<input name="stockLocation" maxlength="120" value="${escapeHTML(item.stockLocation || "")}" placeholder="Entrepôt R4, niveau 2 ou cour zone B"></label>
    <div class="full assignment-field"><div class="field-title">Employé(s) assigné(s)</div>${renderEmployeePicker(item.assignedEmployeeIds || [])}</div>
    <label class="full check-card"><span><input name="requiresForklift" type="checkbox" ${item.requiresForklift ? "checked" : ""}> Nécessite un chariot élévateur (lift)</span><span class="field-hint">Si des employés sont assignés, au moins une personne doit avoir un permis valide.</span></label>
    ${renderStockPhotoField(item)}
    <label class="full">Note<textarea name="note" maxlength="500" placeholder="Détail utile, palette, variante…">${escapeHTML(item.note || "")}</textarea></label>`;
}
function itemForm(item = {}) {
  return `<form id="itemForm" class="card"><div class="form-grid">${commonItemFields(item)}</div><div class="form-actions"><button class="button primary" type="submit">${editingId ? "Enregistrer les changements" : "Ajouter à la liste"}</button>${editingId ? `<button class="button" type="button" data-action="cancel-edit">Annuler</button>` : ""}</div></form>`;
}
function renderManual() {
  const item = editingId ? state.items.find(x => x.id === editingId) : null;
  return `<section class="section"><div class="section-head"><div><h2>${item ? "Modifier l’article" : "Nouvel article"}</h2><p class="muted">Saisie manuelle, attribution et photo de l’emplacement.</p></div></div>${itemForm(item || {})}</section>`;
}

function renderScan() {
  const draftItem = { sku: scanDraft.sku, name: scanDraft.name, quantity: 1, priority: "medium", assignedEmployeeIds: [] };
  return `<section class="section"><div class="section-head"><div><h2>Lire une étiquette</h2><p class="muted">Prends une nouvelle photo ou sélectionne une image déjà enregistrée.</p></div></div>
    <div class="card">
      <div class="scan-zone">
        <span class="scan-icon">▣</span>
        <strong>${scanDraft.photo ? "Remplacer la photo" : "Ajouter une photo d’étiquette"}</strong>
        <span class="small muted">Les deux options demeurent disponibles dans la PWA installée.</span>
        <div class="photo-choice-grid">
          <label class="button primary photo-choice" for="cameraInput">📷 Prendre une photo</label>
          <label class="button photo-choice" for="galleryInput">🖼 Choisir une photo existante</label>
        </div>
        <input id="cameraInput" type="file" accept="image/*" capture="environment">
        <input id="galleryInput" type="file" accept="image/*">
      </div>
      ${scanDraft.photo ? `<div class="preview"><img src="${scanDraft.photo}" alt="Aperçu de l’étiquette"></div><div class="button-row top-gap"><button class="button primary" data-action="analyze-photo">Analyser l’étiquette</button><button class="button" data-action="clear-photo">Effacer</button></div>` : ""}
      ${scanDraft.confidence !== null ? `<div class="analysis-box"><div class="button-row"><span class="confidence">Confiance ${Math.round(scanDraft.confidence * 100)} %</span>${scanDraft.barcode ? `<span class="tag">Code-barres ${escapeHTML(scanDraft.barcode)}</span>` : ""}</div><p class="small muted">${escapeHTML(scanDraft.rawText || "Résultat extrait. Vérifie les champs ci-dessous.")}</p></div>` : ""}
    </div></section>
    <section class="section"><div class="section-head"><div><h2>Résultat à confirmer</h2><p class="muted">Le numéro est conservé sous la forme 1001 123 456.</p></div></div>
      <form id="scanForm" class="card"><div class="form-grid">${commonItemFields(draftItem)}
        <label class="full check-card"><span><input name="keepPhoto" type="checkbox" ${state.settings.keepPhotos ? "checked" : ""}> Conserver une miniature de la photo de l’étiquette</span><span class="field-hint">La photo d’étiquette est distincte de la photo d’emplacement.</span></label>
      </div><div class="form-actions"><button class="button primary" type="submit">Ajouter à la liste</button></div></form>
    </section>`;
}
function searchableSku(value) { return String(value || "").replace(/\D/g, ""); }
function filteredItems() {
  const q = filters.search.trim().toLowerCase();
  const qDigits = searchableSku(q);
  return state.items.filter(item => {
    const assignees = assignedEmployees(item).map(x => x.name).join(" ");
    const textMatch = [item.sku, item.name, item.salesLocation, item.stockLocation, item.note, assignees].some(v => String(v || "").toLowerCase().includes(q));
    const skuDigitsMatch = qDigits.length >= 4 && searchableSku(item.sku).includes(qDigits);
    if (q && !textMatch && !skuDigitsMatch) return false;
    if (filters.listId !== "all" && item.listId !== filters.listId) return false;
    if (filters.departmentId !== "all" && item.departmentId !== filters.departmentId) return false;
    if (filters.priority !== "all" && item.priority !== filters.priority) return false;
    if (filters.employeeId === "mine" && !(item.assignedEmployeeIds || []).includes(session?.employeeId)) return false;
    if (!["all", "mine"].includes(filters.employeeId) && !(item.assignedEmployeeIds || []).includes(filters.employeeId)) return false;
    if (filters.status === "open" && ["rempli", "introuvable"].includes(item.status)) return false;
    if (filters.status !== "all" && filters.status !== "open" && item.status !== filters.status) return false;
    return true;
  }).sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2 };
    return p[a.priority] - p[b.priority] || String(a.stockLocation || "zzz").localeCompare(String(b.stockLocation || "zzz"), "fr") || new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}
function employeeFilterOptions(selected) {
  const fixed = `<option value="all" ${selected === "all" ? "selected" : ""}>Tous les employés</option><option value="mine" ${selected === "mine" ? "selected" : ""}>Mes articles</option>`;
  return fixed + state.employees.map(x => `<option value="${x.id}" ${selected === x.id ? "selected" : ""}>${escapeHTML(x.name)}</option>`).join("");
}
function renderBulkToolbar(items) {
  const allVisibleSelected = items.length > 0 && items.every(item => selectedIds.has(item.id));
  return `<div class="selection-toolbar card">
    <label class="selection-toggle"><input id="selectAllVisible" type="checkbox" ${allVisibleSelected ? "checked" : ""}> Sélectionner les ${items.length} articles affichés</label>
    <div class="selected-count"><strong>${selectedIds.size}</strong> sélectionné${selectedIds.size > 1 ? "s" : ""}</div>
    ${selectedIds.size ? `<div class="bulk-actions">
      <select id="bulkStatus" aria-label="Nouveau statut">${STATUSES.map(s => `<option value="${s}">${STATUS_LABELS[s]}</option>`).join("")}</select>
      <button class="button compact" data-action="bulk-status">Appliquer le statut</button>
      <button class="button compact" data-action="bulk-edit-open">Modifier les champs</button>
      <button class="button compact danger" data-action="bulk-delete">Supprimer</button>
      <button class="button compact" data-action="clear-selection">Annuler</button>
    </div>` : ""}
  </div>`;
}
function renderLists() {
  const items = filteredItems();
  return `<section class="section"><div class="section-head"><div><h2>${items.length} article${items.length > 1 ? "s" : ""}</h2><p class="muted">Les changements sont envoyés automatiquement au cloud.</p></div><button class="button primary" data-action="go" data-view="tour">Mode remplissage</button></div>
    <div class="toolbar six-filters">
      <input id="filterSearch" value="${escapeHTML(filters.search)}" placeholder="Rechercher SKU, produit, employé ou emplacement">
      <select id="filterList">${options(state.lists, filters.listId, "Toutes les listes")}</select>
      <select id="filterDepartment">${options(state.departments, filters.departmentId, "Tous les départements")}</select>
      <select id="filterEmployee">${employeeFilterOptions(filters.employeeId)}</select>
      <select id="filterStatus"><option value="open" ${filters.status === "open" ? "selected" : ""}>À traiter</option><option value="all" ${filters.status === "all" ? "selected" : ""}>Tous les statuts</option>${STATUSES.map(s => `<option value="${s}" ${filters.status === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}</select>
      <select id="filterPriority"><option value="all" ${filters.priority === "all" ? "selected" : ""}>Toutes priorités</option><option value="high" ${filters.priority === "high" ? "selected" : ""}>Élevée</option><option value="medium" ${filters.priority === "medium" ? "selected" : ""}>Normale</option><option value="low" ${filters.priority === "low" ? "selected" : ""}>Faible</option></select>
    </div>
    ${renderBulkToolbar(items)}
    ${items.length ? `<div class="item-list">${items.map(renderItemCard).join("")}</div>` : renderEmpty("Aucun résultat", "Modifie les filtres ou ajoute un nouvel article.")}
    ${bulkEditOpen ? renderBulkEditDialog() : ""}
  </section>`;
}
function renderAssignmentTags(item) {
  const employees = assignedEmployees(item);
  const employeeTags = employees.length
    ? employees.map(employee => `<span class="tag employee-tag">👤 ${escapeHTML(employee.name)}</span>`).join("")
    : `<span class="tag permit-warning">À attribuer</span>`;
  let liftTag = "";
  if (item.requiresForklift) {
    const valid = employees.some(isLiftPermitValid);
    liftTag = `<span class="tag ${valid ? "permit-valid" : "permit-warning"}">Lift : ${valid ? "permis vérifié" : "permis requis"}</span>`;
  }
  return employeeTags + liftTag;
}
function renderStockPhoto(item, className = "") {
  if (!item.stockPhotoPath) return "";
  return `<div class="preview stock-location-photo ${className}"><img data-stock-photo-path="${escapeHTML(item.stockPhotoPath)}" alt="Photo de l’emplacement d’entreposage"><span class="photo-loading">Chargement de la photo…</span></div>`;
}
function renderItemCard(item) {
  const selected = selectedIds.has(item.id);
  return `<article class="card item-card ${selected ? "selected" : ""}">
    <label class="item-select"><input class="select-item" type="checkbox" data-id="${item.id}" ${selected ? "checked" : ""}> Sélectionner</label>
    <div class="item-top"><div class="item-title"><div class="item-qty">${Number(item.quantity) || 1}</div><div><h3>${escapeHTML(item.name || "Article sans description")}</h3><p class="sku">${escapeHTML(formatSku(item.sku))}</p></div></div><button class="status-button" data-action="cycle-status" data-id="${item.id}" data-status="${item.status}">${STATUS_LABELS[item.status]}</button></div>
    <div class="tags"><span class="tag">${escapeHTML(listName(item.listId))}</span><span class="tag">${escapeHTML(departmentName(item.departmentId))}</span><span class="tag ${item.priority}">${PRIORITY_LABELS[item.priority]}</span>${renderAssignmentTags(item)}<span class="tag">Par ${escapeHTML(item.updatedBy || item.createdBy || "—")}</span></div>
    <div class="location-grid"><div><strong>Tablette</strong>${escapeHTML(item.salesLocation || "Non précisé")}</div><div><strong>Réserve / récupération</strong>${escapeHTML(item.stockLocation || "Non précisé")}</div></div>
    ${renderStockPhoto(item)}
    ${item.note ? `<p class="small"><strong>Note :</strong> ${escapeHTML(item.note)}</p>` : ""}
    ${item.photo ? `<details><summary class="small">Voir la photo de l’étiquette</summary><div class="preview"><img src="${item.photo}" alt="Photo de l’étiquette"></div></details>` : ""}
    <div class="item-actions"><button class="button compact" data-action="edit-item" data-id="${item.id}">Modifier</button><button class="button compact danger" data-action="delete-item" data-id="${item.id}">Supprimer</button><span class="tiny muted item-date">Mis à jour ${formatDate(item.updatedAt)}</span></div>
  </article>`;
}
function renderBulkEditDialog() {
  return `<div class="dialog-backdrop" role="presentation"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bulkEditTitle">
    <div class="section-head"><div><h2 id="bulkEditTitle">Modifier ${selectedIds.size} article${selectedIds.size > 1 ? "s" : ""}</h2><p class="muted small">Coche seulement les champs à remplacer.</p></div><button class="button compact" type="button" data-action="bulk-edit-close">Fermer</button></div>
    <form id="bulkEditForm">
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyList"> Modifier la liste</label><select name="listId">${options(state.lists, state.lists[0]?.id || "")}</select></div>
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyDepartment"> Modifier le département</label><select name="departmentId">${options(state.departments, state.departments[0]?.id || "")}</select></div>
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyAssignments"> Modifier les employés assignés</label>${renderEmployeePicker([])}</div>
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyForklift"> Modifier l’exigence de lift</label><label class="check-label"><input type="checkbox" name="requiresForklift"> Nécessite un chariot élévateur</label></div>
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyPriority"> Modifier la priorité</label><select name="priority"><option value="high">Élevée</option><option value="medium" selected>Normale</option><option value="low">Faible</option></select></div>
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyQuantity"> Modifier la quantité</label><input name="quantity" type="number" min="1" max="999" value="1"></div>
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applySalesLocation"> Modifier l’emplacement tablette</label><input name="salesLocation"></div>
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyStockLocation"> Modifier l’emplacement de récupération</label><input name="stockLocation"></div>
      <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyNote"> Remplacer la note</label><textarea name="note"></textarea></div>
      <div class="form-actions"><button class="button primary" type="submit">Appliquer</button><button class="button" type="button" data-action="bulk-edit-close">Annuler</button></div>
    </form>
  </div></div>`;
}

function renderTour() {
  const items = filteredItems().filter(x => !["rempli", "introuvable"].includes(x.status));
  if (!items.length) return `<section class="section">${renderEmpty("Tournée terminée", "Aucun article ouvert ne correspond aux filtres actuels.")}<div class="button-row centered top-gap"><button class="button" data-action="go" data-view="lists">Retour aux listes</button></div></section>`;
  tourIndex = Math.max(0, Math.min(tourIndex, items.length - 1));
  const item = items[tourIndex];
  const pct = ((tourIndex + 1) / items.length) * 100;
  const employees = assignedEmployees(item);
  const validLift = employees.some(isLiftPermitValid);
  return `<section class="section"><article class="card tour-card">
    <div class="section-head"><div><p class="tour-number">Article ${tourIndex + 1} sur ${items.length}</p><h2>${escapeHTML(item.name || "Article sans description")}</h2><p class="sku">${escapeHTML(formatSku(item.sku))}</p></div><div class="item-qty">${item.quantity}</div></div>
    <div class="tour-progress"><span style="width:${pct}%"></span></div>
    <div class="tags"><span class="tag">${escapeHTML(departmentName(item.departmentId))}</span><span class="tag ${item.priority}">${PRIORITY_LABELS[item.priority]}</span>${renderAssignmentTags(item)}</div>
    ${item.requiresForklift && !validLift ? `<div class="safety-warning"><strong>Permis à vérifier</strong><span>Aucun employé assigné ne possède actuellement un permis de chariot élévateur valide dans l’application.</span></div>` : ""}
    <div class="location-grid top-gap"><div><strong>Aller chercher</strong>${escapeHTML(item.stockLocation || "Emplacement non précisé")}</div><div><strong>Remplir à</strong>${escapeHTML(item.salesLocation || "Emplacement non précisé")}</div></div>
    ${renderStockPhoto(item, "tour-photo")}
    ${item.note ? `<p><strong>Note :</strong> ${escapeHTML(item.note)}</p>` : ""}
    <hr><div class="button-row"><button class="button secondary" data-action="tour-status" data-status="recupere" data-id="${item.id}">Marquer récupéré</button><button class="button primary" data-action="tour-status" data-status="rempli" data-id="${item.id}">Marquer rempli</button><button class="button danger" data-action="tour-status" data-status="introuvable" data-id="${item.id}">Introuvable</button></div>
    <div class="button-row between top-gap"><button class="button" data-action="tour-prev" ${tourIndex === 0 ? "disabled" : ""}>← Précédent</button><button class="button" data-action="tour-next" ${tourIndex >= items.length - 1 ? "disabled" : ""}>Suivant →</button></div>
  </article></section>`;
}
function employeeForm() {
  const employee = editingEmployeeId ? state.employees.find(x => x.id === editingEmployeeId) : null;
  return `<form id="employeeForm" class="employee-form">
    <input type="hidden" name="employeeId" value="${employee?.id || ""}">
    <label>Nom<input name="name" required maxlength="60" value="${escapeHTML(employee?.name || "")}" placeholder="Ex. Alex"></label>
    <label class="check-card"><span><input type="checkbox" name="hasLiftPermit" ${employee?.hasLiftPermit ? "checked" : ""}> Possède un permis de chariot élévateur (lift)</span></label>
    <label>Numéro de permis, facultatif<input name="liftPermitNumber" maxlength="80" value="${escapeHTML(employee?.liftPermitNumber || "")}"></label>
    <label>Date d’expiration, facultative<input name="liftPermitExpiresAt" type="date" value="${escapeHTML(employee?.liftPermitExpiresAt || "")}"></label>
    <div class="form-actions"><button class="button primary" type="submit">${employee ? "Enregistrer" : "Ajouter l’employé"}</button>${employee ? `<button class="button" type="button" data-action="cancel-employee-edit">Annuler</button>` : ""}</div>
  </form>`;
}
function renderSettings() {
  return `<section class="section"><div class="settings-grid">
    <article class="card"><h2>Magasin et utilisateur</h2><form id="storeForm"><label>Nom du magasin<input name="storeName" value="${escapeHTML(state.settings.storeName)}"></label><label class="check-card"><span><input type="checkbox" name="keepPhotos" ${state.settings.keepPhotos ? "checked" : ""}> Conserver les photos d’étiquettes par défaut</span></label><div class="form-actions"><button class="button primary" type="submit">Enregistrer</button><button class="button" type="button" data-action="logout">Déconnexion</button></div></form></article>
    <article class="card"><h2>Synchronisation automatique</h2><p class="muted small">Chaque ajout ou modification est envoyé automatiquement. Les autres appareils reçoivent un signal en temps réel et actualisent leurs listes; une vérification périodique sert de repli.</p><p class="small"><strong>Dernière synchro :</strong> ${formatDate(state.meta.lastSyncAt)}</p><p class="small"><strong>État :</strong> ${realtimeActive ? "Connexion en direct active" : navigator.onLine ? "Cloud avec vérification périodique" : "Hors ligne — changements conservés localement"}</p><div class="button-row"><button class="button primary" data-action="sync">Synchroniser maintenant</button><button class="button" data-action="health">Tester les services</button></div><div id="healthResult" class="analysis-box" hidden></div></article>
    <article class="card employee-card"><h2>Employés et permis de lift</h2><p class="muted small">Le permis déclaré ici sert à vérifier les affectations qui nécessitent un chariot élévateur.</p>${employeeForm()}<div class="manage-list">${state.employees.map(employee => `<div class="manage-row employee-row"><div><strong>${escapeHTML(employee.name)}</strong><div class="tiny ${isLiftPermitValid(employee) ? "permit-ok" : "permit-bad"}">${escapeHTML(liftPermitLabel(employee))}${employee.liftPermitNumber ? ` · ${escapeHTML(employee.liftPermitNumber)}` : ""}</div></div><div class="button-row"><button class="button compact" data-action="edit-employee" data-id="${employee.id}">Modifier</button><button class="button compact danger" data-action="delete-employee" data-id="${employee.id}">Supprimer</button></div></div>`).join("")}</div></article>
    <article class="card"><h2>Listes</h2><form id="listForm" class="inline-form"><label>Nouvelle liste<input name="name" required maxlength="60" placeholder="Ex. Peinture du matin"></label><button class="button primary" type="submit">Ajouter</button></form><div class="manage-list">${state.lists.map(x => `<div class="manage-row"><span>${escapeHTML(x.name)}</span><button class="button compact danger" data-action="delete-list" data-id="${x.id}">Supprimer</button></div>`).join("")}</div></article>
    <article class="card"><h2>Départements</h2><p class="muted small">Les doublons sont supprimés automatiquement.</p><form id="departmentForm" class="inline-form"><label>Nouveau département<input name="name" required maxlength="60" placeholder="Ex. Saisonnier"></label><button class="button primary" type="submit">Ajouter</button></form><div class="manage-list">${state.departments.map(x => `<div class="manage-row"><span>${escapeHTML(x.name)}</span><button class="button compact danger" data-action="delete-department" data-id="${x.id}">Supprimer</button></div>`).join("")}</div></article>
    <article class="card"><h2>Sauvegarde</h2><p class="muted small">Exporte une copie ou importe une sauvegarde existante.</p><div class="button-row"><button class="button" data-action="export-json">Exporter JSON</button><button class="button" data-action="export-csv">Exporter CSV</button><button class="button" data-action="import-json">Importer JSON</button></div></article>
  </div></section>`;
}

function formToItem(form, existing = {}) {
  const data = new FormData(form);
  const sku = normalizeRequiredSku(data.get("sku"));
  if (!sku) {
    const input = form.querySelector('[name="sku"]');
    input?.setCustomValidity("Le numéro doit contenir 10 chiffres et commencer par 1000 ou 1001.");
    input?.reportValidity();
    input?.focus();
    return null;
  }
  const assignedEmployeeIds = [...new Set(data.getAll("assignedEmployeeIds").map(String))].filter(id => employeeById(id));
  const requiresForklift = Boolean(data.get("requiresForklift"));
  if (requiresForklift && assignedEmployeeIds.length && !assignedEmployeeIds.map(employeeById).some(isLiftPermitValid)) {
    toast("Affectation refusée : au moins un employé assigné doit avoir un permis de lift valide.");
    return null;
  }
  const now = nowIso();
  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    sku,
    name: String(data.get("name") || "").trim(),
    listId: String(data.get("listId") || ""),
    departmentId: String(data.get("departmentId") || ""),
    quantity: Math.max(1, Number(data.get("quantity") || 1)),
    priority: String(data.get("priority") || "medium"),
    salesLocation: String(data.get("salesLocation") || "").trim(),
    stockLocation: String(data.get("stockLocation") || "").trim(),
    assignedEmployeeIds,
    requiresForklift,
    stockPhotoPath: String(existing.stockPhotoPath || ""),
    note: String(data.get("note") || "").trim(),
    status: existing.status || "a_remplir",
    createdAt: existing.createdAt || now,
    createdBy: existing.createdBy || session.name,
    updatedAt: now,
    updatedBy: session.name
  };
}
async function applyStockPhotoChanges(item, existing = {}) {
  const oldPath = String(existing.stockPhotoPath || "");
  if (stockPhotoDraft.dataUrl) {
    const data = await apiRequest("/api/photo-upload", {
      method: "POST",
      body: { image: stockPhotoDraft.dataUrl, itemId: item.id, oldPath }
    });
    item.stockPhotoPath = data.path;
    photoUrlCache.delete(oldPath);
    return item;
  }
  if (stockPhotoDraft.remove && oldPath) {
    item.stockPhotoPath = "";
    photoUrlCache.delete(oldPath);
    apiRequest("/api/photo-delete", { method: "POST", body: { path: oldPath } }).catch(error => console.warn(error));
  }
  return item;
}
function upsertItem(item) {
  if (!item) return false;
  const index = state.items.findIndex(x => x.id === item.id);
  if (index >= 0) state.items[index] = item; else state.items.unshift(item);
  formDirty = false;
  saveState();
  return true;
}
function setStatus(id, status) {
  const item = state.items.find(x => x.id === id);
  if (!item) return;
  item.status = status;
  item.updatedAt = nowIso();
  item.updatedBy = session.name;
  saveState();
}
function nextStatus(current) { return STATUSES[(STATUSES.indexOf(current) + 1) % STATUSES.length]; }
function deleteItems(ids) {
  const idSet = new Set(ids);
  const photoPaths = state.items.filter(item => idSet.has(item.id)).map(item => item.stockPhotoPath).filter(Boolean);
  state.items = state.items.filter(item => !idSet.has(item.id));
  state.deletedIds = [...new Set([...state.deletedIds, ...idSet])];
  selectedIds = new Set([...selectedIds].filter(id => !idSet.has(id)));
  saveState();
  for (const path of photoPaths) apiRequest("/api/photo-delete", { method: "POST", body: { path } }).catch(() => {});
}
function addNamedEntry(form) {
  const name = String(new FormData(form).get("name") || "").trim().replace(/\s+/g, " ");
  if (!name) return;
  const target = form.id === "listForm" ? state.lists : state.departments;
  if (target.some(entry => normalizeName(entry.name) === normalizeName(name))) return toast("Cet élément existe déjà");
  target.push(makeNamedEntry(name));
  saveState();
  render();
  toast("Ajout enregistré");
}
function saveEmployee(form) {
  const data = new FormData(form);
  const id = String(data.get("employeeId") || "");
  const name = String(data.get("name") || "").trim().replace(/\s+/g, " ");
  if (!name) return;
  if (state.employees.some(x => x.id !== id && normalizeName(x.name) === normalizeName(name))) return toast("Cet employé existe déjà");
  const existing = state.employees.find(x => x.id === id);
  const employee = {
    ...(existing || makeEmployee(name)),
    name,
    hasLiftPermit: Boolean(data.get("hasLiftPermit")),
    liftPermitNumber: String(data.get("liftPermitNumber") || "").trim(),
    liftPermitExpiresAt: String(data.get("liftPermitExpiresAt") || ""),
    updatedAt: nowIso()
  };
  if (existing) Object.assign(existing, employee); else state.employees.push(employee);
  if (session?.employeeId === employee.id || normalizeName(session?.name) === normalizeName(existing?.name)) saveSession({ ...session, employeeId: employee.id, name: employee.name });
  editingEmployeeId = null;
  saveState();
  render();
  toast(existing ? "Employé modifié" : "Employé ajouté");
}
function applyBulkEdit(form) {
  const data = new FormData(form);
  const selected = state.items.filter(item => selectedIds.has(item.id));
  if (!selected.length) return;
  const newAssignments = [...new Set(data.getAll("assignedEmployeeIds").map(String))].filter(id => employeeById(id));
  const applyAssignments = Boolean(data.get("applyAssignments"));
  const applyForklift = Boolean(data.get("applyForklift"));
  const newRequiresForklift = Boolean(data.get("requiresForklift"));
  if (applyAssignments && newAssignments.length) {
    const anyWillRequireLift = selected.some(item => applyForklift ? newRequiresForklift : item.requiresForklift);
    if (anyWillRequireLift && !newAssignments.map(employeeById).some(isLiftPermitValid)) {
      return toast("Modification refusée : cette affectation exige au moins un permis de lift valide.");
    }
  }
  const now = nowIso();
  for (const item of selected) {
    if (data.get("applyList")) item.listId = String(data.get("listId") || item.listId);
    if (data.get("applyDepartment")) item.departmentId = String(data.get("departmentId") || item.departmentId);
    if (applyAssignments) item.assignedEmployeeIds = newAssignments;
    if (applyForklift) item.requiresForklift = newRequiresForklift;
    if (data.get("applyPriority")) item.priority = String(data.get("priority") || item.priority);
    if (data.get("applyQuantity")) item.quantity = Math.max(1, Number(data.get("quantity") || 1));
    if (data.get("applySalesLocation")) item.salesLocation = String(data.get("salesLocation") || "").trim();
    if (data.get("applyStockLocation")) item.stockLocation = String(data.get("stockLocation") || "").trim();
    if (data.get("applyNote")) item.note = String(data.get("note") || "").trim();
    item.updatedAt = now;
    item.updatedBy = session.name;
  }
  bulkEditOpen = false;
  saveState();
  render();
  toast(`${selected.length} article${selected.length > 1 ? "s modifiés" : " modifié"}`);
}

async function apiRequest(url, { method = "GET", body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "x-app-pin": session?.pin || ""
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
  return data;
}
async function handleLabelPhoto(file) {
  if (!file?.type?.startsWith("image/")) return toast("Choisis une image valide");
  try {
    scanDraft.photo = await compressImage(file, 1280, .75);
    scanDraft.confidence = null;
    scanDraft.rawText = "";
    render();
    if ("BarcodeDetector" in window) {
      try {
        const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
        const bitmap = await createImageBitmap(file);
        const codes = await detector.detect(bitmap);
        bitmap.close?.();
        if (codes[0]?.rawValue) {
          scanDraft.barcode = codes[0].rawValue;
          const formatted = normalizeRequiredSku(codes[0].rawValue);
          if (formatted) scanDraft.sku = formatted;
          scanDraft.confidence = formatted ? .95 : .75;
          render();
          toast(formatted ? "Numéro d’article détecté" : "Code-barres détecté");
        }
      } catch { /* L’analyse IA demeure disponible. */ }
    }
  } catch {
    toast("Impossible de lire cette photo");
  }
}
async function handleStockPhoto(file) {
  if (!file?.type?.startsWith("image/")) return toast("Choisis une image valide");
  try {
    stockPhotoDraft.dataUrl = await compressImage(file, 1280, .72);
    stockPhotoDraft.remove = false;
    const wrap = document.querySelector("#stockPhotoPreviewWrap");
    const img = document.querySelector("#stockPhotoPreview");
    const remove = document.querySelector("#removeStockPhotoButton");
    if (img) {
      img.removeAttribute("data-stock-photo-path");
      img.src = stockPhotoDraft.dataUrl;
    }
    if (wrap) wrap.hidden = false;
    if (remove) remove.hidden = false;
    formDirty = true;
    toast("Photo de l’emplacement prête à être téléversée");
  } catch {
    toast("Impossible de préparer cette photo");
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
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
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
  btn.disabled = true;
  btn.textContent = "Analyse…";
  try {
    const data = await apiRequest("/api/analyze", { method: "POST", body: { image: scanDraft.photo } });
    const detectedSku = normalizeRequiredSku(data.sku) || normalizeRequiredSku(data.visibleText) || normalizeRequiredSku(data.summary);
    scanDraft.sku = detectedSku || scanDraft.sku;
    scanDraft.name = data.productName || scanDraft.name;
    scanDraft.barcode = data.barcode || scanDraft.barcode;
    scanDraft.confidence = typeof data.confidence === "number" ? data.confidence : .5;
    scanDraft.rawText = data.summary || data.visibleText || "Étiquette analysée";
    render();
    toast(detectedSku ? "Numéro détecté — vérifie le résultat" : "Analyse terminée — numéro à confirmer manuellement");
  } catch (error) {
    toast(error.message);
    btn.disabled = false;
    btn.textContent = "Analyser l’étiquette";
  }
}
async function hydrateStockPhotos() {
  if (!session?.pin) return;
  const images = [...document.querySelectorAll("img[data-stock-photo-path]")];
  if (!images.length) return;
  const now = Date.now();
  const missing = [...new Set(images.map(img => img.dataset.stockPhotoPath).filter(path => {
    const cached = photoUrlCache.get(path);
    return !cached || cached.expiresAt <= now;
  }))];
  if (missing.length) {
    try {
      const data = await apiRequest("/api/photo-url", { method: "POST", body: { paths: missing } });
      const ttl = Math.max(60, Number(data.expiresIn) || 3600) * 1000;
      for (const [path, url] of Object.entries(data.urls || {})) photoUrlCache.set(path, { url, expiresAt: now + ttl - 60000 });
    } catch (error) {
      console.warn("Photos d’emplacement", error.message);
    }
  }
  for (const img of images) {
    const cached = photoUrlCache.get(img.dataset.stockPhotoPath);
    if (!cached) continue;
    img.src = cached.url;
    img.addEventListener("load", () => img.parentElement?.classList.add("loaded"), { once: true });
  }
}
function scheduleAutoSync(delay = AUTOSYNC_DELAY) {
  if (!session?.pin) return;
  clearTimeout(autoSyncTimer);
  if (!navigator.onLine) {
    syncMode = "offline";
    updateSyncIndicator();
    return;
  }
  syncMode = "pending";
  updateSyncIndicator();
  autoSyncTimer = setTimeout(() => syncNow({ silent: true, broadcast: true, source: "auto" }), delay);
}
async function syncNow({ silent = false, broadcast = true, source = "manual" } = {}) {
  if (!session?.pin) {
    if (!silent) toast("Reconnecte-toi pour synchroniser");
    return null;
  }
  if (!navigator.onLine) {
    syncMode = "offline";
    updateSyncIndicator();
    if (!silent) toast("Hors ligne : les changements seront envoyés au retour du réseau");
    return null;
  }
  if (syncInFlight) {
    syncAgain = true;
    syncAgainBroadcast = syncAgainBroadcast || broadcast;
    return syncInFlight;
  }
  syncMode = "working";
  updateSyncIndicator();
  syncInFlight = (async () => {
    try {
      const data = await apiRequest("/api/sync", { method: "POST", body: { snapshot: state } });
      state = sanitizeState(data.snapshot);
      ensureSessionEmployee();
      state.meta.lastSyncAt = nowIso();
      saveState({ touch: false, sync: false });
      syncMode = realtimeActive ? "realtime" : "cloud";
      if (!formDirty || source === "manual" || source === "auto") render();
      if (broadcast && realtimeActive && realtimeChannel) {
        await realtimeChannel.send({
          type: "broadcast",
          event: "state-changed",
          payload: { clientId, updatedAt: state.meta.updatedAt }
        });
      }
      if (!silent) toast("Synchronisation terminée");
      return state;
    } catch (error) {
      syncMode = "error";
      updateSyncIndicator();
      if (!silent) toast(error.message);
      else console.warn("Synchronisation", error.message);
      return null;
    } finally {
      syncInFlight = null;
      if (syncAgain) {
        const queuedBroadcast = syncAgainBroadcast;
        syncAgain = false;
        syncAgainBroadcast = false;
        setTimeout(() => syncNow({ silent: true, broadcast: queuedBroadcast, source: "queued" }), 250);
      }
    }
  })();
  return syncInFlight;
}
function loadSupabaseBrowserClient() {
  if (window.supabase?.createClient) return Promise.resolve(true);
  if (loadSupabaseBrowserClient.promise) return loadSupabaseBrowserClient.promise;
  loadSupabaseBrowserClient.promise = new Promise(resolve => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.async = true;
    script.onload = () => resolve(Boolean(window.supabase?.createClient));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    setTimeout(() => resolve(Boolean(window.supabase?.createClient)), 5000);
  });
  return loadSupabaseBrowserClient.promise;
}
async function initRealtime() {
  if (!session?.pin) return;
  const libraryReady = await loadSupabaseBrowserClient();
  if (!libraryReady) return;
  try {
    const config = await apiRequest("/api/realtime-config");
    if (!config.enabled) return;
    realtimeClient = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    realtimeChannel = realtimeClient.channel(config.topic, {
      config: { private: false, broadcast: { self: false } }
    });
    realtimeChannel
      .on("broadcast", { event: "state-changed" }, payload => {
        if (payload?.payload?.clientId === clientId) return;
        if (formDirty) {
          remoteUpdatePending = true;
          toast("Une mise à jour cloud est disponible; elle sera appliquée après ce formulaire.");
          return;
        }
        syncNow({ silent: true, broadcast: false, source: "remote" });
      })
      .subscribe(status => {
        realtimeActive = status === "SUBSCRIBED";
        if (realtimeActive) syncMode = "realtime";
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && state.meta.lastSyncAt) syncMode = "cloud";
        updateSyncIndicator();
      });
  } catch (error) {
    console.warn("Temps réel indisponible", error.message);
  }
}
function startCloudServices() {
  if (cloudStarted || !session?.pin) return;
  cloudStarted = true;
  initRealtime();
  syncNow({ silent: true, broadcast: false, source: "initial" });
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine && !formDirty) syncNow({ silent: true, broadcast: false, source: "poll" });
  }, POLL_INTERVAL);
}
async function stopCloudServices() {
  clearInterval(pollTimer);
  clearTimeout(autoSyncTimer);
  pollTimer = null;
  cloudStarted = false;
  realtimeActive = false;
  if (realtimeClient && realtimeChannel) await realtimeClient.removeChannel(realtimeChannel).catch(() => {});
  realtimeClient = null;
  realtimeChannel = null;
}
async function checkHealth() {
  const box = document.querySelector("#healthResult");
  if (!box) return;
  box.hidden = false;
  box.textContent = "Vérification…";
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    box.innerHTML = `<strong>Vercel :</strong> opérationnel<br><strong>Analyse photo :</strong> ${data.openaiConfigured ? "configurée" : "clé manquante"}<br><strong>Cloud :</strong> ${data.supabaseConfigured ? "configuré" : "variables manquantes"}<br><strong>Temps réel :</strong> ${data.realtimeConfigured ? "configuré" : "clé publique manquante"}<br><strong>Photos d’emplacement :</strong> ${data.photoStorageConfigured ? "configurées" : "non configurées"}`;
  } catch {
    box.textContent = "Fonctions Vercel inaccessibles.";
  }
}

function deleteManaged(type, id) {
  const inUse = state.items.some(x => type === "list" ? x.listId === id : x.departmentId === id);
  if (inUse) return toast("Impossible : cet élément est utilisé par des articles");
  const collection = type === "list" ? "lists" : "departments";
  if (state[collection].length <= 1) return toast("Il faut conserver au moins un élément");
  if (!confirm("Supprimer cet élément?")) return;
  state[collection] = state[collection].filter(x => x.id !== id);
  const tombstones = type === "list" ? "deletedListIds" : "deletedDepartmentIds";
  state[tombstones] = [...new Set([...(state[tombstones] || []), id])];
  saveState();
  render();
}
function deleteEmployee(id) {
  if (state.items.some(item => (item.assignedEmployeeIds || []).includes(id))) return toast("Impossible : cet employé est assigné à des articles");
  if (session?.employeeId === id) return toast("Impossible de supprimer l’employé actuellement connecté");
  if (!confirm("Supprimer cet employé?")) return;
  state.employees = state.employees.filter(x => x.id !== id);
  state.deletedEmployeeIds = [...new Set([...(state.deletedEmployeeIds || []), id])];
  saveState();
  render();
}
function downloadBlob(content, type, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
function exportJSON() { downloadBlob(JSON.stringify(state, null, 2), "application/json", `remplissage-${new Date().toISOString().slice(0, 10)}.json`); }
function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function exportCSV() {
  const headers = ["SKU", "Description", "Liste", "Département", "Quantité", "Priorité", "Statut", "Assigné à", "Lift requis", "Permis valide assigné", "Emplacement tablette", "Emplacement réserve", "Photo emplacement", "Note", "Mis à jour par", "Date"];
  const rows = state.items.map(item => {
    const employees = assignedEmployees(item);
    return [formatSku(item.sku), item.name, listName(item.listId), departmentName(item.departmentId), item.quantity, PRIORITY_LABELS[item.priority], STATUS_LABELS[item.status], employees.map(x => x.name).join("; "), item.requiresForklift ? "Oui" : "Non", item.requiresForklift ? (employees.some(isLiftPermitValid) ? "Oui" : "Non") : "Sans objet", item.salesLocation, item.stockLocation, item.stockPhotoPath ? "Oui" : "Non", item.note, item.updatedBy, item.updatedAt];
  });
  downloadBlob("\ufeff" + [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8", `remplissage-${new Date().toISOString().slice(0, 10)}.csv`);
}

els.loginForm.addEventListener("submit", e => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  saveSession({ name: String(data.get("name") || "").trim(), pin: String(data.get("pin") || "") });
  showApp();
});
document.querySelectorAll("[data-nav]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.nav)));
els.syncButton.addEventListener("click", () => syncNow({ silent: false, broadcast: true, source: "manual" }));

els.appMain.addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target;
  if (form.id === "itemForm" || form.id === "scanForm") {
    const submit = form.querySelector('[type="submit"]');
    const existing = form.id === "itemForm" && editingId ? state.items.find(x => x.id === editingId) || {} : {};
    let item = formToItem(form, existing);
    if (!item) return;
    submit.disabled = true;
    submit.textContent = stockPhotoDraft.dataUrl ? "Téléversement de la photo…" : "Enregistrement…";
    try {
      item = await applyStockPhotoChanges(item, existing);
      if (form.id === "scanForm" && new FormData(form).get("keepPhoto") && scanDraft.photo) item.photo = scanDraft.photo;
      upsertItem(item);
      const wasEdit = Boolean(editingId);
      editingId = null;
      scanDraft = emptyScanDraft();
      stockPhotoDraft = emptyStockPhotoDraft();
      toast(wasEdit ? "Article modifié et envoyé au cloud" : "Article ajouté et envoyé au cloud");
      setView("lists");
    } catch (error) {
      submit.disabled = false;
      submit.textContent = editingId ? "Enregistrer les changements" : "Ajouter à la liste";
      toast(error.message);
    }
    return;
  }
  if (form.id === "listForm" || form.id === "departmentForm") return addNamedEntry(form);
  if (form.id === "employeeForm") return saveEmployee(form);
  if (form.id === "storeForm") {
    const data = new FormData(form);
    state.settings.storeName = String(data.get("storeName") || "Mon magasin").trim();
    state.settings.keepPhotos = Boolean(data.get("keepPhotos"));
    formDirty = false;
    saveState();
    toast("Réglages enregistrés");
    render();
    return;
  }
  if (form.id === "bulkEditForm") return applyBulkEdit(form);
});

els.appMain.addEventListener("change", async e => {
  if (["cameraInput", "galleryInput"].includes(e.target.id) && e.target.files?.[0]) await handleLabelPhoto(e.target.files[0]);
  if (["stockCameraInput", "stockGalleryInput"].includes(e.target.id) && e.target.files?.[0]) await handleStockPhoto(e.target.files[0]);
  if (e.target.matches('[name="sku"]')) {
    e.target.setCustomValidity("");
    const normalized = normalizeRequiredSku(e.target.value);
    if (normalized) e.target.value = normalized;
  }
  if (e.target.classList.contains("select-item")) {
    if (e.target.checked) selectedIds.add(e.target.dataset.id); else selectedIds.delete(e.target.dataset.id);
    render();
  }
  if (e.target.id === "selectAllVisible") {
    const visible = filteredItems();
    if (e.target.checked) visible.forEach(item => selectedIds.add(item.id)); else visible.forEach(item => selectedIds.delete(item.id));
    render();
  }
  const filterMap = { filterList: "listId", filterDepartment: "departmentId", filterEmployee: "employeeId", filterStatus: "status", filterPriority: "priority" };
  if (filterMap[e.target.id]) {
    filters[filterMap[e.target.id]] = e.target.value;
    render();
  }
  if (e.target.closest("form") && !e.target.classList.contains("select-item") && !filterMap[e.target.id]) formDirty = true;
});
els.appMain.addEventListener("input", e => {
  if (e.target.matches('[name="sku"]')) e.target.setCustomValidity("");
  if (e.target.id === "filterSearch") {
    filters.search = e.target.value;
    clearTimeout(render.searchTimer);
    render.searchTimer = setTimeout(render, 180);
    return;
  }
  if (e.target.closest("form")) formDirty = true;
});

els.appMain.addEventListener("click", async e => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "go") return setView(btn.dataset.view);
  if (action === "cancel-edit") { editingId = null; stockPhotoDraft = emptyStockPhotoDraft(); return setView("lists"); }
  if (action === "edit-item") {
    editingId = btn.dataset.id;
    const item = state.items.find(x => x.id === editingId);
    stockPhotoDraft = { ...emptyStockPhotoDraft(), existingPath: item?.stockPhotoPath || "" };
    currentView = "manual";
    selectedIds.clear();
    formDirty = false;
    return render();
  }
  if (action === "cycle-status") { setStatus(btn.dataset.id, nextStatus(btn.dataset.status)); return render(); }
  if (action === "tour-status") { setStatus(btn.dataset.id, btn.dataset.status); toast(`Statut : ${STATUS_LABELS[btn.dataset.status]}`); return render(); }
  if (action === "tour-next") { tourIndex++; return render(); }
  if (action === "tour-prev") { tourIndex--; return render(); }
  if (action === "delete-item") {
    if (!confirm("Supprimer cet article?")) return;
    deleteItems([btn.dataset.id]);
    render();
    return toast("Article supprimé");
  }
  if (action === "bulk-status") {
    const status = document.querySelector("#bulkStatus")?.value;
    if (!STATUSES.includes(status) || !selectedIds.size) return;
    const selected = [...selectedIds];
    selected.forEach(id => setStatus(id, status));
    render();
    return toast(`Statut appliqué à ${selected.length} article${selected.length > 1 ? "s" : ""}`);
  }
  if (action === "bulk-delete") {
    if (!selectedIds.size || !confirm(`Supprimer les ${selectedIds.size} articles sélectionnés?`)) return;
    const count = selectedIds.size;
    deleteItems([...selectedIds]);
    render();
    return toast(`${count} article${count > 1 ? "s supprimés" : " supprimé"}`);
  }
  if (action === "bulk-edit-open") { bulkEditOpen = true; return render(); }
  if (action === "bulk-edit-close") { bulkEditOpen = false; return render(); }
  if (action === "clear-selection") { selectedIds.clear(); bulkEditOpen = false; return render(); }
  if (action === "delete-list") return deleteManaged("list", btn.dataset.id);
  if (action === "delete-department") return deleteManaged("department", btn.dataset.id);
  if (action === "edit-employee") { editingEmployeeId = btn.dataset.id; formDirty = false; return render(); }
  if (action === "cancel-employee-edit") { editingEmployeeId = null; formDirty = false; return render(); }
  if (action === "delete-employee") return deleteEmployee(btn.dataset.id);
  if (action === "clear-photo") { scanDraft = emptyScanDraft(); return render(); }
  if (action === "analyze-photo") return analyzePhoto(btn);
  if (action === "remove-stock-photo") {
    stockPhotoDraft.dataUrl = null;
    stockPhotoDraft.remove = true;
    const wrap = document.querySelector("#stockPhotoPreviewWrap");
    if (wrap) wrap.hidden = true;
    btn.hidden = true;
    formDirty = true;
    return;
  }
  if (action === "sync") return syncNow({ silent: false, broadcast: true, source: "manual" });
  if (action === "health") return checkHealth();
  if (action === "export-json") return exportJSON();
  if (action === "export-csv") return exportCSV();
  if (action === "import-json") return els.importInput.click();
  if (action === "logout") {
    await stopCloudServices();
    localStorage.removeItem(SESSION_KEY);
    session = null;
    return showLogin();
  }
});

els.importInput.addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (imported?.version !== 1 || !Array.isArray(imported.items)) throw new Error("Format invalide");
    state = sanitizeState(imported);
    ensureSessionEmployee();
    saveState();
    render();
    toast("Sauvegarde importée et envoyée au cloud");
  } catch (error) {
    toast(error.message);
  }
  e.target.value = "";
});
window.addEventListener("online", () => {
  syncMode = state.meta.lastSyncAt ? (realtimeActive ? "realtime" : "cloud") : "local";
  updateSyncIndicator();
  scheduleAutoSync(100);
});
window.addEventListener("offline", () => {
  syncMode = "offline";
  updateSyncIndicator();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && navigator.onLine && session?.pin && !formDirty) syncNow({ silent: true, broadcast: false, source: "visible" });
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
if (session?.name && session?.pin) showApp(); else showLogin();
