import { getAuthContext, json, roleAtLeast, sendError } from "../lib/auth.js";

const VALID_ROLES = new Set(["employee", "supervisor", "admin"]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected"]);

function cleanProfile(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    approvalStatus: row.approval_status,
    hasLiftPermit: Boolean(row.has_lift_permit),
    liftPermitNumber: row.lift_permit_number || "",
    liftPermitExpiresAt: row.lift_permit_expires_at || "",
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export default async function handler(request, response) {
  try {
    const ctx = await getAuthContext(request);
    const manager = roleAtLeast(ctx.profile.role, "supervisor");

    if (request.method === "GET") {
      let query = ctx.supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (!manager) query = query.eq("approval_status", "approved");
      const { data, error } = await query;
      if (error) throw error;
      return json(response, 200, { users: (data || []).map(cleanProfile) });
    }

    if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
    if (!manager) return json(response, 403, { error: "Permission insuffisante" });

    const action = String(request.body?.action || "");
    const userId = String(request.body?.userId || "");
    if (!userId) return json(response, 400, { error: "Utilisateur manquant" });

    const { data: target, error: targetError } = await ctx.supabase.from("profiles").select("*").eq("id", userId).single();
    if (targetError) throw targetError;
    if (target.role === "admin" && ctx.profile.role !== "admin" && target.id !== ctx.user.id) {
      return json(response, 403, { error: "Un superviseur ne peut pas modifier un administrateur" });
    }

    const now = new Date().toISOString();
    const patch = { updated_at: now };

    if (action === "approve") {
      patch.approval_status = "approved";
      patch.approved_by = ctx.user.id;
      patch.approved_at = now;
      const requestedRole = String(request.body?.role || "employee");
      patch.role = ctx.profile.role === "admin" && VALID_ROLES.has(requestedRole) ? requestedRole : "employee";
    } else if (action === "reject") {
      patch.approval_status = "rejected";
      patch.approved_by = ctx.user.id;
      patch.approved_at = now;
    } else if (action === "update") {
      const fullName = String(request.body?.fullName || target.full_name || "").trim().replace(/\s+/g, " ");
      if (!fullName) return json(response, 400, { error: "Nom invalide" });
      patch.full_name = fullName;
      patch.has_lift_permit = Boolean(request.body?.hasLiftPermit);
      patch.lift_permit_number = String(request.body?.liftPermitNumber || "").trim();
      patch.lift_permit_expires_at = request.body?.liftPermitExpiresAt || null;
      if (ctx.profile.role === "admin") {
        const role = String(request.body?.role || target.role);
        const status = String(request.body?.approvalStatus || target.approval_status);
        if (VALID_ROLES.has(role)) patch.role = role;
        if (VALID_STATUSES.has(status)) patch.approval_status = status;
      }
    } else {
      return json(response, 400, { error: "Action inconnue" });
    }

    const { data, error } = await ctx.supabase.from("profiles").update(patch).eq("id", userId).select("*").single();
    if (error) throw error;
    return json(response, 200, { user: cleanProfile(data) });
  } catch (error) {
    return sendError(response, error, "Gestion des utilisateurs impossible");
  }
}
