import crypto from "node:crypto";
import { getAuthContext, json, sendError } from "../lib/auth.js";
import { getSupabaseAdmin } from "../lib/supabase-admin.js";

const BUCKET = "stock-location-photos";
const MAX_BYTES = 3 * 1024 * 1024;
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

function validPath(path) {
  return typeof path === "string" && path.startsWith("locations/") && !path.includes("..") && path.length <= 300;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try { await getAuthContext(request); } catch (error) { return sendError(response, error); }

  try {
    const image = String(request.body?.image || "");
    const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(response, 400, { error: "Format d’image invalide" });

    const mime = match[1];
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) {
      return json(response, 413, { error: "La photo dépasse la limite de 3 Mo" });
    }

    const itemId = String(request.body?.itemId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || crypto.randomUUID();
    const extension = MIME_EXT[mime] || "jpg";
    const path = `locations/${itemId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const supabase = getSupabaseAdmin();

    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      cacheControl: "3600",
      upsert: false
    });
    if (error) throw error;

    const oldPath = String(request.body?.oldPath || "");
    if (validPath(oldPath) && oldPath !== path) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPath]);
      if (removeError) console.warn("Ancienne photo non supprimée", removeError.message);
    }

    return json(response, 200, { path });
  } catch (error) {
    console.error("photo-upload", error);
    return json(response, 500, { error: error.message || "Téléversement impossible" });
  }
}
