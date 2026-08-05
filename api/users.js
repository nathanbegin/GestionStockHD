import { getAuthContext, json, roleAtLeast, sendError } from "../lib/auth.js";

const VALID_ROLES = new Set(["employee", "supervisor", "admin"]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected"]);
const ROLE_RANK = { employee: 1, supervisor: 2, admin: 3 };
const MAX_USERS_PER_PAGE = 1000;

function normalizeRoles(values, fallback = "employee") {
  const source = Array.isArray(values) ? values : [values || fallback];
  const roles = [...new Set(source.map(value => String(value || "").trim()).filter(value => VALID_ROLES.has(value)))];
  return roles.length ? roles : [VALID_ROLES.has(fallback) ? fallback : "employee"];
}

function primaryRole(roles) {
  return normalizeRoles(roles).sort((a, b) => (ROLE_RANK[b] || 0) - (ROLE_RANK[a] || 0))[0] || "employee";
}

function normalizeDepartmentIds(values, allowedIds = null) {
  const ids = [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))];
  return allowedIds ? ids.filter(id => allowedIds.has(id)) : ids;
}

function cleanProfile(row, authUser = null) {
  const roles = normalizeRoles(authUser?.app_metadata?.roles, row.role);
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: primaryRole(roles),
    roles,
    departmentIds: normalizeDepartmentIds(authUser?.app_metadata?.department_ids),
    approvalStatus: row.approval_status,
    hasLiftPermit: Boolean(row.has_lift_permit),
    liftPermitNumber: row.lift_permit_number || "",
    liftPermitExpiresAt: row.lift_permit_expires_at || "",
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    emailConfirmed: Boolean(authUser?.email_confirmed_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listAuthUsers(supabase) {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: MAX_USERS_PER_PAGE });
    if (error) throw error;
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < MAX_USERS_PER_PAGE) break;
  }
  return users;
}

async function authUserById(supabase, userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw error;
  return data?.user || null;
}

async function allowedDepartmentIds(supabase) {
  const { data, error } = await supabase.from("app_state").select("snapshot").eq("id", "default").maybeSingle();
  if (error) throw error;
  return new Set((data?.snapshot?.departments || []).map(entry => String(entry?.id || "")).filter(Boolean));
}

async function ensureAnotherApprovedAdmin(supabase, userId) {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("approval_status", "approved")
    .eq("role", "admin")
    .neq("id", userId);
  if (error) throw error;
  if (Number(count || 0) === 0) {
    throw new Error("Il faut conserver au moins un administrateur approuvé");
  }
}

async function updateAccountMetadata(supabase, authUser, roles, departmentIds) {
  const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
    app_metadata: {
      ...(authUser.app_metadata || {}),
      roles: normalizeRoles(roles),
      department_ids: normalizeDepartmentIds(departmentIds)
    }
  });
  if (error) throw error;
  return data?.user || authUser;
}

function cleanFullName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 320);
}

