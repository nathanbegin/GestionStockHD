const STORAGE_KEY = "restock_app_v1";
const CLIENT_ID_KEY = "restock_client_id_v1";
const STATUSES = ["a_remplir", "recupere", "rempli", "introuvable"];
const STATUS_LABELS = { a_remplir: "À remplir", recupere: "Récupéré", rempli: "Rempli", introuvable: "Introuvable" };
const PRIORITY_LABELS = { high: "Élevée", medium: "Normale", low: "Faible" };
const ROLE_LABELS = { employee: "Employé", supervisor: "Superviseur", admin: "Administrateur" };
const APPROVAL_LABELS = { pending: "En attente", approved: "Approuvé", rejected: "Refusé" };
const ROLE_RANK = { employee: 1, supervisor: 2, admin: 3 };
const DEFAULT_DEPARTMENTS = ["Quincaillerie", "Peinture", "Électricité", "Plomberie", "Jardinage", "Matériaux", "Cour extérieure"];
const AUTOSYNC_DELAY = 650;
const POLL_INTERVAL = 15000;
const DIRECTORY_INTERVAL = 45000;
const TOUR_SWIPE_MIN_DISTANCE = 56;
const TOUR_SWIPE_MAX_DURATION = 900;

const nowIso = () => new Date().toISOString();
const makeNamedEntry = name => ({ id: crypto.randomUUID(), name, updatedAt: nowIso() });
const makeEmployee = (name, id = crypto.randomUUID()) => ({
  id,
  name,
  hasLiftPermit: false,
  liftPermitNumber: "",
  liftPermitExpiresAt: "",
  isAccount: false,
  updatedAt: nowIso()
});
const defaultState = () => ({
  version: 1,
  lists: [makeNamedEntry("Tournée principale"), makeNamedEntry("Urgences")],
  departments: DEFAULT_DEPARTMENTS.map(makeNamedEntry),
  employees: [],
  items: [],
  pickupLists: [],
  history: [],
  deletedIds: [],
  deletedListIds: [],
  deletedDepartmentIds: [],
  deletedEmployeeIds: [],
  deletedPickupListIds: [],
  settings: { storeName: "Mon magasin", keepPhotos: false },
  meta: { updatedAt: nowIso(), lastSyncAt: null }
});

let state = loadState();
let authClient = null;
let authSession = null;
let currentProfile = null;
let userDirectory = [];
let currentView = "dashboard";
let editingId = null;
let scanDraft = emptyScanDraft();
let stockPhotoDraft = emptyStockPhotoDraft();
let filters = { search: "", listId: "all", departmentId: "all", status: "open", priority: "all", employeeId: "all" };
let assignmentFilter = "unassigned";
let historyFilter = "all";
let historySearch = "";
let tourIndex = 0;
let tourSwipeStart = null;
let activePickupListId = null;
let selectedIds = new Set();
let bulkEditOpen = false;
let pickupEditorOpen = false;
let editingPickupListId = null;
let pickupDraftItemIds = [];
let formDirty = false;
let remoteUpdatePending = false;
let cloudStarted = false;
let realtimeChannel = null;
let realtimeActive = false;
let pollTimer = null;
let directoryTimer = null;
let autoSyncTimer = null;
let syncInFlight = null;
let syncAgain = false;
let syncAgainBroadcast = false;
let syncMode = navigator.onLine ? "local" : "offline";
const photoUrlCache = new Map();
const clientId = localStorage.getItem(CLIENT_ID_KEY) || crypto.randomUUID();
localStorage.setItem(CLIENT_ID_KEY, clientId);

const els = {
  authScreen: document.querySelector("#authScreen"),
  authForms: document.querySelector("#authForms"),
  loginForm: document.querySelector("#loginForm"),
  signupForm: document.querySelector("#signupForm"),
  showLoginTab: document.querySelector("#showLoginTab"),
  showSignupTab: document.querySelector("#showSignupTab"),
  authMessage: document.querySelector("#authMessage"),
  pendingCard: document.querySelector("#pendingCard"),
  pendingMessage: document.querySelector("#pendingMessage"),
  pendingRefresh: document.querySelector("#pendingRefresh"),
  bootstrapForm: document.querySelector("#bootstrapForm"),
  appShell: document.querySelector("#appShell"),
  appMain: document.querySelector("#appMain"),
  pageTitle: document.querySelector("#pageTitle"),
  syncButton: document.querySelector("#syncButton"),
  syncDot: document.querySelector("#syncDot"),
  syncLabel: document.querySelector("#syncLabel"),
  currentUserName: document.querySelector("#currentUserName"),
  currentUserRole: document.querySelector("#currentUserRole"),
  logoutButton: document.querySelector("#logoutButton"),
  toast: document.querySelector("#toast"),
  importInput: document.querySelector("#importInput")
};

