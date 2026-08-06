import { getAuthContext, json, sendError } from "../lib/auth.js";
import { createAssignmentNotifications } from "../lib/notifications.js";

const DEFAULT_DEPARTMENTS_VERSION = 2;
const DEFAULT_DEPARTMENTS = [
  { id: "dept-default-021-022", name: "Matériaux / Lumber", codes: ["021", "022"], aliases: ["Matériaux", "Lumber"] },
  { id: "dept-default-023", name: "Couvre-plancher", codes: ["023"], aliases: [] },
  { id: "dept-default-024", name: "Peinture", codes: ["024"], aliases: [] },
  { id: "dept-default-025", name: "Quincaillerie", codes: ["025"], aliases: [] },
  { id: "dept-default-026", name: "Plomberie", codes: ["026"], aliases: [] },
  { id: "dept-default-027", name: "Électricité", codes: ["027"], aliases: [] },
  { id: "dept-default-028", name: "Saisonnier", codes: ["028"], aliases: ["Jardinage"] },
  { id: "dept-default-029", name: "Cuisine et salle de bain", codes: ["029"], aliases: [] },
  { id: "dept-default-030", name: "Menuiserie", codes: ["030"], aliases: [] },
  { id: "dept-default-031", name: "Services spéciaux", codes: ["031"], aliases: [] },
  { id: "dept-default-070", name: "Électroménagers", codes: ["070"], aliases: [] },
  { id: "dept-default-078", name: "Location d'outils", codes: ["078"], aliases: [] }
];

