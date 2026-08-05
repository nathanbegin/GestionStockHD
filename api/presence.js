import { getAuthContext, json, roleAtLeast, sendError } from "../lib/auth.js";

const ONLINE_WINDOW_MS = 150000;
const SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 8;
const MAX_USERS_PER_PAGE = 1000;

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

function normalizeSessions(raw, now = Date.now()) {
  const entries = Object.entries(raw && typeof raw === "object" ? raw : {})
    .map(([id, session]) => {
      const sessionId = validSessionId(id);
      const lastSeen = parseDate(session?.last_seen_at);
      if (!sessionId || !lastSeen || now - lastSeen.getTime() > SESSION_RETENTION_MS) return null;
      const started = parseDate(session?.started_at) || lastSeen;
      return [sessionId, {
        started_at: started.toISOString(),
        last_seen_at: lastSeen.toISOString(),
        online: session?.online !== false,
        ended_at: parseDate(session?.ended_at)?.toISOString() || null,
        device: cleanDevice(session?.device)
      }];
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b[1].last_seen_at) - new Date(a[1].last_seen_at))
    .slice(0, MAX_SESSIONS_PER_USER);
  return Object.fromEntries(entries);
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

function presenceForUser(authUser, now = Date.now()) {
  const sessions = normalizeSessions(authUser?.app_metadata?.presence_sessions, now);
  const values = Object.entries(sessions).map(([sessionId, session]) => ({ sessionId, ...session }));
  const activeSessions = values.filter(session =>
    session.online && now - new Date(session.last_seen_at).getTime() <= ONLINE_WINDOW_MS
  );
  const mostRecent = values[0] || null;
  return {
    online: activeSessions.length > 0,
    activeSessions,
    activeSessionCount: activeSessions.length,
    lastSeenAt: mostRecent?.last_seen_at || null,
    lastDevice: mostRecent?.device || null
  };
}

export default async function handler(request, response) {
  try {
    const ctx = await getAuthContext(request);

    if (request.method === "POST") {
      const action = String(request.body?.action || "heartbeat");
      if (!["heartbeat", "offline"].includes(action)) return json(response, 400, { error: "Action inconnue" });

      const sessionId = validSessionId(request.body?.sessionId);
      if (!sessionId) return json(response, 400, { error: "Session de présence invalide" });

      const now = new Date();
      const nowMs = now.getTime();
      const sessions = normalizeSessions(ctx.user.app_metadata?.presence_sessions, nowMs);
      const previous = sessions[sessionId];
      const requestedStart = parseDate(request.body?.startedAt);
      const acceptableStart = requestedStart && requestedStart.getTime() <= nowMs + 300000 && nowMs - requestedStart.getTime() <= SESSION_RETENTION_MS
        ? requestedStart
        : now;

      sessions[sessionId] = {
        started_at: previous?.started_at || acceptableStart.toISOString(),
        last_seen_at: now.toISOString(),
        online: action === "heartbeat",
        ended_at: action === "offline" ? now.toISOString() : null,
        device: cleanDevice(request.body?.device || previous?.device)
      };

      const trimmedSessions = normalizeSessions(sessions, nowMs);
      const { error } = await ctx.supabase.auth.admin.updateUserById(ctx.user.id, {
        app_metadata: {
          ...(ctx.user.app_metadata || {}),
          presence_sessions: trimmedSessions
        }
      });
      if (error) throw error;

      return json(response, 200, {
        ok: true,
        serverTime: now.toISOString(),
        onlineWindowSeconds: Math.round(ONLINE_WINDOW_MS / 1000)
      });
    }

    if (request.method !== "GET") return json(response, 405, { error: "Méthode non permise" });
    if (!roleAtLeast(ctx.profile.roles || ctx.profile.role, "supervisor")) {
      return json(response, 403, { error: "Accès réservé aux superviseurs et administrateurs" });
    }

    const now = Date.now();
    const [{ data: profiles, error: profilesError }, authUsers] = await Promise.all([
      ctx.supabase.from("profiles").select("id,email,full_name,role,approval_status").eq("approval_status", "approved"),
      listAuthUsers(ctx.supabase)
    ]);
    if (profilesError) throw profilesError;

    const authById = new Map(authUsers.map(user => [user.id, user]));
    const users = (profiles || []).map(profile => {
      const authUser = authById.get(profile.id);
      const presence = presenceForUser(authUser, now);
      const roles = Array.isArray(authUser?.app_metadata?.roles) && authUser.app_metadata.roles.length
        ? authUser.app_metadata.roles
        : [profile.role || "employee"];
      return {
        id: profile.id,
        fullName: profile.full_name || "Utilisateur",
        email: profile.email || authUser?.email || "",
        roles,
        lastSignInAt: authUser?.last_sign_in_at || null,
        ...presence
      };
    }).sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return new Date(b.lastSeenAt || b.lastSignInAt || 0) - new Date(a.lastSeenAt || a.lastSignInAt || 0);
    });

    return json(response, 200, {
      serverTime: new Date(now).toISOString(),
      onlineWindowSeconds: Math.round(ONLINE_WINDOW_MS / 1000),
      onlineCount: users.filter(user => user.online).length,
      users
    });
  } catch (error) {
    return sendError(response, error, "Présence des utilisateurs indisponible");
  }
}
