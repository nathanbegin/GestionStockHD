import { isAuthorized, json } from "../lib/auth.js";

function latest(a, b) {
  return new Date(a?.updatedAt || 0) >= new Date(b?.updatedAt || 0) ? a : b;
}
function mergeById(local = [], cloud = []) {
  const map = new Map();
  for (const item of [...cloud, ...local]) {
    const existing = map.get(item.id);
    map.set(item.id, existing ? latest(item, existing) : item);
  }
  return [...map.values()];
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
      if (new Date(raw.updatedAt || 0) > new Date(existing.updatedAt || 0)) {
        existing.name = name;
        existing.updatedAt = raw.updatedAt;
      }
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

function mergeSnapshots(local, cloud) {
  const sourceCloud = cloud || { lists: [], departments: [], items: [], deletedIds: [] };
  const deleted = new Set([...(sourceCloud.deletedIds || []), ...(local.deletedIds || [])]);
  const lists = dedupeNamed(mergeById(local.lists, sourceCloud.lists));
  const departments = dedupeNamed(mergeById(local.departments, sourceCloud.departments));
  const listFallback = lists.collection[0]?.id || "";
  const departmentFallback = departments.collection[0]?.id || "";
  const items = mergeById(local.items, sourceCloud.items)
    .filter(x => !deleted.has(x.id))
    .map(item => ({
      ...item,
      sku: formatSku(item.sku),
      listId: lists.idMap.get(item.listId) || listFallback,
      departmentId: departments.idMap.get(item.departmentId) || departmentFallback
    }));
  return {
    version: 1,
    lists: lists.collection,
    departments: departments.collection,
    items,
    deletedIds: [...deleted],
    settings: cloud
      ? latest({ ...cloud.settings, updatedAt: cloud.meta?.updatedAt }, { ...local.settings, updatedAt: local.meta?.updatedAt })
      : local.settings,
    meta: { updatedAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() }
  };
}
async function supabase(path, options = {}) {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SECRET_KEY || "").trim();

  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  // Les nouvelles clés Supabase sb_secret_* sont opaques et ne sont pas des JWT.
  // Le header Authorization Bearer reste nécessaire seulement pour les anciennes
  // clés service_role au format JWT (elles commencent généralement par "eyJ").
  if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${key}`;
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message = body?.message || body?.msg || body?.error_description || body?.error || body;
    throw new Error(typeof message === "string" ? message : `Erreur Supabase ${response.status}`);
  }
  return body;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  if (!isAuthorized(request)) return json(response, 401, { error: "PIN invalide" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return json(response, 503, { error: "Supabase n’est pas configuré" });
  const local = request.body?.snapshot;
  if (!local || local.version !== 1 || !Array.isArray(local.items)) return json(response, 400, { error: "Données de synchronisation invalides" });
  try {
    const rows = await supabase("app_state?id=eq.default&select=snapshot");
    const merged = mergeSnapshots(local, rows?.[0]?.snapshot || null);
    await supabase("app_state", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: "default", snapshot: merged, updated_at: new Date().toISOString() })
    });
    return json(response, 200, { snapshot: merged });
  } catch (error) {
    return json(response, 500, { error: error.message || "Erreur de synchronisation" });
  }
}
