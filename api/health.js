import { json } from "../lib/auth.js";
export default function handler(_request, response) {
  return json(response, 200, {
    ok: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    time: new Date().toISOString()
  });
}
