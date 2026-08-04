import { json } from "../lib/auth.js";

export default function handler(_request, response) {
  const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  return json(response, 200, {
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    supabaseConfigured,
    realtimeConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY),
    photoStorageConfigured: supabaseConfigured,
    time: new Date().toISOString()
  });
}