export default async function handler(request, response) {
  try {
    const ctx = await getAuthContext(request);
    const manager = roleAtLeast(ctx.profile.roles || ctx.profile.role, "supervisor");
    const admin = roleAtLeast(ctx.profile.roles || ctx.profile.role, "admin");

    if (request.method === "GET") {
      let query = ctx.supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (!manager) query = query.eq("approval_status", "approved");
      const [{ data, error }, authUsers] = await Promise.all([query, listAuthUsers(ctx.supabase)]);
      if (error) throw error;
      const authById = new Map(authUsers.map(user => [user.id, user]));
      return json(response, 200, { users: (data || []).map(row => cleanProfile(row, authById.get(row.id))) });
    }

    if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
    if (!manager) return json(response, 403, { error: "Permission insuffisante" });

    const action = String(request.body?.action || "");
    const now = new Date().toISOString();
    const validDepartments = await allowedDepartmentIds(ctx.supabase);

    if (action === "create") {
      if (!admin) return json(response, 403, { error: "Seul un administrateur peut créer un utilisateur" });

      const fullName = cleanFullName(request.body?.fullName);
      const email = cleanEmail(request.body?.email);
      const password = String(request.body?.password || "");
      const roles = normalizeRoles(request.body?.roles, "employee");
      const departmentIds = normalizeDepartmentIds(request.body?.departmentIds, validDepartments);

      if (!fullName) return json(response, 400, { error: "Nom invalide" });
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(response, 400, { error: "Courriel invalide" });
      if (password.length < 8) return json(response, 400, { error: "Le mot de passe temporaire doit contenir au moins 8 caractères" });

      const { data: created, error: createError } = await ctx.supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { roles, department_ids: departmentIds }
      });
      if (createError) throw createError;
      const authUser = created?.user;
      if (!authUser) throw new Error("Supabase n’a pas retourné le compte créé");

      const profileRow = {
        id: authUser.id,
        email,
        full_name: fullName,
        role: primaryRole(roles),
        approval_status: "approved",
        has_lift_permit: Boolean(request.body?.hasLiftPermit),
        lift_permit_number: String(request.body?.liftPermitNumber || "").trim(),
        lift_permit_expires_at: request.body?.liftPermitExpiresAt || null,
        approved_by: ctx.user.id,
        approved_at: now,
        updated_at: now
      };

      const { data: profile, error: profileError } = await ctx.supabase
        .from("profiles")
        .upsert(profileRow)
        .select("*")
        .single();

      if (profileError) {
        await ctx.supabase.auth.admin.deleteUser(authUser.id).catch(() => {});
        throw profileError;
      }

      return json(response, 201, { user: cleanProfile(profile, authUser) });
    }

    const userId = String(request.body?.userId || "");
    if (!userId) return json(response, 400, { error: "Utilisateur manquant" });

    const [{ data: target, error: targetError }, targetAuthUser] = await Promise.all([
      ctx.supabase.from("profiles").select("*").eq("id", userId).single(),
      authUserById(ctx.supabase, userId)
    ]);
    if (targetError) throw targetError;

    const targetRoles = normalizeRoles(targetAuthUser?.app_metadata?.roles, target.role);
    if (targetRoles.includes("admin") && !admin && target.id !== ctx.user.id) {
      return json(response, 403, { error: "Un superviseur ne peut pas modifier un administrateur" });
    }

    const patch = { updated_at: now };
    let roles = targetRoles;
    let departmentIds = normalizeDepartmentIds(targetAuthUser?.app_metadata?.department_ids, validDepartments);

    if (action === "approve") {
      patch.approval_status = "approved";
      patch.approved_by = ctx.user.id;
      patch.approved_at = now;
      roles = admin ? normalizeRoles(request.body?.roles || request.body?.role, "employee") : ["employee"];
      departmentIds = normalizeDepartmentIds(request.body?.departmentIds, validDepartments);
      patch.role = primaryRole(roles);
    } else if (action === "reject") {
      patch.approval_status = "rejected";
      patch.approved_by = ctx.user.id;
      patch.approved_at = now;
    } else if (action === "update") {
      const fullName = cleanFullName(request.body?.fullName || target.full_name);
      if (!fullName) return json(response, 400, { error: "Nom invalide" });
      patch.full_name = fullName;
      patch.has_lift_permit = Boolean(request.body?.hasLiftPermit);
      patch.lift_permit_number = String(request.body?.liftPermitNumber || "").trim();
      patch.lift_permit_expires_at = request.body?.liftPermitExpiresAt || null;
      departmentIds = normalizeDepartmentIds(request.body?.departmentIds, validDepartments);

      if (admin) {
        roles = normalizeRoles(request.body?.roles || request.body?.role || targetRoles, target.role);
        patch.role = primaryRole(roles);
        const status = String(request.body?.approvalStatus || target.approval_status);
        if (VALID_STATUSES.has(status)) patch.approval_status = status;
      }
    } else {
      return json(response, 400, { error: "Action inconnue" });
    }

    const nextStatus = patch.approval_status || target.approval_status;
    if (targetRoles.includes("admin") && (nextStatus !== "approved" || !roles.includes("admin"))) {
      await ensureAnotherApprovedAdmin(ctx.supabase, userId);
    }

    let updatedAuthUser = targetAuthUser;
    if (["approve", "update"].includes(action)) {
      updatedAuthUser = await updateAccountMetadata(ctx.supabase, targetAuthUser, roles, departmentIds);
    }

    const { data, error } = await ctx.supabase.from("profiles").update(patch).eq("id", userId).select("*").single();
    if (error) throw error;
    return json(response, 200, { user: cleanProfile(data, updatedAuthUser) });
  } catch (error) {
    return sendError(response, error, "Gestion des utilisateurs impossible");
  }
}
