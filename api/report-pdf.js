import { getAuthContext, json, sendError } from "../lib/auth.js";
import { createPickupReport } from "../lib/report-pdf.js";

function filenamePart(value) {
  return String(value || "ramassage").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "ramassage";
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try {
    const { supabase, profile } = await getAuthContext(request);
    const pickupListId = String(request.body?.pickupListId || "");
    const { data, error } = await supabase.from("app_state").select("snapshot").eq("id", "default").single();
    if (error) throw error;
    const snapshot = data?.snapshot || {};
    const pickup = (snapshot.pickupLists || []).find(x => x.id === pickupListId);
    if (!pickup) return json(response, 404, { error: "Liste de ramassage introuvable" });
    const bytes = createPickupReport(snapshot, pickup, profile);
    response.status(200);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${filenamePart(pickup.name)}.pdf"`);
    response.setHeader("Cache-Control", "no-store");
    response.end(bytes);
  } catch (error) {
    return sendError(response, error, "Création du PDF impossible");
  }
}
