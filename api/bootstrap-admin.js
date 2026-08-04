import crypto from "node:crypto";
import { getAuthContext, json, sendError } from "../lib/auth.js";

function pinMatches(received) {
  const expected = String(process.env.APP_PIN || "");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(received || ""));
  return Boolean(expected) && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try {
    const { supabase, user } = await getAuthContext(request, { allowPending: true });
    if (!pinMatches(request.body?.pin)) return json(response, 401, { error: "Code d’installation invalide" });

    const { count, error: countError } = await supabase.from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "approved")
      .eq("role", "admin");
    if (countError) throw countError;
    if (Number(count || 0) > 0) return json(response, 409, { error: "Un administrateur existe déjà" });

    const now = new Date().toISOString();
    const { data, error } = await supabase.from("profiles").update({
      role: "admin",
      approval_status: "approved",
      approved_by: user.id,
      approved_at: now,
      updated_at: now
    }).eq("id", user.id).select("*").single();
    if (error) throw error;
    return json(response, 200, { profile: data });
  } catch (error) {
    return sendError(response, error, "Initialisation impossible");
  }
}
