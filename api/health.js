import { json } from "../lib/auth.js";

export default function handler(_request, response) {
  const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  const authConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
  return json(response, 200, {
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    supabaseConfigured,
    authConfigured,
    realtimeConfigured: authConfigured,
    photoStorageConfigured: supabaseConfigured,
    bootstrapConfigured: Boolean(process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.APP_PIN),
    time: new Date().toISOString()
  });
}
