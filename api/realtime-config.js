import crypto from "node:crypto";
import { isAuthorized, json } from "../lib/auth.js";

export default function handler(request, response) {
  if (request.method !== "GET") return json(response, 405, { error: "Méthode non permise" });
  if (!isAuthorized(request)) return json(response, 401, { error: "PIN invalide" });

  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url || !publishableKey) {
    return json(response, 200, { enabled: false });
  }

  const pin = String(process.env.APP_PIN || "");
  const topicHash = crypto.createHash("sha256").update(`${pin}:${url}`).digest("hex").slice(0, 24);
  return json(response, 200, {
    enabled: true,
    supabaseUrl: url,
    publishableKey,
    topic: `restock-${topicHash}`
  });
}
