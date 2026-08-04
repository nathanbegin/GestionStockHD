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
function mergeSnapshots(local, cloud) {
  if (!cloud) return local;
  const deleted = new Set([...(cloud.deletedIds || []), ...(local.deletedIds || [])]);
  const items = mergeById(local.items, cloud.items).filter(x => !deleted.has(x.id));
  return {
    version: 1,
    lists: mergeById(local.lists, cloud.lists),
    departments: mergeById(local.departments, cloud.departments),
    items,
    deletedIds: [...deleted],
    settings: latest({ ...cloud.settings, updatedAt: cloud.meta?.updatedAt }, { ...local.settings, updatedAt: local.meta?.updatedAt }),
    meta: { updatedAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() }
  };
}
async function supabase(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || `Erreur Supabase ${response.status}`);
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
