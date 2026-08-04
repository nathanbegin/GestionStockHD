import { getAuthContext, json, sendError } from "../lib/auth.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return json(response, 405, { error: "Méthode non permise" });
  try {
    const { supabase, profile } = await getAuthContext(request, { allowPending: true });
    const { count } = await supabase.from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "approved")
      .eq("role", "admin");
    return json(response, 200, {
      profile,
      bootstrapAvailable: Number(count || 0) === 0 && Boolean(process.env.APP_PIN)
    });
  } catch (error) {
    return sendError(response, error, "Impossible de charger le profil");
  }
}