function latest(a, b) {
  return new Date(a?.updatedAt || a?.createdAt || 0) >= new Date(b?.updatedAt || b?.createdAt || 0) ? a : b;
}
function mergeById(local = [], cloud = []) {
  const map = new Map();
  for (const item of [...cloud, ...local]) {
    if (!item?.id) continue;
    const existing = map.get(item.id);
    map.set(item.id, existing ? latest(item, existing) : item);
  }
  return [...map.values()];
}
function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function dedupeNamed(collection = []) {
  const kept = [];
  const byName = new Map();
  const idMap = new Map();
  for (const raw of collection) {
    const name = String(raw?.name || "").trim().replace(/\s+/g, " ");
    if (!name || !raw?.id) continue;
    const key = normalizeName(name);
    const existing = byName.get(key);
    if (existing) {
      idMap.set(raw.id, existing.id);
      if (new Date(raw.updatedAt || 0) > new Date(existing.updatedAt || 0)) Object.assign(existing, raw, { id: existing.id, name });
      continue;
    }
    const entry = { ...raw, name };
    kept.push(entry);
    byName.set(key, entry);
    idMap.set(entry.id, entry.id);
  }
  return { collection: kept, idMap };
}
function extractSkuDigits(value) {
  const text = String(value || "").replace(/[–—−]/g, "-");
  const match = text.match(/(?:^|\D)((?:1000|1001)(?:[\s-]*\d){6})(?!\d)/);
  if (!match) return "";
  const digits = match[1].replace(/\D/g, "");
  return /^(?:1000|1001)\d{6}$/.test(digits) ? digits : "";
}
function formatSku(value) {
  const digits = extractSkuDigits(value);
  return digits ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}` : String(value || "").trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function applyRoleRestrictions(local, cloud, profile, user) {
  const safe = clone(local);
  const remote = cloud && typeof cloud === "object" ? cloud : {};
  if (profile.role === "admin") return safe;

  if (remote.settings) safe.settings = clone(remote.settings);
  if (profile.role === "supervisor") return safe;

  if (Array.isArray(remote.lists) && remote.lists.length) safe.lists = clone(remote.lists);
  if (Array.isArray(remote.departments) && remote.departments.length) safe.departments = clone(remote.departments);
  safe.deletedListIds = clone(remote.deletedListIds || []);
  safe.deletedDepartmentIds = clone(remote.deletedDepartmentIds || []);
  safe.deletedEmployeeIds = clone(remote.deletedEmployeeIds || []);

  const cloudItems = new Map((remote.items || []).filter(x => x?.id).map(x => [x.id, x]));
  safe.items = (safe.items || []).map(item => {
    const previous = cloudItems.get(item.id);
    return {
      ...item,
      assignedEmployeeIds: clone(previous?.assignedEmployeeIds || [])
    };
  });

  const cloudPickups = (remote.pickupLists || []).filter(x => x?.id);
  const cloudPickupById = new Map(cloudPickups.map(x => [x.id, x]));
  const ownLocal = (safe.pickupLists || [])
    .filter(x => {
      const existing = cloudPickupById.get(x?.id);
      return existing ? existing.createdByUserId === user.id : x?.createdByUserId === user.id;
    })
    .map(x => ({ ...x, createdByUserId: user.id, assignedEmployeeIds: [user.id] }));
  const otherCloud = cloudPickups.filter(x => x.createdByUserId !== user.id);
  const pickupMap = new Map(otherCloud.map(x => [x.id, x]));
  for (const list of ownLocal) pickupMap.set(list.id, list);
  safe.pickupLists = [...pickupMap.values()];
  const ownCloudIds = new Set(cloudPickups.filter(x => x.createdByUserId === user.id).map(x => x.id));
  safe.deletedPickupListIds = [...new Set([
    ...(remote.deletedPickupListIds || []),
    ...((safe.deletedPickupListIds || []).filter(id => ownCloudIds.has(id)))
  ])];
  return safe;
}

function ensureDefaultDepartments(snapshot) {
  const now = new Date().toISOString();
  const departments = (snapshot.departments || []).map(entry => ({ ...entry }));
  const items = (snapshot.items || []).map(item => ({ ...item }));
  const deletedDepartmentIds = new Set(snapshot.deletedDepartmentIds || []);

  for (const definition of DEFAULT_DEPARTMENTS) {
    const acceptedNames = new Set([definition.name, ...definition.aliases].map(normalizeName));
    const matches = departments.filter(entry => acceptedNames.has(normalizeName(entry.name)));
    let target = matches.find(entry => normalizeName(entry.name) === normalizeName(definition.name)) || matches[0];

    if (!target) {
      let id = definition.id;
      if (departments.some(entry => entry.id === id)) id = `${definition.id}-${Date.now().toString(36)}`;
      target = { id, name: definition.name, codes: [...definition.codes], updatedAt: now };
      departments.push(target);
    }

    target.name = definition.name;
    target.codes = [...definition.codes];
    target.updatedAt = now;
    deletedDepartmentIds.delete(target.id);

    for (const duplicate of matches) {
      if (duplicate.id === target.id) continue;
      for (const item of items) {
        if (item.departmentId === duplicate.id) item.departmentId = target.id;
      }
      const duplicateIndex = departments.findIndex(entry => entry.id === duplicate.id);
      if (duplicateIndex >= 0) departments.splice(duplicateIndex, 1);
      deletedDepartmentIds.add(duplicate.id);
    }
  }

  return {
    ...snapshot,
    departments,
    items,
    deletedDepartmentIds: [...deletedDepartmentIds],
    meta: {
      ...(snapshot.meta || {}),
      updatedAt: now,
      lastSyncAt: now,
      departmentDefaultsVersion: DEFAULT_DEPARTMENTS_VERSION
    }
  };
}

function removeInactiveAccountEmployees(snapshot, approvedProfileIds = []) {
  const approvedIds = new Set(approvedProfileIds);
  const staleAccountIds = new Set(
    (snapshot.employees || [])
      .filter(employee => employee?.isAccount && !approvedIds.has(employee.id))
      .map(employee => employee.id)
  );
  if (!staleAccountIds.size) return snapshot;

  const now = new Date().toISOString();
  const employees = (snapshot.employees || []).filter(employee => !staleAccountIds.has(employee.id));
  const validEmployeeIds = new Set(employees.map(employee => employee.id));
  return {
    ...snapshot,
    employees,
    items: (snapshot.items || []).map(item => ({
      ...item,
      assignedEmployeeIds: [...new Set((item.assignedEmployeeIds || []).filter(id => validEmployeeIds.has(id)))]
    })),
    pickupLists: (snapshot.pickupLists || []).map(list => ({
      ...list,
      assignedEmployeeIds: [...new Set((list.assignedEmployeeIds || []).filter(id => validEmployeeIds.has(id)))]
    })),
    deletedEmployeeIds: [...new Set([...(snapshot.deletedEmployeeIds || []), ...staleAccountIds])],
    meta: { ...(snapshot.meta || {}), updatedAt: now, lastSyncAt: now }
  };
}

function mergeSnapshots(local, cloud) {
  const sourceCloud = cloud || {};
  const deletedItems = new Set([...(sourceCloud.deletedIds || []), ...(local.deletedIds || [])]);
  const deletedLists = new Set([...(sourceCloud.deletedListIds || []), ...(local.deletedListIds || [])]);
  const deletedDepartments = new Set([...(sourceCloud.deletedDepartmentIds || []), ...(local.deletedDepartmentIds || [])]);
  const deletedEmployees = new Set([...(sourceCloud.deletedEmployeeIds || []), ...(local.deletedEmployeeIds || [])]);
  const deletedPickupLists = new Set([...(sourceCloud.deletedPickupListIds || []), ...(local.deletedPickupListIds || [])]);

  const lists = dedupeNamed(mergeById(local.lists, sourceCloud.lists).filter(x => !deletedLists.has(x.id)));
  const departments = dedupeNamed(mergeById(local.departments, sourceCloud.departments).filter(x => !deletedDepartments.has(x.id)));
  const employees = dedupeNamed(mergeById(local.employees, sourceCloud.employees).filter(x => !deletedEmployees.has(x.id)));
  const listFallback = lists.collection[0]?.id || "";
  const departmentFallback = departments.collection[0]?.id || "";
  const validEmployeeIds = new Set(employees.collection.map(x => x.id));

  const items = mergeById(local.items, sourceCloud.items)
    .filter(x => !deletedItems.has(x.id))
    .map(item => ({
      ...item,
      sku: formatSku(item.sku),
      listId: lists.idMap.get(item.listId) || listFallback,
      departmentId: departments.idMap.get(item.departmentId) || departmentFallback,
      assignedEmployeeIds: [...new Set((item.assignedEmployeeIds || []).map(id => employees.idMap.get(id) || id).filter(id => validEmployeeIds.has(id)))],
      requiresForklift: Boolean(item.requiresForklift),
      stockPhotoPath: String(item.stockPhotoPath || "")
    }));
  const validItemIds = new Set(items.map(x => x.id));
  const pickupLists = mergeById(local.pickupLists, sourceCloud.pickupLists)
    .filter(x => !deletedPickupLists.has(x.id))
    .map(list => ({
      ...list,
      itemIds: [...new Set((list.itemIds || []).filter(id => validItemIds.has(id)))],
      assignedEmployeeIds: [...new Set((list.assignedEmployeeIds || []).map(id => employees.idMap.get(id) || id).filter(id => validEmployeeIds.has(id)))]
    }));
  const history = mergeById(local.history, sourceCloud.history)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5000);

  const settingsWinner = cloud
    ? latest({ ...(cloud.settings || {}), updatedAt: cloud.meta?.updatedAt }, { ...(local.settings || {}), updatedAt: local.meta?.updatedAt })
    : local.settings;

  return {
    version: 1,
    lists: lists.collection,
    departments: departments.collection,
    employees: employees.collection,
    items,
    pickupLists,
    history,
    deletedIds: [...deletedItems],
    deletedListIds: [...deletedLists],
    deletedDepartmentIds: [...deletedDepartments],
    deletedEmployeeIds: [...deletedEmployees],
    deletedPickupListIds: [...deletedPickupLists],
    settings: {
      storeName: String(settingsWinner?.storeName || "Mon magasin"),
      keepPhotos: Boolean(settingsWinner?.keepPhotos)
    },
    meta: {
      updatedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
      departmentDefaultsVersion: Math.max(
        Number(local.meta?.departmentDefaultsVersion || 0),
        Number(sourceCloud.meta?.departmentDefaultsVersion || 0)
      )
    }
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try {
    const { supabase, profile, user } = await getAuthContext(request);
    const local = request.body?.snapshot;
    if (!local || local.version !== 1 || !Array.isArray(local.items)) return json(response, 400, { error: "Données de synchronisation invalides" });

    const { data: rows, error: readError } = await supabase.from("app_state").select("snapshot").eq("id", "default");
    if (readError) throw readError;
    const cloud = rows?.[0]?.snapshot || null;
    const needsDepartmentMigration = Number(cloud?.meta?.departmentDefaultsVersion || 0) < DEFAULT_DEPARTMENTS_VERSION;
    const restricted = applyRoleRestrictions(local, cloud, profile, user);
    const merged = mergeSnapshots(restricted, cloud);
    const withDefaultDepartments = needsDepartmentMigration ? ensureDefaultDepartments(merged) : merged;

    const { data: approvedProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id")
      .eq("approval_status", "approved");
    if (profilesError) throw profilesError;
    const approvedUserIds = (approvedProfiles || []).map(row => row.id);
    const cleaned = removeInactiveAccountEmployees(withDefaultDepartments, approvedUserIds);

    const { error: writeError } = await supabase.from("app_state").upsert({
      id: "default",
      snapshot: cleaned,
      updated_at: new Date().toISOString()
    });
    if (writeError) throw writeError;

    if (cloud) {
      try {
        await createAssignmentNotifications(supabase, {
          before: cloud,
          after: cleaned,
          actorUserId: user.id,
          actorName: profile.full_name || user.user_metadata?.full_name || user.email || "Système",
          approvedUserIds
        });
      } catch (notificationError) {
        console.warn("Création des notifications d’attribution", notificationError?.message || notificationError);
      }
    }

    return json(response, 200, { snapshot: cleaned });
  } catch (error) {
    return sendError(response, error, "Erreur de synchronisation");
  }
}
