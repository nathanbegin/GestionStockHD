import { json } from "../lib/auth.js";

export default function handler(request, response) {
  if (request.method !== "GET") return json(response, 405, { error: "Méthode non permise" });
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  return json(response, 200, {
    enabled: Boolean(supabaseUrl && publishableKey),
    supabaseUrl,
    publishableKey
  });
}
