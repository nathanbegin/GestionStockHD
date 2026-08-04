import { getSupabaseAdmin } from "./supabase-admin.js";

const ROLE_RANK = { employee: 1, supervisor: 2, admin: 3 };

export class AuthError extends Error {
  constructor(status, message, code = "AUTH_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(response, status, body) {
  response.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

export function bearerToken(request) {
  const value = String(request.headers.authorization || "");
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

export function roleAtLeast(role, minimum) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minimum] || 99);
}

async function ensureProfile(supabase, user) {
  const { data: existing, error: selectError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (selectError) throw selectError;

  let profile = existing;
  if (!profile) {
    const row = {
      id: user.id,
      email: user.email || "",
      full_name: String(user.user_metadata?.full_name || user.email?.split("@")[0] || "Utilisateur").trim(),
      role: "employee",
      approval_status: "pending"
    };
    const { data, error } = await supabase.from("profiles").upsert(row).select("*").single();
    if (error) throw error;
    profile = data;
  }

  const bootstrapEmail = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  if (bootstrapEmail && String(user.email || "").toLowerCase() === bootstrapEmail &&
      (profile.approval_status !== "approved" || profile.role !== "admin")) {
    const { data, error } = await supabase.from("profiles").update({
      approval_status: "approved",
      role: "admin",
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      updated_at: new Date().toISOString()
    }).eq("id", user.id).select("*").single();
    if (error) throw error;
    profile = data;
  }
  return profile;
}

export async function getAuthContext(request, options = {}) {
  const { allowPending = false, minimumRole = null } = options;
  const token = bearerToken(request);
  if (!token) throw new AuthError(401, "Connexion requise", "NO_TOKEN");

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new AuthError(401, "Session invalide ou expirée", "INVALID_TOKEN");

  const user = data.user;
  const profile = await ensureProfile(supabase, user);
  if (!allowPending && profile.approval_status !== "approved") {
    const message = profile.approval_status === "rejected"
      ? "Cette demande d’accès a été refusée"
      : "Cette demande d’accès attend une approbation";
    throw new AuthError(403, message, profile.approval_status === "rejected" ? "REJECTED" : "PENDING_APPROVAL");
  }
  if (minimumRole && !roleAtLeast(profile.role, minimumRole)) {
    throw new AuthError(403, "Permission insuffisante", "FORBIDDEN");
  }
  return { supabase, user, profile, token };
}

export function sendError(response, error, fallback = "Erreur interne") {
  if (error instanceof AuthError) {
    return json(response, error.status, { error: error.message, code: error.code });
  }
  console.error(error);
  return json(response, 500, { error: error?.message || fallback });
}