function emptyScanDraft() { return { photo: null, sku: "", name: "", confidence: null, rawText: "", barcode: "" }; }
function emptyStockPhotoDraft() { return { dataUrl: null, remove: false, existingPath: "" }; }
function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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
  const deletedPickupListIds = new Set(Array.isArray(source.deletedPickupListIds) ? source.deletedPickupListIds : []);
  const listsResult = dedupeNamedCollection((source.lists || []).filter(x => !deletedListIds.has(x?.id)), ["Tournée principale"]);
  const departmentsResult = dedupeNamedCollection((source.departments || []).filter(x => !deletedDepartmentIds.has(x?.id)), DEFAULT_DEPARTMENTS);
  const employeesResult = dedupeNamedCollection((source.employees || []).filter(x => !deletedEmployeeIds.has(x?.id)), []);
  const listFallback = listsResult.collection[0]?.id || "";
  const departmentFallback = departmentsResult.collection[0]?.id || "";
  const employees = employeesResult.collection.map(employee => ({
    ...employee,
    hasLiftPermit: Boolean(employee.hasLiftPermit),
    liftPermitNumber: String(employee.liftPermitNumber || ""),
    liftPermitExpiresAt: String(employee.liftPermitExpiresAt || ""),
    isAccount: Boolean(employee.isAccount),
    role: employee.role || "employee"
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
      assignedEmployeeIds: [...new Set((rawItem.assignedEmployeeIds || []).map(id => employeesResult.idMap.get(id) || id).filter(id => employeeIds.has(id)))],
      requiresForklift: Boolean(rawItem.requiresForklift),
      stockPhotoPath: String(rawItem.stockPhotoPath || ""),
      status: STATUSES.includes(rawItem.status) ? rawItem.status : "a_remplir",
      priority: ["high", "medium", "low"].includes(rawItem.priority) ? rawItem.priority : "medium",
      updatedAt: rawItem.updatedAt || rawItem.createdAt || nowIso()
    });
  }
  const itemIds = new Set(items.map(x => x.id));
  const pickupLists = (Array.isArray(source.pickupLists) ? source.pickupLists : [])
    .filter(x => x?.id && !deletedPickupListIds.has(x.id))
    .map(x => ({
      ...x,
      name: String(x.name || "Liste de ramassage").trim(),
      pickupLocation: String(x.pickupLocation || "").trim(),
      itemIds: [...new Set((x.itemIds || []).filter(id => itemIds.has(id)))],
      assignedEmployeeIds: [...new Set((x.assignedEmployeeIds || []).map(id => employeesResult.idMap.get(id) || id).filter(id => employeeIds.has(id)))],
      updatedAt: x.updatedAt || x.createdAt || nowIso()
    }));
  const history = (Array.isArray(source.history) ? source.history : [])
    .filter(x => x?.id && x?.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5000);
  return {
    version: 1,
    lists: listsResult.collection,
    departments: departmentsResult.collection,
    employees,
    items,
    pickupLists,
    history,
    deletedIds: [...deletedItems],
    deletedListIds: [...deletedListIds],
    deletedDepartmentIds: [...deletedDepartmentIds],
    deletedEmployeeIds: [...deletedEmployeeIds],
    deletedPickupListIds: [...deletedPickupListIds],
    settings: { storeName: String(source.settings?.storeName || "Mon magasin"), keepPhotos: Boolean(source.settings?.keepPhotos) },
    meta: { updatedAt: source.meta?.updatedAt || nowIso(), lastSyncAt: source.meta?.lastSyncAt || null }
  };
}
function loadState() {
  try { return sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return sanitizeState(defaultState()); }
}
function saveState({ touch = true, sync = true } = {}) {
  if (touch) state.meta.updatedAt = nowIso();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (sync) scheduleAutoSync();
}
function escapeHTML(value = "") { return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function formatDate(value) {
  if (!value) return "—";
  try { return new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return "—"; }
}
function listName(id) { return state.lists.find(x => x.id === id)?.name || "Sans liste"; }
function departmentName(id) { return state.departments.find(x => x.id === id)?.name || "Sans département"; }
function employeeById(id) { return state.employees.find(x => x.id === id) || null; }
function assignedEmployees(item) { return (item.assignedEmployeeIds || []).map(employeeById).filter(Boolean); }
function pickupById(id) { return state.pickupLists.find(x => x.id === id) || null; }
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
function roleAtLeast(minimum) { return (ROLE_RANK[currentProfile?.role] || 0) >= (ROLE_RANK[minimum] || 99); }
function canManageAssignments() { return roleAtLeast("supervisor"); }
function canManageUsers() { return roleAtLeast("supervisor"); }
function isAdmin() { return currentProfile?.role === "admin"; }
function currentName() { return currentProfile?.full_name || currentProfile?.fullName || authSession?.user?.email || "Utilisateur"; }
function currentEmployeeId() { return currentProfile?.id || authSession?.user?.id || ""; }
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3600);
}
function setAuthMessage(message, type = "info") {
  els.authMessage.hidden = !message;
  els.authMessage.className = `analysis-box auth-message ${type}`;
  els.authMessage.textContent = message || "";
}
function updateSyncIndicator(mode = syncMode) {
  const effective = navigator.onLine ? mode : "offline";
  const classes = { error: "error", cloud: "cloud", realtime: "cloud", working: "working", pending: "pending", offline: "offline", local: "local" };
  const labels = { error: "Erreur", cloud: "Cloud", realtime: "En direct", working: "Envoi…", pending: "À envoyer", offline: "Hors ligne", local: "Local" };
  els.syncDot.className = `status-dot ${classes[effective] || "local"}`;
  els.syncLabel.textContent = labels[effective] || "Local";
}
function getOpenItems() { return state.items.filter(item => !["rempli", "introuvable"].includes(item.status)); }
function mergeDirectoryIntoEmployees() {
  const profiles = [...userDirectory];
  if (currentProfile?.approval_status === "approved" || currentProfile?.approvalStatus === "approved") {
    const current = {
      id: currentProfile.id,
      fullName: currentProfile.full_name || currentProfile.fullName || "Utilisateur",
      role: currentProfile.role || "employee",
      approvalStatus: "approved",
      hasLiftPermit: Boolean(currentProfile.has_lift_permit ?? currentProfile.hasLiftPermit),
      liftPermitNumber: currentProfile.lift_permit_number || currentProfile.liftPermitNumber || "",
      liftPermitExpiresAt: currentProfile.lift_permit_expires_at || currentProfile.liftPermitExpiresAt || "",
      updatedAt: currentProfile.updated_at || currentProfile.updatedAt || nowIso()
    };
    const index = profiles.findIndex(x => x.id === current.id);
    if (index >= 0) profiles[index] = { ...profiles[index], ...current }; else profiles.push(current);
  }
  const byId = new Map(state.employees.map(x => [x.id, x]));
  for (const profile of profiles.filter(x => x.approvalStatus === "approved")) {
    const existing = byId.get(profile.id);
    const employee = {
      ...(existing || makeEmployee(profile.fullName, profile.id)),
      id: profile.id,
      name: profile.fullName,
      hasLiftPermit: Boolean(profile.hasLiftPermit),
      liftPermitNumber: profile.liftPermitNumber || "",
      liftPermitExpiresAt: profile.liftPermitExpiresAt || "",
      isAccount: true,
      role: profile.role || "employee",
      updatedAt: profile.updatedAt || nowIso()
    };
    if (existing) Object.assign(existing, employee); else state.employees.push(employee);
    byId.set(profile.id, employee);
  }
  saveState({ touch: false, sync: false });
}
function recordHistory(type, message, refs = {}) {
  state.history.unshift({
    id: crypto.randomUUID(),
    type,
    message,
    itemId: refs.itemId || "",
    pickupListId: refs.pickupListId || "",
    actorUserId: currentEmployeeId(),
    actorName: currentName(),
    details: refs.details || {},
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  state.history = state.history.slice(0, 5000);
}

async function loadSupabaseLibrary() {
  if (window.supabase?.createClient) return true;
  if (loadSupabaseLibrary.promise) return loadSupabaseLibrary.promise;
  loadSupabaseLibrary.promise = new Promise(resolve => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.109.0";
    script.async = true;
    script.onload = () => resolve(Boolean(window.supabase?.createClient));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    setTimeout(() => resolve(Boolean(window.supabase?.createClient)), 7000);
  });
  return loadSupabaseLibrary.promise;
}
async function initAuthClient() {
  const libraryReady = await loadSupabaseLibrary();
  if (!libraryReady) throw new Error("Impossible de charger le module de connexion Supabase");
  const response = await fetch("/api/client-config", { cache: "no-store" });
  const config = await response.json();
  if (!response.ok || !config.enabled) throw new Error("Supabase Auth n’est pas configuré dans Vercel");
  authClient = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  authClient.auth.onAuthStateChange((_event, sessionValue) => {
    authSession = sessionValue;
    if (!sessionValue) {
      currentProfile = null;
      stopCloudServices();
      showAuthForms();
    }
  });
  const { data, error } = await authClient.auth.getSession();
  if (error) throw error;
  authSession = data.session;
}
async function authFetch(url, options = {}) {
  const token = authSession?.access_token;
  if (!token) throw new Error("Connexion requise");
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  return response;
}
async function apiRequest(url, { method = "GET", body = null } = {}) {
  const response = await authFetch(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    if (response.status === 401) setTimeout(() => logout(), 0);
    throw new Error(data.error || `Erreur HTTP ${response.status}`);
  }
  return data;
}
async function loadCurrentProfile() {
  const response = await authFetch("/api/me", { method: "GET" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Profil inaccessible");
  currentProfile = data.profile;
  const status = currentProfile.approval_status;
  if (status !== "approved") {
    showPending(data.bootstrapAvailable, status);
    return false;
  }
  await refreshUserDirectory({ silent: true });
  showApp();
  return true;
}
async function refreshUserDirectory({ silent = false } = {}) {
  if (!authSession?.access_token || !currentProfile || currentProfile.approval_status !== "approved") return;
  try {
    const data = await apiRequest("/api/users");
    userDirectory = Array.isArray(data.users) ? data.users : [];
    mergeDirectoryIntoEmployees();
    if (!silent && ["users", "assignments", "pickups"].includes(currentView)) render();
  } catch (error) {
    if (!silent) toast(error.message);
  }
}
function showAuthForms() {
  els.authScreen.hidden = false;
  els.authForms.hidden = false;
  els.pendingCard.hidden = true;
  els.appShell.hidden = true;
  setAuthMessage("");
}
function showPending(bootstrapAvailable, status = "pending") {
  els.authScreen.hidden = false;
  els.authForms.hidden = true;
  els.pendingCard.hidden = false;
  els.appShell.hidden = true;
  els.pendingMessage.textContent = status === "rejected"
    ? "Cette demande a été refusée. Communique avec un superviseur ou un administrateur."
    : "Un superviseur ou un administrateur doit accepter ta demande avant l’accès.";
  els.bootstrapForm.hidden = !bootstrapAvailable || status === "rejected";
}
function showApp() {
  mergeDirectoryIntoEmployees();
  els.authScreen.hidden = true;
  els.appShell.hidden = false;
  els.currentUserName.textContent = currentName();
  els.currentUserRole.textContent = ROLE_LABELS[currentProfile?.role] || currentProfile?.role || "";
  render();
  startCloudServices();
}
async function logout() {
  await stopCloudServices();
  if (authClient) await authClient.auth.signOut().catch(() => {});
  authSession = null;
  currentProfile = null;
  userDirectory = [];
  showAuthForms();
}
function switchAuthTab(tab) {
  const signup = tab === "signup";
  els.loginForm.hidden = signup;
  els.signupForm.hidden = !signup;
  els.showLoginTab.classList.toggle("active", !signup);
  els.showSignupTab.classList.toggle("active", signup);
  setAuthMessage("");
}

function setView(view) {
  const previousView = currentView;
  currentView = view;
  formDirty = false;
  if (previousView !== view && ["manual", "scan"].includes(view)) stockPhotoDraft = emptyStockPhotoDraft();
  if (view !== "manual") editingId = null;
  if (!["lists", "assignments"].includes(view)) {
    selectedIds.clear();
    bulkEditOpen = false;
  }
  if (!["manual", "scan"].includes(view)) stockPhotoDraft = emptyStockPhotoDraft();
  if (view !== "pickups") {
    pickupEditorOpen = false;
    editingPickupListId = null;
    pickupDraftItemIds = [];
  }
  document.querySelectorAll("[data-nav]").forEach(btn => btn.classList.toggle("active", btn.dataset.nav === view || (btn.dataset.nav === "more" && ["history", "users", "settings"].includes(view))));
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
    lists: "Articles",
    assignments: "Attribution",
    pickups: "Listes de ramassage",
    tour: "Ramassage",
    more: "Plus",
    history: "Historique",
    users: "Utilisateurs",
    settings: "Réglages"
  };
  els.pageTitle.textContent = titles[currentView] || "Remplissage";
  const renderer = {
    dashboard: renderDashboard,
    scan: renderScan,
    manual: renderManual,
    lists: renderLists,
    assignments: renderAssignments,
    pickups: renderPickups,
    tour: renderTour,
    more: renderMore,
    history: renderHistory,
    users: renderUsers,
    settings: renderSettings
  }[currentView] || renderDashboard;
  els.appMain.innerHTML = renderer();
  updateSyncIndicator();
  queueMicrotask(hydrateStockPhotos);
}
function renderEmpty(title, text) {
  return `<div class="card empty"><div class="icon">□</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p></div>`;
}
function options(collection, selected, allLabel = null) {
  const head = allLabel !== null ? `<option value="all" ${selected === "all" ? "selected" : ""}>${escapeHTML(allLabel)}</option>` : "";
  return head + collection.map(x => `<option value="${x.id}" ${selected === x.id ? "selected" : ""}>${escapeHTML(x.name)}</option>`).join("");
}
function renderDashboard() {
  const open = getOpenItems();
  const high = open.filter(x => x.priority === "high").length;
  const mine = open.filter(x => (x.assignedEmployeeIds || []).includes(currentEmployeeId())).length;
  const unassigned = open.filter(x => !(x.assignedEmployeeIds || []).length).length;
  const liftWarnings = open.filter(x => x.requiresForklift && !assignedEmployees(x).some(isLiftPermitValid)).length;
  const recent = [...state.history].slice(0, 5);
  return `
    <section class="section">
      <div class="section-head"><div><h2>Bonjour ${escapeHTML(currentName())}</h2><p class="muted">${escapeHTML(state.settings.storeName)} · ${new Date().toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}</p></div></div>
      <div class="grid stats-grid five-stats">
        <article class="card stat-card"><span class="stat-label">À traiter</span><strong>${open.length}</strong></article>
        <article class="card stat-card attention"><span class="stat-label">Priorité élevée</span><strong>${high}</strong></article>
        <article class="card stat-card"><span class="stat-label">Assignés à moi</span><strong>${mine}</strong></article>
        <article class="card stat-card"><span class="stat-label">À attribuer</span><strong>${unassigned}</strong></article>
        <article class="card stat-card ${liftWarnings ? "danger-card" : ""}"><span class="stat-label">Permis lift à vérifier</span><strong>${liftWarnings}</strong></article>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>Actions rapides</h2><p class="muted">Relever, attribuer ou préparer un ramassage.</p></div></div>
      <div class="grid actions-grid">
        <button class="card action-card" data-action="go" data-view="scan"><span class="icon">▣</span><h3>Photographier</h3><p>Lire une étiquette et confirmer son numéro.</p></button>
        <button class="card action-card" data-action="go" data-view="manual"><span class="icon">＋</span><h3>Ajouter</h3><p>Saisir un article et son emplacement.</p></button>
        <button class="card action-card" data-action="go" data-view="assignments"><span class="icon">👤</span><h3>Attribuer</h3><p>Voir les articles assignés ou sans responsable.</p></button>
        <button class="card action-card" data-action="go" data-view="pickups"><span class="icon">⇢</span><h3>Ramassages</h3><p>Créer une tournée personnalisée et l’exporter.</p></button>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><h2>Activité récente</h2><p class="muted">Ajouts, attributions et ramassages.</p></div><button class="button compact" data-action="go" data-view="history">Tout voir</button></div>
      ${recent.length ? `<div class="history-list">${recent.map(renderHistoryRow).join("")}</div>` : renderEmpty("Aucune activité", "Les ajouts et changements de statut apparaîtront ici.")}
    </section>`;
}
function skuField(value = "") {
  return `<input name="sku" required inputmode="numeric" autocomplete="off" maxlength="14" value="${escapeHTML(formatSku(value))}" placeholder="Ex. 1001 123 456"><span class="field-hint">Formats acceptés : 1001-123456, 1001123456 ou 1001 123 456.</span>`;
}
function renderEmployeePicker(selected = [], { name = "assignedEmployeeIds", approvedOnly = true } = {}) {
  const employees = approvedOnly ? state.employees.filter(x => x.isAccount || !userDirectory.length) : state.employees;
  if (!employees.length) return `<p class="small muted">Aucun employé approuvé disponible.</p>`;
  const selectedSet = new Set(selected || []);
  return `<div class="employee-picker">${employees.map(employee => {
    const valid = isLiftPermitValid(employee);
    return `<label class="employee-option"><input type="checkbox" name="${name}" value="${employee.id}" ${selectedSet.has(employee.id) ? "checked" : ""}><span><strong>${escapeHTML(employee.name)}</strong><small class="${valid ? "permit-ok" : "permit-bad"}">${escapeHTML(liftPermitLabel(employee))}${employee.role ? ` · ${escapeHTML(ROLE_LABELS[employee.role] || employee.role)}` : ""}</small></span></label>`;
  }).join("")}</div>`;
}
function renderStockPhotoField(item = {}) {
  const path = stockPhotoDraft.remove ? "" : (stockPhotoDraft.existingPath || item.stockPhotoPath || "");
  const local = stockPhotoDraft.dataUrl;
  const hasPreview = Boolean(local || path);
  return `<div class="full stock-photo-field">
    <div class="field-title">Photo de l’emplacement d’entreposage</div>
    <p class="field-hint">La photo privée aide l’employé à retrouver la palette ou la zone de réserve.</p>
    <div class="photo-choice-grid compact-grid"><label class="button primary photo-choice" for="stockCameraInput">📷 Prendre une photo</label><label class="button photo-choice" for="stockGalleryInput">🖼 Choisir une photo</label></div>
    <input id="stockCameraInput" class="hidden-file" type="file" accept="image/*" capture="environment"><input id="stockGalleryInput" class="hidden-file" type="file" accept="image/*">
    <div id="stockPhotoPreviewWrap" class="preview stock-preview" ${hasPreview ? "" : "hidden"}><img id="stockPhotoPreview" ${local ? `src="${local}"` : ""} ${!local && path ? `data-stock-photo-path="${escapeHTML(path)}"` : ""} alt="Photo de l’emplacement d’entreposage"></div>
    <button id="removeStockPhotoButton" class="button compact danger" type="button" data-action="remove-stock-photo" ${hasPreview ? "" : "hidden"}>Retirer la photo</button>
  </div>`;
}
function commonItemFields(item = {}) {
  const listId = item.listId || state.lists[0]?.id || "";
  const departmentId = item.departmentId || state.departments[0]?.id || "";
  return `
    <label>Numéro d’article / SKU${skuField(item.sku || "")}</label>
    <label>Description<input name="name" maxlength="140" value="${escapeHTML(item.name || "")}" placeholder="Ex. Perceuse sans fil 20 V"></label>
    <label>Liste source<select name="listId" required>${options(state.lists, listId)}</select></label>
    <label>Département<select name="departmentId" required>${options(state.departments, departmentId)}</select></label>
    <label>Quantité à remplir<input name="quantity" type="number" inputmode="numeric" min="1" max="999" required value="${Number(item.quantity) || 1}"></label>
    <label>Priorité<select name="priority"><option value="high" ${item.priority === "high" ? "selected" : ""}>Élevée</option><option value="medium" ${!item.priority || item.priority === "medium" ? "selected" : ""}>Normale</option><option value="low" ${item.priority === "low" ? "selected" : ""}>Faible</option></select></label>
    <label>Emplacement en tablette<input name="salesLocation" maxlength="120" value="${escapeHTML(item.salesLocation || "")}" placeholder="Allée 12, section B, tablette 3"></label>
    <label>Lieu du ramassage<input name="stockLocation" maxlength="120" value="${escapeHTML(item.stockLocation || "")}" placeholder="Entrepôt R4, niveau 2 ou cour zone B"></label>
    ${canManageAssignments()
      ? `<div class="full assignment-field"><div class="field-title">Employé(s) assigné(s)</div>${renderEmployeePicker(item.assignedEmployeeIds || [])}</div>`
      : `<div class="full assignment-field readonly-assignment"><div class="field-title">Employé(s) assigné(s)</div><p class="small muted">${escapeHTML(assignedEmployees(item).map(x => x.name).join(", ") || "Aucune attribution")}</p>${(item.assignedEmployeeIds || []).map(id => `<input type="hidden" name="assignedEmployeeIds" value="${escapeHTML(id)}">`).join("")}<span class="field-hint">L’attribution est gérée par un superviseur ou un administrateur.</span></div>`}
    <label class="full check-card"><span><input name="requiresForklift" type="checkbox" ${item.requiresForklift ? "checked" : ""}> Nécessite un chariot élévateur (lift)</span><span class="field-hint">Au moins une personne assignée doit avoir un permis valide.</span></label>
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
    <div class="card"><div class="scan-zone"><span class="scan-icon">▣</span><strong>${scanDraft.photo ? "Remplacer la photo" : "Ajouter une photo d’étiquette"}</strong><span class="small muted">Les deux options sont disponibles dans la PWA.</span><div class="photo-choice-grid"><label class="button primary photo-choice" for="cameraInput">📷 Prendre une photo</label><label class="button photo-choice" for="galleryInput">🖼 Choisir une photo existante</label></div><input id="cameraInput" type="file" accept="image/*" capture="environment"><input id="galleryInput" type="file" accept="image/*"></div>
      ${scanDraft.photo ? `<div class="preview"><img src="${scanDraft.photo}" alt="Aperçu de l’étiquette"></div><div class="button-row top-gap"><button class="button primary" data-action="analyze-photo">Analyser l’étiquette</button><button class="button" data-action="clear-photo">Effacer</button></div>` : ""}
      ${scanDraft.confidence !== null ? `<div class="analysis-box"><div class="button-row"><span class="confidence">Confiance ${Math.round(scanDraft.confidence * 100)} %</span>${scanDraft.barcode ? `<span class="tag">Code-barres ${escapeHTML(scanDraft.barcode)}</span>` : ""}</div><p class="small muted">${escapeHTML(scanDraft.rawText || "Résultat extrait. Vérifie les champs ci-dessous.")}</p></div>` : ""}
    </div></section>
    <section class="section"><div class="section-head"><div><h2>Résultat à confirmer</h2><p class="muted">Le numéro est conservé sous la forme 1001 123 456.</p></div></div><form id="scanForm" class="card"><div class="form-grid">${commonItemFields(draftItem)}<label class="full check-card"><span><input name="keepPhoto" type="checkbox" ${state.settings.keepPhotos ? "checked" : ""}> Conserver une miniature de la photo de l’étiquette</span></label></div><div class="form-actions"><button class="button primary" type="submit">Ajouter à la liste</button></div></form></section>`;
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
    if (filters.employeeId === "mine" && !(item.assignedEmployeeIds || []).includes(currentEmployeeId())) return false;
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
      <button class="button compact primary" data-action="create-pickup-from-selection">Créer un ramassage</button>
      <button class="button compact danger" data-action="bulk-delete">Supprimer</button>
      <button class="button compact" data-action="clear-selection">Annuler</button>
    </div>` : ""}
  </div>`;
}
function renderLists() {
  const items = filteredItems();
  return `<section class="section"><div class="section-head"><div><h2>${items.length} article${items.length > 1 ? "s" : ""}</h2><p class="muted">Les changements sont envoyés automatiquement au cloud.</p></div><button class="button primary" data-action="go" data-view="tour">Mode ramassage libre</button></div>
    <div class="toolbar six-filters"><input id="filterSearch" value="${escapeHTML(filters.search)}" placeholder="Rechercher SKU, produit, employé ou emplacement"><select id="filterList">${options(state.lists, filters.listId, "Toutes les listes")}</select><select id="filterDepartment">${options(state.departments, filters.departmentId, "Tous les départements")}</select><select id="filterEmployee">${employeeFilterOptions(filters.employeeId)}</select><select id="filterStatus"><option value="open" ${filters.status === "open" ? "selected" : ""}>À traiter</option><option value="all" ${filters.status === "all" ? "selected" : ""}>Tous les statuts</option>${STATUSES.map(s => `<option value="${s}" ${filters.status === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}</select><select id="filterPriority"><option value="all" ${filters.priority === "all" ? "selected" : ""}>Toutes priorités</option><option value="high" ${filters.priority === "high" ? "selected" : ""}>Élevée</option><option value="medium" ${filters.priority === "medium" ? "selected" : ""}>Normale</option><option value="low" ${filters.priority === "low" ? "selected" : ""}>Faible</option></select></div>
    ${renderBulkToolbar(items)}
    ${items.length ? `<div class="item-list">${items.map(renderItemCard).join("")}</div>` : renderEmpty("Aucun résultat", "Modifie les filtres ou ajoute un nouvel article.")}
    ${bulkEditOpen ? renderBulkEditDialog() : ""}
  </section>`;
}
function renderAssignmentTags(item) {
  const employees = assignedEmployees(item);
  const employeeTags = employees.length ? employees.map(employee => `<span class="tag employee-tag">👤 ${escapeHTML(employee.name)}</span>`).join("") : `<span class="tag permit-warning">À attribuer</span>`;
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
function renderItemCard(item, { selectable = true, compact = false } = {}) {
  const selected = selectedIds.has(item.id);
  return `<article class="card item-card ${selected ? "selected" : ""} ${compact ? "compact-item-card" : ""}">
    ${selectable ? `<label class="item-select"><input class="select-item" type="checkbox" data-id="${item.id}" ${selected ? "checked" : ""}> Sélectionner</label>` : ""}
    <div class="item-top"><div class="item-title"><div class="item-qty">${Number(item.quantity) || 1}</div><div><h3>${escapeHTML(item.name || "Article sans description")}</h3><p class="sku">${escapeHTML(formatSku(item.sku))}</p></div></div><button class="status-button" data-action="cycle-status" data-id="${item.id}" data-status="${item.status}">${STATUS_LABELS[item.status]}</button></div>
    <div class="tags"><span class="tag">${escapeHTML(listName(item.listId))}</span><span class="tag">${escapeHTML(departmentName(item.departmentId))}</span><span class="tag ${item.priority}">${PRIORITY_LABELS[item.priority]}</span>${renderAssignmentTags(item)}<span class="tag">Par ${escapeHTML(item.updatedBy || item.createdBy || "—")}</span></div>
    <div class="location-grid"><div><strong>Tablette</strong>${escapeHTML(item.salesLocation || "Non précisé")}</div><div><strong>Lieu du ramassage</strong>${escapeHTML(item.stockLocation || "Non précisé")}</div></div>
    ${compact ? "" : renderStockPhoto(item)}
    ${item.note ? `<p class="small"><strong>Note :</strong> ${escapeHTML(item.note)}</p>` : ""}
    ${!compact && item.photo ? `<details><summary class="small">Voir la photo de l’étiquette</summary><div class="preview"><img src="${item.photo}" alt="Photo de l’étiquette"></div></details>` : ""}
    ${compact ? "" : `<div class="item-actions"><button class="button compact" data-action="edit-item" data-id="${item.id}">Modifier</button><button class="button compact danger" data-action="delete-item" data-id="${item.id}">Supprimer</button><span class="tiny muted item-date">Mis à jour ${formatDate(item.updatedAt)}</span></div>`}
  </article>`;
}
function renderBulkEditDialog() {
  return `<div class="dialog-backdrop" role="presentation"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bulkEditTitle"><div class="section-head"><div><h2 id="bulkEditTitle">Modifier ${selectedIds.size} article${selectedIds.size > 1 ? "s" : ""}</h2><p class="muted small">Coche seulement les champs à remplacer.</p></div><button class="button compact" type="button" data-action="bulk-edit-close">Fermer</button></div><form id="bulkEditForm">
    <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyList"> Modifier la liste</label><select name="listId">${options(state.lists, state.lists[0]?.id || "")}</select></div>
    <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyDepartment"> Modifier le département</label><select name="departmentId">${options(state.departments, state.departments[0]?.id || "")}</select></div>
    ${canManageAssignments() ? `<div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyAssignments"> Modifier les employés assignés</label>${renderEmployeePicker([])}</div>` : ""}
    <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyForklift"> Modifier l’exigence de lift</label><label class="check-label"><input type="checkbox" name="requiresForklift"> Nécessite un chariot élévateur</label></div>
    <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyPriority"> Modifier la priorité</label><select name="priority"><option value="high">Élevée</option><option value="medium" selected>Normale</option><option value="low">Faible</option></select></div>
    <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyQuantity"> Modifier la quantité</label><input name="quantity" type="number" min="1" max="999" value="1"></div>
    <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applySalesLocation"> Modifier l’emplacement tablette</label><input name="salesLocation"></div>
    <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyStockLocation"> Modifier le lieu du ramassage</label><input name="stockLocation"></div>
    <div class="bulk-field"><label class="check-label"><input type="checkbox" name="applyNote"> Remplacer la note</label><textarea name="note"></textarea></div>
    <div class="form-actions"><button class="button primary" type="submit">Appliquer</button><button class="button" type="button" data-action="bulk-edit-close">Annuler</button></div>
  </form></div></div>`;
}

function assignmentItems() {
  const open = getOpenItems();
  if (assignmentFilter === "unassigned") return open.filter(x => !(x.assignedEmployeeIds || []).length);
  if (assignmentFilter === "mine") return open.filter(x => (x.assignedEmployeeIds || []).includes(currentEmployeeId()));
  if (assignmentFilter === "lift") return open.filter(x => x.requiresForklift && !assignedEmployees(x).some(isLiftPermitValid));
  return open;
}
function renderAssignments() {
  const items = assignmentItems();
  const canEdit = canManageAssignments();
  return `<section class="section"><div class="section-head"><div><h2>Attribution des articles</h2><p class="muted">${canEdit ? "Sélectionne des articles et attribue-les à un ou plusieurs employés." : "Consulte tes articles et les tâches encore sans responsable."}</p></div></div>
    <div class="toolbar assignment-toolbar"><select id="assignmentFilter"><option value="unassigned" ${assignmentFilter === "unassigned" ? "selected" : ""}>Sans responsable</option><option value="mine" ${assignmentFilter === "mine" ? "selected" : ""}>Mes articles</option><option value="lift" ${assignmentFilter === "lift" ? "selected" : ""}>Lift à vérifier</option><option value="all" ${assignmentFilter === "all" ? "selected" : ""}>Tous les articles ouverts</option></select></div>
    ${canEdit ? `<form id="assignmentForm" class="card assignment-panel"><div class="section-head"><div><h3>${selectedIds.size} article${selectedIds.size > 1 ? "s" : ""} sélectionné${selectedIds.size > 1 ? "s" : ""}</h3><p class="small muted">Les affectations actuelles seront remplacées.</p></div><button class="button compact" type="button" data-action="select-assignment-visible">Tout sélectionner</button></div>${renderEmployeePicker([])}<div class="form-actions"><button class="button primary" type="submit" ${selectedIds.size ? "" : "disabled"}>Appliquer l’attribution</button><button class="button" type="button" data-action="clear-selection">Effacer la sélection</button></div></form>` : ""}
    ${items.length ? `<div class="item-list assignment-items">${items.map(item => renderItemCard(item, { selectable: canEdit, compact: true })).join("")}</div>` : renderEmpty("Aucun article", "Aucun article ne correspond à ce filtre.")}
  </section>`;
}

function pickupStatus(list) {
  const items = (list.itemIds || []).map(id => state.items.find(x => x.id === id)).filter(Boolean);
  if (!items.length) return "Vide";
  if (items.every(x => x.status === "rempli")) return "Terminée";
  if (items.some(x => ["recupere", "rempli"].includes(x.status))) return "En cours";
  return "À faire";
}
function pickupEmployees(list) { return (list.assignedEmployeeIds || []).map(employeeById).filter(Boolean); }
function canEditPickup(list) { return roleAtLeast("supervisor") || list.createdByUserId === currentEmployeeId(); }
function renderPickups() {
  const lists = [...state.pickupLists].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return `<section class="section"><div class="section-head"><div><h2>Listes de ramassage personnalisées</h2><p class="muted">Regroupe les articles dans l’ordre de travail, attribue la tournée et exporte un rapport PDF.</p></div><button class="button primary" data-action="new-pickup-list">Nouvelle liste</button></div>
    ${pickupEditorOpen ? renderPickupEditor() : ""}
    ${lists.length ? `<div class="pickup-grid">${lists.map(renderPickupCard).join("")}</div>` : renderEmpty("Aucune liste personnalisée", "Crée une liste ici ou sélectionne des articles dans l’onglet Articles.")}
  </section>`;
}
function renderPickupCard(list) {
  const employees = pickupEmployees(list).map(x => x.name).join(", ") || "Non attribuée";
  const itemCount = (list.itemIds || []).filter(id => state.items.some(x => x.id === id)).length;
  return `<article class="card pickup-card"><div class="section-head"><div><p class="eyebrow">${escapeHTML(pickupStatus(list))}</p><h3>${escapeHTML(list.name)}</h3></div><span class="pickup-count">${itemCount}</span></div><p class="small"><strong>Point de départ :</strong> ${escapeHTML(list.pickupLocation || "Non précisé")}</p><p class="small"><strong>Attribuée à :</strong> ${escapeHTML(employees)}</p><p class="tiny muted">Mise à jour ${formatDate(list.updatedAt)}</p><div class="button-row"><button class="button primary compact" data-action="start-pickup" data-id="${list.id}">Commencer</button><button class="button compact" data-action="export-pickup-pdf" data-id="${list.id}">PDF</button>${canEditPickup(list) ? `<button class="button compact" data-action="edit-pickup" data-id="${list.id}">Modifier</button><button class="button compact danger" data-action="delete-pickup" data-id="${list.id}">Supprimer</button>` : ""}</div></article>`;
}
function renderPickupEditor() {
  const existing = editingPickupListId ? pickupById(editingPickupListId) : null;
  const selected = new Set(existing?.itemIds || pickupDraftItemIds || []);
  const openItems = getOpenItems();
  return `<article class="card pickup-editor"><div class="section-head"><div><h3>${existing ? "Modifier la liste" : "Nouvelle liste de ramassage"}</h3><p class="small muted">Choisis les articles, le point de départ et les employés responsables.</p></div><button class="button compact" data-action="close-pickup-editor">Fermer</button></div><form id="pickupListForm"><input type="hidden" name="pickupListId" value="${existing?.id || ""}"><div class="form-grid"><label>Nom de la liste<input name="name" required maxlength="100" value="${escapeHTML(existing?.name || "")}" placeholder="Ex. Cour extérieure - matin"></label><label>Point de départ / zone<input name="pickupLocation" maxlength="140" value="${escapeHTML(existing?.pickupLocation || "")}" placeholder="Ex. Porte 4, réserve matériaux"></label><div class="full assignment-field"><div class="field-title">Employé(s) responsables</div>${canManageAssignments() ? renderEmployeePicker(existing?.assignedEmployeeIds || []) : `<p class="small muted">Cette liste personnelle te sera attribuée automatiquement.</p><input type="hidden" name="assignedEmployeeIds" value="${escapeHTML(currentEmployeeId())}">`}</div><div class="full"><div class="field-title">Articles inclus (${selected.size})</div><div class="pickup-item-picker">${openItems.map(item => `<label class="pickup-item-option"><input type="checkbox" name="pickupItemIds" value="${item.id}" ${selected.has(item.id) ? "checked" : ""}><span><strong>${escapeHTML(formatSku(item.sku))}</strong> · ${escapeHTML(item.name || "Article")}</span><small>${escapeHTML(item.stockLocation || "Lieu non précisé")}</small></label>`).join("") || `<p class="muted">Aucun article ouvert.</p>`}</div></div></div><div class="form-actions"><button class="button primary" type="submit">${existing ? "Enregistrer" : "Créer la liste"}</button><button class="button" type="button" data-action="close-pickup-editor">Annuler</button></div></form></article>`;
}
function getTourItems() {
  if (activePickupListId) {
    const list = pickupById(activePickupListId);
    return (list?.itemIds || []).map(id => state.items.find(x => x.id === id)).filter(x => x && !["rempli", "introuvable"].includes(x.status));
  }
  return filteredItems().filter(x => !["rempli", "introuvable"].includes(x.status));
}
function moveTour(delta, { fromSwipe = false } = {}) {
  const items = getTourItems();
  const nextIndex = tourIndex + delta;
  if (nextIndex < 0 || nextIndex >= items.length) {
    if (fromSwipe) toast(delta > 0 ? "Dernier article atteint" : "Premier article atteint");
    return;
  }
  tourIndex = nextIndex;
  render();
}
function renderTour() {
  const items = getTourItems();
  const pickup = activePickupListId ? pickupById(activePickupListId) : null;
  if (!items.length) return `<section class="section">${renderEmpty("Ramassage terminé", pickup ? "Tous les articles de cette liste sont terminés ou introuvables." : "Aucun article ouvert ne correspond aux filtres actuels.")}<div class="button-row centered top-gap"><button class="button" data-action="go" data-view="${pickup ? "pickups" : "lists"}">Retour</button></div></section>`;
  tourIndex = Math.max(0, Math.min(tourIndex, items.length - 1));
  const item = items[tourIndex];
  const pct = ((tourIndex + 1) / items.length) * 100;
  const employees = assignedEmployees(item);
  const validLift = employees.some(isLiftPermitValid);
  return `<section class="section">${pickup ? `<div class="tour-context card"><div><p class="eyebrow">LISTE PERSONNALISÉE</p><strong>${escapeHTML(pickup.name)}</strong><span>${escapeHTML(pickup.pickupLocation || "Point de départ non précisé")}</span></div><button class="button compact" data-action="exit-pickup-tour">Quitter</button></div>` : ""}<article class="card tour-card">
    <div class="section-head"><div><p class="tour-number">Article ${tourIndex + 1} sur ${items.length}</p><h2>${escapeHTML(item.name || "Article sans description")}</h2><p class="sku">${escapeHTML(formatSku(item.sku))}</p></div><div class="item-qty">${item.quantity}</div></div>
    <div class="tour-progress"><span style="width:${pct}%"></span></div>
    <div class="tags"><span class="tag">${escapeHTML(departmentName(item.departmentId))}</span><span class="tag ${item.priority}">${PRIORITY_LABELS[item.priority]}</span>${renderAssignmentTags(item)}</div>
    ${item.requiresForklift && !validLift ? `<div class="safety-warning"><strong>Permis à vérifier</strong><span>Aucun employé assigné ne possède actuellement un permis de chariot élévateur valide dans l’application.</span></div>` : ""}
    <div class="location-grid top-gap"><div><strong>Aller chercher</strong>${escapeHTML(item.stockLocation || "Emplacement non précisé")}</div><div><strong>Remplir à</strong>${escapeHTML(item.salesLocation || "Emplacement non précisé")}</div></div>
    ${renderStockPhoto(item, "tour-photo")}
    ${item.note ? `<p><strong>Note :</strong> ${escapeHTML(item.note)}</p>` : ""}
    <hr><div class="button-row"><button class="button secondary" data-action="tour-status" data-status="recupere" data-id="${item.id}">Marquer récupéré</button><button class="button primary" data-action="tour-status" data-status="rempli" data-id="${item.id}">Marquer rempli</button><button class="button danger" data-action="tour-status" data-status="introuvable" data-id="${item.id}">Introuvable</button></div>
    <p class="swipe-hint" aria-label="Navigation par balayage"><span aria-hidden="true">↔</span> Balayez à gauche ou à droite pour changer d’article</p>
    <div class="button-row between top-gap"><button class="button" data-action="tour-prev" ${tourIndex === 0 ? "disabled" : ""}>← Précédent</button><button class="button" data-action="tour-next" ${tourIndex >= items.length - 1 ? "disabled" : ""}>Suivant →</button></div>
  </article></section>`;
}

function renderMore() {
  return `<section class="section"><div class="grid more-grid"><button class="card action-card" data-action="go" data-view="history"><span class="icon">≡</span><h3>Historique</h3><p>Consulter les ajouts, attributions et ramassages.</p></button>${canManageUsers() ? `<button class="card action-card" data-action="go" data-view="users"><span class="icon">👥</span><h3>Utilisateurs</h3><p>Approuver les demandes et gérer les rôles.</p></button>` : ""}<button class="card action-card" data-action="go" data-view="settings"><span class="icon">⚙</span><h3>Réglages</h3><p>Magasin, listes, départements et exportations.</p></button><button class="card action-card danger-action" data-action="logout"><span class="icon">↪</span><h3>Déconnexion</h3><p>Fermer la session de ${escapeHTML(currentName())}.</p></button></div></section>`;
}
function historyTypeLabel(type) {
  return ({ item_added: "Ajout", item_updated: "Modification", status_changed: "Ramassage", item_deleted: "Suppression", assignment_changed: "Attribution", pickup_created: "Liste créée", pickup_updated: "Liste modifiée", pickup_deleted: "Liste supprimée" })[type] || "Activité";
}
function renderHistoryRow(event) {
  const item = event.itemId ? state.items.find(x => x.id === event.itemId) : null;
  return `<article class="card history-row"><div class="history-icon">${event.type === "status_changed" ? "⇢" : event.type === "item_added" ? "+" : event.type === "assignment_changed" ? "👤" : "•"}</div><div><div class="history-meta"><span class="tag">${escapeHTML(historyTypeLabel(event.type))}</span><span class="tiny muted">${formatDate(event.createdAt)}</span></div><h3>${escapeHTML(event.message || historyTypeLabel(event.type))}</h3>${item ? `<p class="sku">${escapeHTML(formatSku(item.sku))}</p>` : ""}<p class="small muted">Par ${escapeHTML(event.actorName || "Système")}</p></div></article>`;
}
function renderHistory() {
  const q = historySearch.trim().toLowerCase();
  const events = state.history.filter(event => {
    if (historyFilter !== "all" && event.type !== historyFilter) return false;
    if (!q) return true;
    return [event.message, event.actorName, historyTypeLabel(event.type), JSON.stringify(event.details || {})].some(v => String(v || "").toLowerCase().includes(q));
  });
  return `<section class="section"><div class="section-head"><div><h2>Historique des opérations</h2><p class="muted">Journal chronologique des ajouts, attributions, récupérations et remplissages.</p></div></div><div class="toolbar history-toolbar"><input id="historySearch" value="${escapeHTML(historySearch)}" placeholder="Rechercher dans l’historique"><select id="historyFilter"><option value="all" ${historyFilter === "all" ? "selected" : ""}>Toutes les activités</option><option value="item_added" ${historyFilter === "item_added" ? "selected" : ""}>Ajouts</option><option value="assignment_changed" ${historyFilter === "assignment_changed" ? "selected" : ""}>Attributions</option><option value="status_changed" ${historyFilter === "status_changed" ? "selected" : ""}>Ramassages</option><option value="item_updated" ${historyFilter === "item_updated" ? "selected" : ""}>Modifications</option><option value="item_deleted" ${historyFilter === "item_deleted" ? "selected" : ""}>Suppressions</option></select></div>${events.length ? `<div class="history-list">${events.map(renderHistoryRow).join("")}</div>` : renderEmpty("Aucune activité", "Aucun événement ne correspond à ces filtres.")}</section>`;
}

function normalizeProfile(profile) {
  return {
    id: profile.id,
    email: profile.email || "",
    fullName: profile.fullName || profile.full_name || "Utilisateur",
    role: profile.role || "employee",
    approvalStatus: profile.approvalStatus || profile.approval_status || "pending",
    hasLiftPermit: Boolean(profile.hasLiftPermit ?? profile.has_lift_permit),
    liftPermitNumber: profile.liftPermitNumber || profile.lift_permit_number || "",
    liftPermitExpiresAt: profile.liftPermitExpiresAt || profile.lift_permit_expires_at || "",
    createdAt: profile.createdAt || profile.created_at || "",
    updatedAt: profile.updatedAt || profile.updated_at || ""
  };
}
function renderUsers() {
  if (!canManageUsers()) return `<section class="section">${renderEmpty("Accès réservé", "Seuls les superviseurs et administrateurs peuvent gérer les utilisateurs.")}</section>`;
  const users = userDirectory.map(normalizeProfile);
  const pending = users.filter(x => x.approvalStatus === "pending");
  const approved = users.filter(x => x.approvalStatus === "approved");
  const rejected = users.filter(x => x.approvalStatus === "rejected");
  return `<section class="section"><div class="section-head"><div><h2>Demandes d’accès</h2><p class="muted">Les nouveaux comptes restent bloqués jusqu’à leur approbation.</p></div><button class="button" data-action="refresh-users">Actualiser</button></div>${pending.length ? `<div class="user-grid">${pending.map(renderPendingUser).join("")}</div>` : renderEmpty("Aucune demande en attente", "Les nouvelles inscriptions apparaîtront ici.")}</section><section class="section"><div class="section-head"><div><h2>Utilisateurs approuvés</h2><p class="muted">Rôles, permis de lift et état du compte.</p></div></div><div class="user-grid">${approved.map(renderApprovedUser).join("")}</div></section>${rejected.length ? `<section class="section"><details class="card"><summary>Demandes refusées (${rejected.length})</summary><div class="user-grid top-gap">${rejected.map(renderRejectedUser).join("")}</div></details></section>` : ""}`;
}
function roleSelect(user, name = "role") {
  if (!isAdmin()) return `<strong>${escapeHTML(ROLE_LABELS[user.role] || user.role)}</strong>`;
  return `<select name="${name}"><option value="employee" ${user.role === "employee" ? "selected" : ""}>Employé</option><option value="supervisor" ${user.role === "supervisor" ? "selected" : ""}>Superviseur</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrateur</option></select>`;
}
function renderPendingUser(user) {
  return `<article class="card user-card"><p class="eyebrow">EN ATTENTE</p><h3>${escapeHTML(user.fullName)}</h3><p class="small muted">${escapeHTML(user.email)}</p><p class="tiny muted">Demande ${formatDate(user.createdAt)}</p><label>Rôle à octroyer${roleSelect({ ...user, role: "employee" }, "approvalRole")}</label><div class="button-row"><button class="button primary" data-action="approve-user" data-id="${user.id}">Approuver</button><button class="button danger" data-action="reject-user" data-id="${user.id}">Refuser</button></div></article>`;
}
function renderApprovedUser(user) {
  return `<article class="card user-card"><form class="user-edit-form" data-user-id="${user.id}"><div class="section-head"><div><p class="eyebrow">${escapeHTML(ROLE_LABELS[user.role] || user.role)}</p><h3>${escapeHTML(user.fullName)}</h3><p class="small muted">${escapeHTML(user.email)}</p></div><span class="status-badge approved">Approuvé</span></div><label>Nom complet<input name="fullName" required maxlength="80" value="${escapeHTML(user.fullName)}"></label><label>Rôle${roleSelect(user)}</label><label class="check-card"><span><input type="checkbox" name="hasLiftPermit" ${user.hasLiftPermit ? "checked" : ""}> Possède un permis de lift</span></label><label>Numéro de permis<input name="liftPermitNumber" maxlength="80" value="${escapeHTML(user.liftPermitNumber)}"></label><label>Date d’expiration<input name="liftPermitExpiresAt" type="date" value="${escapeHTML(user.liftPermitExpiresAt)}"></label>${isAdmin() ? `<label>État<select name="approvalStatus"><option value="approved" selected>Approuvé</option><option value="pending">En attente</option><option value="rejected">Refusé</option></select></label>` : ""}<div class="form-actions"><button class="button primary" type="submit">Enregistrer</button></div></form></article>`;
}
function renderRejectedUser(user) {
  return `<article class="card user-card"><h3>${escapeHTML(user.fullName)}</h3><p class="small muted">${escapeHTML(user.email)}</p><div class="button-row"><button class="button primary" data-action="approve-user" data-id="${user.id}">Réactiver comme employé</button></div></article>`;
}

function renderSettings() {
  const manager = roleAtLeast("supervisor");
  return `<section class="section"><div class="settings-grid">
    <article class="card"><h2>Compte actuel</h2><p><strong>${escapeHTML(currentName())}</strong></p><p class="small muted">${escapeHTML(authSession?.user?.email || "")} · ${escapeHTML(ROLE_LABELS[currentProfile?.role] || currentProfile?.role || "")}</p><p class="small"><strong>Permis lift :</strong> ${escapeHTML(liftPermitLabel(employeeById(currentEmployeeId()) || {}))}</p><button class="button danger" data-action="logout">Déconnexion</button></article>
    <article class="card"><h2>Synchronisation automatique</h2><p class="muted small">Chaque ajout ou modification est envoyé automatiquement. Les appareils connectés reçoivent un signal en temps réel et une vérification périodique sert de repli.</p><p class="small"><strong>Dernière synchro :</strong> ${formatDate(state.meta.lastSyncAt)}</p><p class="small"><strong>État :</strong> ${realtimeActive ? "Connexion en direct active" : navigator.onLine ? "Cloud avec vérification périodique" : "Hors ligne"}</p><div class="button-row"><button class="button primary" data-action="sync">Synchroniser maintenant</button><button class="button" data-action="health">Tester les services</button></div><div id="healthResult" class="analysis-box" hidden></div></article>
    <article class="card"><h2>Magasin</h2>${isAdmin() ? `<form id="storeForm"><label>Nom du magasin<input name="storeName" value="${escapeHTML(state.settings.storeName)}"></label><label class="check-card"><span><input type="checkbox" name="keepPhotos" ${state.settings.keepPhotos ? "checked" : ""}> Conserver les photos d’étiquettes par défaut</span></label><div class="form-actions"><button class="button primary" type="submit">Enregistrer</button></div></form>` : `<p class="muted">${escapeHTML(state.settings.storeName)}</p><p class="small muted">Seul un administrateur peut modifier ces réglages.</p>`}</article>
    ${manager ? `<article class="card"><h2>Listes source</h2><form id="listForm" class="inline-form"><label>Nouvelle liste<input name="name" required maxlength="80"></label><button class="button primary" type="submit">Ajouter</button></form><div class="manage-list">${state.lists.map(x => `<div class="manage-row"><span>${escapeHTML(x.name)}</span><button class="button compact danger" data-action="delete-list" data-id="${x.id}">Supprimer</button></div>`).join("")}</div></article><article class="card"><h2>Départements</h2><form id="departmentForm" class="inline-form"><label>Nouveau département<input name="name" required maxlength="80"></label><button class="button primary" type="submit">Ajouter</button></form><div class="manage-list">${state.departments.map(x => `<div class="manage-row"><span>${escapeHTML(x.name)}</span><button class="button compact danger" data-action="delete-department" data-id="${x.id}">Supprimer</button></div>`).join("")}</div></article>` : ""}
    <article class="card"><h2>Données et rapports</h2><p class="muted small">Les rapports PDF sont disponibles dans chaque liste de ramassage personnalisée.</p><div class="button-row"><button class="button" data-action="export-json">Exporter JSON</button><button class="button" data-action="export-csv">Exporter CSV</button><button class="button" data-action="import-json">Importer JSON</button></div></article>
  </div></section>`;
}
function formToItem(form, existing = {}) {
  const data = new FormData(form);
  const sku = normalizeRequiredSku(data.get("sku"));
  if (!sku) {
    const input = form.querySelector('[name="sku"]');
    input?.setCustomValidity("Le numéro doit contenir 10 chiffres et commencer par 1000 ou 1001.");
    input?.reportValidity();
    return null;
  }
  const assignedEmployeeIds = [...new Set(data.getAll("assignedEmployeeIds").map(String))].filter(id => employeeById(id));
  const requiresForklift = Boolean(data.get("requiresForklift"));
  if (requiresForklift && assignedEmployeeIds.length && !assignedEmployeeIds.map(employeeById).some(isLiftPermitValid)) {
    toast("Affectation refusée : cet article nécessite au moins un permis de lift valide.");
    return null;
  }
  const now = nowIso();
  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    sku,
    name: String(data.get("name") || "").trim(),
    listId: String(data.get("listId") || state.lists[0]?.id || ""),
    departmentId: String(data.get("departmentId") || state.departments[0]?.id || ""),
    quantity: Math.max(1, Number(data.get("quantity") || 1)),
    priority: String(data.get("priority") || "medium"),
    salesLocation: String(data.get("salesLocation") || "").trim(),
    stockLocation: String(data.get("stockLocation") || "").trim(),
    assignedEmployeeIds,
    requiresForklift,
    note: String(data.get("note") || "").trim(),
    status: existing.status || "a_remplir",
    createdAt: existing.createdAt || now,
    createdBy: existing.createdBy || currentName(),
    createdByUserId: existing.createdByUserId || currentEmployeeId(),
    updatedAt: now,
    updatedBy: currentName(),
    updatedByUserId: currentEmployeeId(),
    stockPhotoPath: existing.stockPhotoPath || ""
  };
}
async function applyStockPhotoChanges(item, existing = {}) {
  if (stockPhotoDraft.dataUrl) {
    const data = await apiRequest("/api/photo-upload", { method: "POST", body: { image: stockPhotoDraft.dataUrl, itemId: item.id, oldPath: existing.stockPhotoPath || "" } });
    item.stockPhotoPath = data.path || "";
    photoUrlCache.delete(existing.stockPhotoPath || "");
  } else if (stockPhotoDraft.remove && existing.stockPhotoPath) {
    await apiRequest("/api/photo-delete", { method: "POST", body: { path: existing.stockPhotoPath } });
    item.stockPhotoPath = "";
    photoUrlCache.delete(existing.stockPhotoPath);
  }
  return item;
}
function upsertItem(item) {
  const index = state.items.findIndex(x => x.id === item.id);
  const existed = index >= 0;
  if (existed) state.items[index] = item; else state.items.unshift(item);
  recordHistory(existed ? "item_updated" : "item_added", existed ? `Article ${formatSku(item.sku)} modifié` : `Article ${formatSku(item.sku)} ajouté`, { itemId: item.id });
  saveState();
}
function setStatus(id, status) {
  const item = state.items.find(x => x.id === id);
  if (!item || !STATUSES.includes(status) || item.status === status) return;
  const previous = item.status;
  item.status = status;
  item.updatedAt = nowIso();
  item.updatedBy = currentName();
  item.updatedByUserId = currentEmployeeId();
  recordHistory("status_changed", `${formatSku(item.sku)} : ${STATUS_LABELS[previous]} → ${STATUS_LABELS[status]}`, { itemId: item.id, pickupListId: activePickupListId || "", details: { previous, status, stockLocation: item.stockLocation } });
  saveState();
}
function nextStatus(current) { return STATUSES[(STATUSES.indexOf(current) + 1) % STATUSES.length]; }
function deleteItems(ids) {
  const idSet = new Set(ids);
  for (const item of state.items.filter(x => idSet.has(x.id))) recordHistory("item_deleted", `Article ${formatSku(item.sku)} supprimé`, { itemId: item.id });
  state.items = state.items.filter(x => !idSet.has(x.id));
  state.deletedIds = [...new Set([...(state.deletedIds || []), ...ids])];
  for (const list of state.pickupLists) list.itemIds = (list.itemIds || []).filter(id => !idSet.has(id));
  selectedIds.clear();
  saveState();
}
function addNamedEntry(form) {
  if (!roleAtLeast("supervisor")) return toast("Permission insuffisante");
  const name = String(new FormData(form).get("name") || "").trim().replace(/\s+/g, " ");
  if (!name) return;
  const target = form.id === "listForm" ? state.lists : state.departments;
  if (target.some(x => normalizeName(x.name) === normalizeName(name))) return toast("Cet élément existe déjà");
  target.push(makeNamedEntry(name));
  saveState();
  render();
  toast("Ajout enregistré");
}
function applyBulkEdit(form) {
  const data = new FormData(form);
  const selected = state.items.filter(item => selectedIds.has(item.id));
  if (!selected.length) return;
  const newAssignments = [...new Set(data.getAll("assignedEmployeeIds").map(String))].filter(id => employeeById(id));
  const applyAssignments = canManageAssignments() && Boolean(data.get("applyAssignments"));
  const applyForklift = Boolean(data.get("applyForklift"));
  const newRequiresForklift = Boolean(data.get("requiresForklift"));
  if (applyAssignments) {
    const anyWillRequireLift = selected.some(item => applyForklift ? newRequiresForklift : item.requiresForklift);
    if (anyWillRequireLift && newAssignments.length && !newAssignments.map(employeeById).some(isLiftPermitValid)) return toast("Modification refusée : cette affectation exige au moins un permis de lift valide.");
  }
  const now = nowIso();
  for (const item of selected) {
    const previousAssignments = [...(item.assignedEmployeeIds || [])];
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
    item.updatedBy = currentName();
    item.updatedByUserId = currentEmployeeId();
    if (applyAssignments && JSON.stringify(previousAssignments.sort()) !== JSON.stringify([...newAssignments].sort())) {
      recordHistory("assignment_changed", `${formatSku(item.sku)} attribué à ${newAssignments.map(id => employeeById(id)?.name).filter(Boolean).join(", ") || "personne"}`, { itemId: item.id });
    } else {
      recordHistory("item_updated", `Article ${formatSku(item.sku)} modifié en lot`, { itemId: item.id });
    }
  }
  bulkEditOpen = false;
  saveState();
  render();
  toast(`${selected.length} article${selected.length > 1 ? "s modifiés" : " modifié"}`);
}
function applyAssignments(form) {
  if (!canManageAssignments()) return toast("Seuls les superviseurs et administrateurs peuvent attribuer des articles.");
  const selected = state.items.filter(item => selectedIds.has(item.id));
  if (!selected.length) return toast("Sélectionne au moins un article");
  const data = new FormData(form);
  const employeeIds = [...new Set(data.getAll("assignedEmployeeIds").map(String))].filter(id => employeeById(id));
  if (selected.some(x => x.requiresForklift) && employeeIds.length && !employeeIds.map(employeeById).some(isLiftPermitValid)) return toast("Attribution refusée : au moins un article nécessite un permis de lift valide.");
  for (const item of selected) {
    item.assignedEmployeeIds = employeeIds;
    item.updatedAt = nowIso();
    item.updatedBy = currentName();
    item.updatedByUserId = currentEmployeeId();
    recordHistory("assignment_changed", `${formatSku(item.sku)} attribué à ${employeeIds.map(id => employeeById(id)?.name).filter(Boolean).join(", ") || "personne"}`, { itemId: item.id });
  }
  selectedIds.clear();
  saveState();
  render();
  toast("Attribution mise à jour");
}
function savePickupList(form) {
  const data = new FormData(form);
  const id = String(data.get("pickupListId") || "");
  const existing = id ? pickupById(id) : null;
  if (existing && !canEditPickup(existing)) return toast("Permission insuffisante");
  const name = String(data.get("name") || "").trim();
  const itemIds = [...new Set(data.getAll("pickupItemIds").map(String))].filter(itemId => state.items.some(x => x.id === itemId));
  if (!name) return toast("Donne un nom à la liste");
  if (!itemIds.length) return toast("Sélectionne au moins un article");
  const requestedEmployeeIds = [...new Set(data.getAll("assignedEmployeeIds").map(String))].filter(employeeById);
  const assignedEmployeeIds = canManageAssignments()
    ? requestedEmployeeIds
    : [currentEmployeeId()].filter(id => employeeById(id));
  const items = itemIds.map(itemId => state.items.find(x => x.id === itemId)).filter(Boolean);
  if (items.some(x => x.requiresForklift) && assignedEmployeeIds.length && !assignedEmployeeIds.map(employeeById).some(isLiftPermitValid)) return toast("Cette liste contient un article nécessitant un permis de lift valide.");
  const now = nowIso();
  const list = {
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    name,
    pickupLocation: String(data.get("pickupLocation") || "").trim(),
    itemIds,
    assignedEmployeeIds,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || currentName(),
    createdByUserId: existing?.createdByUserId || currentEmployeeId(),
    updatedAt: now,
    updatedBy: currentName()
  };
  if (existing) Object.assign(existing, list); else state.pickupLists.unshift(list);
  recordHistory(existing ? "pickup_updated" : "pickup_created", `${existing ? "Liste modifiée" : "Liste créée"} : ${list.name}`, { pickupListId: list.id, details: { itemCount: itemIds.length, pickupLocation: list.pickupLocation } });
  pickupEditorOpen = false;
  editingPickupListId = null;
  pickupDraftItemIds = [];
  saveState();
  render();
  toast(existing ? "Liste de ramassage modifiée" : "Liste de ramassage créée");
}
function deletePickupList(id) {
  const list = pickupById(id);
  if (!list || !canEditPickup(list)) return toast("Permission insuffisante");
  if (!confirm(`Supprimer la liste « ${list.name} »?`)) return;
  state.pickupLists = state.pickupLists.filter(x => x.id !== id);
  state.deletedPickupListIds = [...new Set([...(state.deletedPickupListIds || []), id])];
  recordHistory("pickup_deleted", `Liste supprimée : ${list.name}`, { pickupListId: id });
  saveState();
  render();
}
async function exportPickupPdf(id, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Création…";
  try {
    const response = await authFetch("/api/report-pdf", { method: "POST", body: JSON.stringify({ pickupListId: id }) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Création du PDF impossible");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `ramassage-${new Date().toISOString().slice(0, 10)}.pdf`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
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
  } catch { toast("Impossible de lire cette photo"); }
}
async function handleStockPhoto(file) {
  if (!file?.type?.startsWith("image/")) return toast("Choisis une image valide");
  try {
    stockPhotoDraft.dataUrl = await compressImage(file, 1280, .72);
    stockPhotoDraft.remove = false;
    const wrap = document.querySelector("#stockPhotoPreviewWrap");
    const img = document.querySelector("#stockPhotoPreview");
    const remove = document.querySelector("#removeStockPhotoButton");
    if (img) { img.removeAttribute("data-stock-photo-path"); img.src = stockPhotoDraft.dataUrl; }
    if (wrap) wrap.hidden = false;
    if (remove) remove.hidden = false;
    formDirty = true;
    toast("Photo de l’emplacement prête à être téléversée");
  } catch { toast("Impossible de préparer cette photo"); }
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
  if (!authSession?.access_token) return;
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
    } catch (error) { console.warn("Photos d’emplacement", error.message); }
  }
  for (const img of images) {
    const cached = photoUrlCache.get(img.dataset.stockPhotoPath);
    if (!cached) continue;
    img.src = cached.url;
    img.addEventListener("load", () => img.parentElement?.classList.add("loaded"), { once: true });
  }
}
function scheduleAutoSync(delay = AUTOSYNC_DELAY) {
  if (!authSession?.access_token || currentProfile?.approval_status !== "approved") return;
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
  if (!authSession?.access_token) {
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
      mergeDirectoryIntoEmployees();
      state.meta.lastSyncAt = nowIso();
      saveState({ touch: false, sync: false });
      syncMode = realtimeActive ? "realtime" : "cloud";
      if (!formDirty || source === "manual" || source === "auto") render();
      if (broadcast && realtimeActive && realtimeChannel) {
        await realtimeChannel.send({ type: "broadcast", event: "state-changed", payload: { clientId, updatedAt: state.meta.updatedAt } });
      }
      if (!silent) toast("Synchronisation terminée");
      return state;
    } catch (error) {
      syncMode = "error";
      updateSyncIndicator();
      if (!silent) toast(error.message); else console.warn("Synchronisation", error.message);
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
async function initRealtime() {
  if (!authClient || !authSession?.access_token) return;
  try {
    const config = await apiRequest("/api/realtime-config");
    if (!config.enabled) return;
    realtimeChannel = authClient.channel(config.topic, { config: { private: false, broadcast: { self: false } } });
    realtimeChannel.on("broadcast", { event: "state-changed" }, payload => {
      if (payload?.payload?.clientId === clientId) return;
      if (formDirty) {
        remoteUpdatePending = true;
        toast("Une mise à jour cloud est disponible; elle sera appliquée après ce formulaire.");
        return;
      }
      syncNow({ silent: true, broadcast: false, source: "remote" });
    }).subscribe(status => {
      realtimeActive = status === "SUBSCRIBED";
      if (realtimeActive) syncMode = "realtime";
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && state.meta.lastSyncAt) syncMode = "cloud";
      updateSyncIndicator();
    });
  } catch (error) { console.warn("Temps réel indisponible", error.message); }
}
function startCloudServices() {
  if (cloudStarted || !authSession?.access_token || currentProfile?.approval_status !== "approved") return;
  cloudStarted = true;
  initRealtime();
  syncNow({ silent: true, broadcast: false, source: "initial" });
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine && !formDirty) syncNow({ silent: true, broadcast: false, source: "poll" });
  }, POLL_INTERVAL);
  directoryTimer = setInterval(() => refreshUserDirectory({ silent: true }), DIRECTORY_INTERVAL);
}
async function stopCloudServices() {
  clearInterval(pollTimer);
  clearInterval(directoryTimer);
  clearTimeout(autoSyncTimer);
  pollTimer = null;
  directoryTimer = null;
  cloudStarted = false;
  realtimeActive = false;
  if (authClient && realtimeChannel) await authClient.removeChannel(realtimeChannel).catch(() => {});
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
    box.innerHTML = `<strong>Vercel :</strong> opérationnel<br><strong>Analyse photo :</strong> ${data.openaiConfigured ? "configurée" : "clé manquante"}<br><strong>Cloud :</strong> ${data.supabaseConfigured ? "configuré" : "variables manquantes"}<br><strong>Authentification :</strong> ${data.authConfigured ? "configurée" : "clé publique manquante"}<br><strong>Temps réel :</strong> ${data.realtimeConfigured ? "configuré" : "clé publique manquante"}<br><strong>Photos d’emplacement :</strong> ${data.photoStorageConfigured ? "configurées" : "non configurées"}`;
  } catch { box.textContent = "Fonctions Vercel inaccessibles."; }
}
function deleteManaged(type, id) {
  if (!roleAtLeast("supervisor")) return toast("Permission insuffisante");
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
  const headers = ["SKU", "Description", "Liste", "Département", "Quantité", "Priorité", "Statut", "Assigné à", "Lift requis", "Permis valide assigné", "Emplacement tablette", "Lieu du ramassage", "Photo emplacement", "Note", "Mis à jour par", "Date"];
  const rows = state.items.map(item => {
    const employees = assignedEmployees(item);
    return [formatSku(item.sku), item.name, listName(item.listId), departmentName(item.departmentId), item.quantity, PRIORITY_LABELS[item.priority], STATUS_LABELS[item.status], employees.map(x => x.name).join("; "), item.requiresForklift ? "Oui" : "Non", item.requiresForklift ? (employees.some(isLiftPermitValid) ? "Oui" : "Non") : "Sans objet", item.salesLocation, item.stockLocation, item.stockPhotoPath ? "Oui" : "Non", item.note, item.updatedBy, item.updatedAt];
  });
  downloadBlob("\ufeff" + [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n"), "text/csv;charset=utf-8", `remplissage-${new Date().toISOString().slice(0, 10)}.csv`);
}
async function updateUser(action, userId, extra = {}) {
  try {
    await apiRequest("/api/users", { method: "POST", body: { action, userId, ...extra } });
    await refreshUserDirectory({ silent: true });
    render();
    toast(action === "approve" ? "Utilisateur approuvé" : action === "reject" ? "Demande refusée" : "Utilisateur mis à jour");
  } catch (error) { toast(error.message); }
}

els.showLoginTab.addEventListener("click", () => switchAuthTab("login"));
els.showSignupTab.addEventListener("click", () => switchAuthTab("signup"));
els.loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const data = new FormData(event.currentTarget);
  button.disabled = true;
  button.textContent = "Connexion…";
  setAuthMessage("");
  try {
    const { data: result, error } = await authClient.auth.signInWithPassword({ email: String(data.get("email") || "").trim(), password: String(data.get("password") || "") });
    if (error) throw error;
    authSession = result.session;
    await loadCurrentProfile();
  } catch (error) {
    setAuthMessage(error.message || "Connexion impossible", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Connexion";
  }
});
els.signupForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const data = new FormData(event.currentTarget);
  const password = String(data.get("password") || "");
  if (password !== String(data.get("passwordConfirm") || "")) return setAuthMessage("Les mots de passe ne correspondent pas.", "error");
  button.disabled = true;
  button.textContent = "Envoi…";
  setAuthMessage("");
  try {
    const { data: result, error } = await authClient.auth.signUp({
      email: String(data.get("email") || "").trim(),
      password,
      options: { data: { full_name: String(data.get("fullName") || "").trim() } }
    });
    if (error) throw error;
    if (result.session) {
      authSession = result.session;
      await loadCurrentProfile();
    } else {
      setAuthMessage("Demande créée. Confirme ton courriel si Supabase t’a envoyé un message, puis reconnecte-toi. L’accès restera en attente d’approbation.", "success");
      event.currentTarget.reset();
    }
  } catch (error) {
    setAuthMessage(error.message || "Inscription impossible", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Envoyer la demande";
  }
});
els.pendingRefresh.addEventListener("click", async () => {
  els.pendingRefresh.disabled = true;
  try { await loadCurrentProfile(); } catch (error) { toast(error.message); }
  finally { els.pendingRefresh.disabled = false; }
});
els.bootstrapForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const pin = String(new FormData(event.currentTarget).get("pin") || "");
  button.disabled = true;
  try {
    const data = await apiRequest("/api/bootstrap-admin", { method: "POST", body: { pin } });
    currentProfile = data.profile;
    await refreshUserDirectory({ silent: true });
    showApp();
    toast("Premier administrateur créé");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
document.querySelectorAll('[data-auth-action="logout"]').forEach(button => button.addEventListener("click", logout));
els.logoutButton.addEventListener("click", logout);
document.querySelectorAll("[data-nav]").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.nav)));
els.syncButton.addEventListener("click", () => syncNow({ silent: false, broadcast: true, source: "manual" }));

els.appMain.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
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
  if (form.id === "storeForm") {
    if (!isAdmin()) return toast("Permission insuffisante");
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
  if (form.id === "assignmentForm") return applyAssignments(form);
  if (form.id === "pickupListForm") return savePickupList(form);
  if (form.classList.contains("user-edit-form")) {
    const data = new FormData(form);
    return updateUser("update", form.dataset.userId, {
      fullName: data.get("fullName"),
      role: data.get("role"),
      approvalStatus: data.get("approvalStatus"),
      hasLiftPermit: Boolean(data.get("hasLiftPermit")),
      liftPermitNumber: data.get("liftPermitNumber"),
      liftPermitExpiresAt: data.get("liftPermitExpiresAt") || null
    });
  }
});

els.appMain.addEventListener("change", async event => {
  const target = event.target;
  if (["cameraInput", "galleryInput"].includes(target.id) && target.files?.[0]) await handleLabelPhoto(target.files[0]);
  if (["stockCameraInput", "stockGalleryInput"].includes(target.id) && target.files?.[0]) await handleStockPhoto(target.files[0]);
  if (target.matches('[name="sku"]')) {
    target.setCustomValidity("");
    const normalized = normalizeRequiredSku(target.value);
    if (normalized) target.value = normalized;
  }
  if (target.classList.contains("select-item")) {
    if (target.checked) selectedIds.add(target.dataset.id); else selectedIds.delete(target.dataset.id);
    render();
  }
  if (target.id === "selectAllVisible") {
    const visible = filteredItems();
    if (target.checked) visible.forEach(item => selectedIds.add(item.id)); else visible.forEach(item => selectedIds.delete(item.id));
    render();
  }
  const filterMap = { filterList: "listId", filterDepartment: "departmentId", filterEmployee: "employeeId", filterStatus: "status", filterPriority: "priority" };
  if (filterMap[target.id]) { filters[filterMap[target.id]] = target.value; render(); }
  if (target.id === "assignmentFilter") { assignmentFilter = target.value; selectedIds.clear(); render(); }
  if (target.id === "historyFilter") { historyFilter = target.value; render(); }
  if (target.closest("form") && !target.classList.contains("select-item") && !filterMap[target.id]) formDirty = true;
});
els.appMain.addEventListener("input", event => {
  const target = event.target;
  if (target.matches('[name="sku"]')) target.setCustomValidity("");
  if (target.id === "filterSearch") {
    filters.search = target.value;
    clearTimeout(render.searchTimer);
    render.searchTimer = setTimeout(render, 180);
    return;
  }
  if (target.id === "historySearch") {
    historySearch = target.value;
    clearTimeout(render.historyTimer);
    render.historyTimer = setTimeout(render, 180);
    return;
  }
  if (target.closest("form")) formDirty = true;
});

els.appMain.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "go") {
    if (button.dataset.view === "tour") { activePickupListId = null; tourIndex = 0; }
    return setView(button.dataset.view);
  }
  if (action === "logout") return logout();
  if (action === "cancel-edit") { editingId = null; stockPhotoDraft = emptyStockPhotoDraft(); return setView("lists"); }
  if (action === "edit-item") {
    editingId = button.dataset.id;
    const item = state.items.find(x => x.id === editingId);
    stockPhotoDraft = { ...emptyStockPhotoDraft(), existingPath: item?.stockPhotoPath || "" };
    currentView = "manual";
    selectedIds.clear();
    formDirty = false;
    return render();
  }
  if (action === "cycle-status") { setStatus(button.dataset.id, nextStatus(button.dataset.status)); return render(); }
  if (action === "tour-status") {
    setStatus(button.dataset.id, button.dataset.status);
    toast(`Statut : ${STATUS_LABELS[button.dataset.status]}`);
    const remaining = getTourItems();
    if (tourIndex >= remaining.length) tourIndex = Math.max(0, remaining.length - 1);
    return render();
  }
  if (action === "tour-next") return moveTour(1);
  if (action === "tour-prev") return moveTour(-1);
  if (action === "exit-pickup-tour") { activePickupListId = null; tourIndex = 0; return setView("pickups"); }
  if (action === "delete-item") {
    if (!confirm("Supprimer cet article?")) return;
    deleteItems([button.dataset.id]);
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
  if (action === "select-assignment-visible") { assignmentItems().forEach(item => selectedIds.add(item.id)); return render(); }
  if (action === "create-pickup-from-selection") {
    pickupDraftItemIds = [...selectedIds];
    pickupEditorOpen = true;
    editingPickupListId = null;
    selectedIds.clear();
    currentView = "pickups";
    return render();
  }
  if (action === "new-pickup-list") { pickupEditorOpen = true; editingPickupListId = null; pickupDraftItemIds = []; return render(); }
  if (action === "close-pickup-editor") { pickupEditorOpen = false; editingPickupListId = null; pickupDraftItemIds = []; return render(); }
  if (action === "edit-pickup") { pickupEditorOpen = true; editingPickupListId = button.dataset.id; return render(); }
  if (action === "delete-pickup") return deletePickupList(button.dataset.id);
  if (action === "start-pickup") { activePickupListId = button.dataset.id; tourIndex = 0; return setView("tour"); }
  if (action === "export-pickup-pdf") return exportPickupPdf(button.dataset.id, button);
  if (action === "delete-list") return deleteManaged("list", button.dataset.id);
  if (action === "delete-department") return deleteManaged("department", button.dataset.id);
  if (action === "clear-photo") { scanDraft = emptyScanDraft(); return render(); }
  if (action === "analyze-photo") return analyzePhoto(button);
  if (action === "remove-stock-photo") {
    stockPhotoDraft.dataUrl = null;
    stockPhotoDraft.remove = true;
    const wrap = document.querySelector("#stockPhotoPreviewWrap");
    if (wrap) wrap.hidden = true;
    button.hidden = true;
    formDirty = true;
    return;
  }
  if (action === "approve-user") {
    const card = button.closest(".user-card");
    const role = card?.querySelector('[name="approvalRole"]')?.value || "employee";
    return updateUser("approve", button.dataset.id, { role });
  }
  if (action === "reject-user") {
    if (!confirm("Refuser cette demande d’accès?")) return;
    return updateUser("reject", button.dataset.id);
  }
  if (action === "refresh-users") { await refreshUserDirectory({ silent: false }); return render(); }
  if (action === "sync") return syncNow({ silent: false, broadcast: true, source: "manual" });
  if (action === "health") return checkHealth();
  if (action === "export-json") return exportJSON();
  if (action === "export-csv") return exportCSV();
  if (action === "import-json") return els.importInput.click();
});

const TOUR_SWIPE_IGNORE_SELECTOR = 'button, a, input, select, textarea, label, summary, details, [contenteditable="true"]';
els.appMain.addEventListener("touchstart", event => {
  if (currentView !== "tour" || event.touches.length !== 1) return;
  if (!event.target.closest(".tour-card") || event.target.closest(TOUR_SWIPE_IGNORE_SELECTOR)) return;
  const touch = event.touches[0];
  tourSwipeStart = { x: touch.clientX, y: touch.clientY, startedAt: Date.now() };
}, { passive: true });
els.appMain.addEventListener("touchcancel", () => { tourSwipeStart = null; }, { passive: true });
els.appMain.addEventListener("touchend", event => {
  if (!tourSwipeStart || currentView !== "tour" || !event.changedTouches.length) { tourSwipeStart = null; return; }
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - tourSwipeStart.x;
  const deltaY = touch.clientY - tourSwipeStart.y;
  const duration = Date.now() - tourSwipeStart.startedAt;
  tourSwipeStart = null;
  const horizontalEnough = Math.abs(deltaX) >= TOUR_SWIPE_MIN_DISTANCE;
  const mainlyHorizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
  if (!horizontalEnough || !mainlyHorizontal || duration > TOUR_SWIPE_MAX_DURATION) return;
  moveTour(deltaX < 0 ? 1 : -1, { fromSwipe: true });
}, { passive: true });

els.importInput.addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (imported?.version !== 1 || !Array.isArray(imported.items)) throw new Error("Format invalide");
    state = sanitizeState(imported);
    mergeDirectoryIntoEmployees();
    saveState();
    render();
    toast("Sauvegarde importée et envoyée au cloud");
  } catch (error) { toast(error.message); }
  event.target.value = "";
});
window.addEventListener("online", () => {
  syncMode = state.meta.lastSyncAt ? (realtimeActive ? "realtime" : "cloud") : "local";
  updateSyncIndicator();
  scheduleAutoSync(100);
});
window.addEventListener("offline", () => { syncMode = "offline"; updateSyncIndicator(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && navigator.onLine && authSession?.access_token && !formDirty) {
    syncNow({ silent: true, broadcast: false, source: "visible" });
    refreshUserDirectory({ silent: true });
  }
});

async function boot() {
  try {
    await initAuthClient();
    if (authSession) await loadCurrentProfile(); else showAuthForms();
  } catch (error) {
    showAuthForms();
    setAuthMessage(error.message || "Initialisation impossible", "error");
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
boot();
