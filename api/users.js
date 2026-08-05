import { getAuthContext, json, roleAtLeast, sendError } from "../lib/auth.js";

const VALID_ROLES = new Set(["employee", "supervisor", "admin"]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected"]);
const ROLE_RANK = { employee: 1, supervisor: 2, admin: 3 };
const MAX_USERS_PER_PAGE = 1000;
const ONLINE_WINDOW_MS = 150000;
const PRESENCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRESENCE_PREFIX = "presence:";

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

function cleanText(value, maxLength = 80) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validSessionId(value) {
  const id = cleanText(value, 100);
  return /^[a-zA-Z0-9._-]{8,100}$/.test(id) ? id : "";
}

function parseDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanDevice(raw = {}) {
  return {
    platform: cleanText(raw.platform, 40) || "Appareil inconnu",
    browser: cleanText(raw.browser, 40) || "Navigateur inconnu",
    mode: cleanText(raw.mode, 20) || "Navigateur"
  };
}

function presenceRowId(userId, sessionId) {
  return `${PRESENCE_PREFIX}${userId}:${sessionId}`;
}

function cleanPresenceRow(row, now = Date.now()) {
  const snapshot = row?.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  const userId = cleanText(snapshot.user_id, 80);
  const sessionId = validSessionId(snapshot.session_id);
  const lastSeen = parseDate(snapshot.last_seen_at || row?.updated_at);
  if (!userId || !sessionId || !lastSeen || now - lastSeen.getTime() > PRESENCE_RETENTION_MS) return null;
  const started = parseDate(snapshot.started_at) || lastSeen;
  return {
    userId,
    sessionId,
    started_at: started.toISOString(),
    last_seen_at: lastSeen.toISOString(),
    online: snapshot.online !== false,
    ended_at: parseDate(snapshot.ended_at)?.toISOString() || null,
    device: cleanDevice(snapshot.device)
  };
}

async function savePresence(ctx, action) {
  const sessionId = validSessionId(ctx.requestBody?.sessionId);
  if (!sessionId) throw Object.assign(new Error("Session de présence invalide"), { status: 400 });

  const now = new Date();
  const rowId = presenceRowId(ctx.user.id, sessionId);
  const { data: existing, error: existingError } = await ctx.supabase
    .from("app_state")
    .select("snapshot,updated_at")
    .eq("id", rowId)
    .maybeSingle();
  if (existingError) throw existingError;

  const requestedStart = parseDate(ctx.requestBody?.startedAt);
  const existingStart = parseDate(existing?.snapshot?.started_at);
  const acceptableStart = requestedStart &&
    requestedStart.getTime() <= now.getTime() + 300000 &&
    now.getTime() - requestedStart.getTime() <= PRESENCE_RETENTION_MS
    ? requestedStart
    : now;
  const startedAt = existingStart || acceptableStart;

  const snapshot = {
    user_id: ctx.user.id,
    session_id: sessionId,
    started_at: startedAt.toISOString(),
    last_seen_at: now.toISOString(),
    online: action === "presenceHeartbeat",
    ended_at: action === "presenceOffline" ? now.toISOString() : null,
    device: cleanDevice(ctx.requestBody?.device || existing?.snapshot?.device)
  };

  const { error } = await ctx.supabase.from("app_state").upsert({
    id: rowId,
    snapshot,
    updated_at: now.toISOString()
  });
  if (error) throw error;

  return {
    ok: true,
    serverTime: now.toISOString(),
    onlineWindowSeconds: Math.round(ONLINE_WINDOW_MS / 1000)
  };
}

async function presenceDirectory(ctx) {
  if (!roleAtLeast(ctx.profile.roles || ctx.profile.role, "supervisor")) {
    return { status: 403, body: { error: "Accès réservé aux superviseurs et administrateurs" } };
  }

  const cutoff = new Date(Date.now() - PRESENCE_RETENTION_MS).toISOString();
  const [{ data: profiles, error: profilesError }, authUsers, { data: rows, error: rowsError }] = await Promise.all([
    ctx.supabase.from("profiles").select("id,email,full_name,role,approval_status").eq("approval_status", "approved"),
    listAuthUsers(ctx.supabase),
    ctx.supabase.from("app_state")
      .select("id,snapshot,updated_at")
      .like("id", `${PRESENCE_PREFIX}%`)
      .gte("updated_at", cutoff)
  ]);
  if (profilesError) throw profilesError;
  if (rowsError) throw rowsError;

  const now = Date.now();
  const sessionsByUser = new Map();
  for (const row of rows || []) {
    const session = cleanPresenceRow(row, now);
    if (!session) continue;
    if (!sessionsByUser.has(session.userId)) sessionsByUser.set(session.userId, []);
    sessionsByUser.get(session.userId).push(session);
  }
  for (const sessions of sessionsByUser.values()) {
    sessions.sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at));
  }

  const authById = new Map(authUsers.map(user => [user.id, user]));
  const users = (profiles || []).map(profile => {
    const authUser = authById.get(profile.id);
    const sessions = sessionsByUser.get(profile.id) || [];
    const activeSessions = sessions.filter(session =>
      session.online && now - new Date(session.last_seen_at).getTime() <= ONLINE_WINDOW_MS
    );
    const mostRecent = sessions[0] || null;
    const roles = Array.isArray(authUser?.app_metadata?.roles) && authUser.app_metadata.roles.length
      ? authUser.app_metadata.roles
      : [profile.role || "employee"];

    return {
      id: profile.id,
      fullName: profile.full_name || "Utilisateur",
      email: profile.email || authUser?.email || "",
      roles,
      lastSignInAt: authUser?.last_sign_in_at || null,
      online: activeSessions.length > 0,
      activeSessions,
      activeSessionCount: activeSessions.length,
      lastSeenAt: mostRecent?.last_seen_at || null,
      lastDevice: mostRecent?.device || null
    };
  }).sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return new Date(b.lastSeenAt || b.lastSignInAt || 0) - new Date(a.lastSeenAt || a.lastSignInAt || 0);
  });

  return {
    status: 200,
    body: {
      serverTime: new Date(now).toISOString(),
      onlineWindowSeconds: Math.round(ONLINE_WINDOW_MS / 1000),
      onlineCount: users.filter(user => user.online).length,
      users
    }
  };
}

export default async function handler(request, response) {
  try {
    const ctx = await getAuthContext(request);
    ctx.requestBody = request.body || {};
    const manager = roleAtLeast(ctx.profile.roles || ctx.profile.role, "supervisor");
    const admin = roleAtLeast(ctx.profile.roles || ctx.profile.role, "admin");
    const view = String(request.query?.view || "");

    if (request.method === "GET") {
      if (view === "presence") {
        const result = await presenceDirectory(ctx);
        return json(response, result.status, result.body);
      }

      let query = ctx.supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (!manager) query = query.eq("approval_status", "approved");
      const [{ data, error }, authUsers] = await Promise.all([query, listAuthUsers(ctx.supabase)]);
      if (error) throw error;
      const authById = new Map(authUsers.map(user => [user.id, user]));
      return json(response, 200, { users: (data || []).map(row => cleanProfile(row, authById.get(row.id))) });
    }

    if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });

    const action = String(request.body?.action || "");
    if (["presenceHeartbeat", "presenceOffline"].includes(action)) {
      try {
        return json(response, 200, await savePresence(ctx, action));
      } catch (error) {
        if (error?.status === 400) return json(response, 400, { error: error.message });
        throw error;
      }
    }

    if (!manager) return json(response, 403, { error: "Permission insuffisante" });

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
