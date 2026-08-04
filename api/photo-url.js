import { getAuthContext, json, sendError } from "../lib/auth.js";
import { getSupabaseAdmin } from "../lib/supabase-admin.js";

const BUCKET = "stock-location-photos";
const EXPIRES_IN = 3600;

function validPath(path) {
  return typeof path === "string" && path.startsWith("locations/") && !path.includes("..") && path.length <= 300;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try { await getAuthContext(request); } catch (error) { return sendError(response, error); }

  try {
    const paths = [...new Set(Array.isArray(request.body?.paths) ? request.body.paths : [])]
      .filter(validPath)
      .slice(0, 30);
    if (!paths.length) return json(response, 200, { urls: {} });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, EXPIRES_IN);
    if (error) throw error;

    const urls = {};
    for (const row of data || []) {
      if (row?.path && row?.signedUrl) urls[row.path] = row.signedUrl;
    }
    return json(response, 200, { urls, expiresIn: EXPIRES_IN });
  } catch (error) {
    console.error("photo-url", error);
    return json(response, 500, { error: error.message || "Impossible d’ouvrir la photo" });
  }
}
