import crypto from "node:crypto";
import { getAuthContext, json, sendError } from "../lib/auth.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return json(response, 405, { error: "Méthode non permise" });
  try {
    await getAuthContext(request);
    const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
    if (!url || !publishableKey) return json(response, 200, { enabled: false });
    const topicHash = crypto.createHash("sha256").update(`restock:${url}`).digest("hex").slice(0, 24);
    return json(response, 200, { enabled: true, supabaseUrl: url, publishableKey, topic: `restock-${topicHash}` });
  } catch (error) {
    return sendError(response, error, "Temps réel indisponible");
  }
}
