import { getAuthContext, json, sendError } from "../lib/auth.js";
import { getSupabaseAdmin } from "../lib/supabase-admin.js";

const BUCKET = "stock-location-photos";
function validPath(path) {
  return typeof path === "string" && path.startsWith("locations/") && !path.includes("..") && path.length <= 300;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try { await getAuthContext(request); } catch (error) { return sendError(response, error); }

  const path = String(request.body?.path || "");
  if (!validPath(path)) return json(response, 400, { error: "Chemin de photo invalide" });

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw error;
    return json(response, 200, { ok: true });
  } catch (error) {
    console.error("photo-delete", error);
    return json(response, 500, { error: error.message || "Suppression impossible" });
  }
}
