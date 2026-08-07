import { randomUUID } from "node:crypto";
import { roleAtLeast } from "./auth.js";
import { sendWebPushNotifications } from "./web-push.js";

const EVENT_PREFIX = "event:";
const NOTIFICATION_PREFIX = "notification:";
const MAX_EVENTS = 500;

function cleanText(value, maxLength = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanLongText(value, maxLength = 1500) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, maxLength);
}

function cleanIds(values, max = 250) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || "").trim())
    .filter(Boolean))].slice(0, max);
}

function validDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function validTime(value, required = false) {
  const text = String(value || "").trim();
  if (!text && !required) return "";
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

function eventIdFromRow(row) {
  return String(row?.snapshot?.id || row?.id || "").replace(/^event:/, "");
}

function eventRowId(eventId) {
  return `${EVENT_PREFIX}${String(eventId || "").replace(/[^a-zA-Z0-9._-]/g, "-")}`;
}

function normalizeSnapshot(snapshot = {}, row = {}) {
  const id = cleanText(snapshot.id || eventIdFromRow(row), 100);
  if (!id) return null;
  return {
    id,
    title: cleanText(snapshot.title, 120) || "Événement",
    date: validDate(snapshot.date),
    startTime: validTime(snapshot.start_time || snapshot.startTime, true),
    endTime: validTime(snapshot.end_time || snapshot.endTime),
    location: cleanText(snapshot.location, 160),
    description: cleanLongText(snapshot.description, 1500),
    pickupListIds: cleanIds(snapshot.pickup_list_ids || snapshot.pickupListIds),
    participantIds: cleanIds(snapshot.participant_ids || snapshot.participantIds),
    cancelled: Boolean(snapshot.cancelled),
    createdByUserId: cleanText(snapshot.created_by_user_id || snapshot.createdByUserId, 100),
    createdByName: cleanText(snapshot.created_by_name || snapshot.createdByName, 100) || "Système",
    createdAt: snapshot.created_at || snapshot.createdAt || row.updated_at || new Date().toISOString(),
    updatedByUserId: cleanText(snapshot.updated_by_user_id || snapshot.updatedByUserId, 100),
    updatedByName: cleanText(snapshot.updated_by_name || snapshot.updatedByName, 100) || "Système",
    updatedAt: snapshot.updated_at || snapshot.updatedAt || row.updated_at || new Date().toISOString()
  };
}

function eventSnapshot(input, existing, actor) {
  const title = cleanText(input?.title, 120);
  const date = validDate(input?.date);
  const startTime = validTime(input?.startTime, true);
  const endTime = validTime(input?.endTime);
  if (!title) throw Object.assign(new Error("Le titre de l’événement est requis"), { status: 400 });
  if (!date) throw Object.assign(new Error("La date de l’événement est invalide"), { status: 400 });
  if (!startTime) throw Object.assign(new Error("L’heure de début est invalide"), { status: 400 });
  if (endTime && endTime <= startTime) throw Object.assign(new Error("L’heure de fin doit être après l’heure de début"), { status: 400 });

  const now = new Date().toISOString();
  const id = existing?.id || randomUUID();
  return {
    id,
    title,
    date,
    start_time: startTime,
    end_time: endTime,
    location: cleanText(input?.location, 160),
    description: cleanLongText(input?.description, 1500),
    pickup_list_ids: cleanIds(input?.pickupListIds),
    participant_ids: cleanIds(input?.participantIds),
    cancelled: Boolean(input?.cancelled),
    created_by_user_id: existing?.createdByUserId || actor.userId,
    created_by_name: existing?.createdByName || actor.name,
    created_at: existing?.createdAt || now,
    updated_by_user_id: actor.userId,
    updated_by_name: actor.name,
    updated_at: now
  };
}

function publicEvent(event, profiles) {
  return {
    ...event,
    participants: event.participantIds.map(id => {
      const profile = profiles.get(id);
      return { id, name: profile?.full_name || "Utilisateur", role: profile?.role || "employee" };
    })
  };
}

async function approvedProfiles(supabase) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role,approval_status")
    .eq("approval_status", "approved")
    .order("full_name", { ascending: true });
  if (error) throw error;
  return new Map((data || []).map(profile => [String(profile.id), profile]));
}

async function readEventRow(supabase, eventId) {
  const { data, error } = await supabase
    .from("app_state")
    .select("id,snapshot,updated_at")
    .eq("id", eventRowId(eventId))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function eventMessageDate(event) {
  return [event.date, event.startTime].filter(Boolean).join(" à ");
}

function safeNotificationPart(value, maxLength = 100) {
  return cleanText(value, maxLength).replace(/[^a-zA-Z0-9._-]/g, "-") || "event";
}

function eventNotificationRow(userId, type, event, actor, title, message, version = Date.now()) {
  const now = new Date().toISOString();
  return {
    id: `${NOTIFICATION_PREFIX}${safeNotificationPart(userId)}:${safeNotificationPart(type, 40)}:${safeNotificationPart(event.id)}:${safeNotificationPart(version, 40)}`,
    snapshot: {
      user_id: userId,
      type,
      title: cleanText(title, 100),
      message: cleanText(message, 300),
      entity_id: event.id,
      item_id: "",
      pickup_list_id: "",
      actor_user_id: actor.userId,
      actor_name: actor.name || "Système",
      created_at: now,
      read_at: null,
      details: {
        eventId: event.id,
        title: event.title,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location
      }
    },
    updated_at: now
  };
}

async function notifyEventUsers(supabase, userIds, type, event, actor, title, message) {
  const ids = cleanIds(userIds).filter(Boolean);
  if (!ids.length) return { created: 0, push: { sent: 0, failed: 0, subscriptions: 0 } };
  const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = ids.map(userId => eventNotificationRow(userId, type, event, actor, title, message, version));
  const { error } = await supabase.from("app_state").insert(rows);
  if (error) throw error;
  let push = { sent: 0, failed: 0, subscriptions: 0 };
  try {
    push = await sendWebPushNotifications(supabase, rows);
  } catch (error) {
    console.warn("Web Push événement indisponible", error?.message || error);
  }
  return { created: rows.length, push };
}

function actorFrom(profile, user) {
  return {
    userId: String(user.id),
    name: cleanText(profile.full_name || user.email || "Utilisateur", 100)
  };
}

function manager(profile) {
  return roleAtLeast(profile.roles || profile.role, "supervisor");
}

export async function listEvents(supabase, profile, user) {
  const { data, error } = await supabase
    .from("app_state")
    .select("id,snapshot,updated_at")
    .like("id", `${EVENT_PREFIX}%`)
    .order("updated_at", { ascending: false })
    .limit(MAX_EVENTS);
  if (error) throw error;

  const profiles = await approvedProfiles(supabase);
  const events = (data || [])
    .map(row => normalizeSnapshot(row.snapshot, row))
    .filter(event => event?.date && event?.startTime)
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
    .map(event => publicEvent(event, profiles));

  return {
    events,
    currentUser: {
      id: user.id,
      name: profile.full_name || user.email || "Utilisateur",
      role: profile.role || "employee",
      roles: profile.roles || [profile.role || "employee"]
    },
    canManage: manager(profile),
    users: manager(profile)
      ? [...profiles.values()].map(entry => ({ id: entry.id, name: entry.full_name || "Utilisateur", role: entry.role || "employee" }))
      : []
  };
}

export async function createEvent(supabase, profile, user, input) {
  if (!manager(profile)) throw Object.assign(new Error("Permission insuffisante"), { status: 403 });
  const actor = actorFrom(profile, user);
  const profiles = await approvedProfiles(supabase);
  const participantIds = cleanIds(input?.participantIds).filter(id => profiles.has(id));
  const snapshot = eventSnapshot({ ...input, participantIds }, null, actor);
  const now = snapshot.updated_at;
  const { error } = await supabase.from("app_state").insert({ id: eventRowId(snapshot.id), snapshot, updated_at: now });
  if (error) throw error;
  const event = normalizeSnapshot(snapshot, { updated_at: now });
  if (participantIds.length) {
    await notifyEventUsers(
      supabase,
      participantIds,
      "event_registration",
      event,
      actor,
      "Participation à un événement",
      `Tu participes à « ${event.title} » le ${eventMessageDate(event)}.`
    );
  }
  const participantSet = new Set(participantIds);
  const availableTo = [...profiles.keys()].filter(profileId => profileId !== actor.userId && !participantSet.has(profileId));
  if (availableTo.length) {
    await notifyEventUsers(
      supabase,
      availableTo,
      "event_available",
      event,
      actor,
      "Nouvel événement disponible",
      `« ${event.title} » est prévu le ${eventMessageDate(event)}${event.location ? ` · ${event.location}` : ""}.`
    );
  }
  return { event: publicEvent(event, profiles) };
}

export async function updateEvent(supabase, profile, user, eventId, input) {
  if (!manager(profile)) throw Object.assign(new Error("Permission insuffisante"), { status: 403 });
  const row = await readEventRow(supabase, eventId);
  if (!row) throw Object.assign(new Error("Événement introuvable"), { status: 404 });
  const existing = normalizeSnapshot(row.snapshot, row);
  const actor = actorFrom(profile, user);
  const profiles = await approvedProfiles(supabase);
  const participantIds = cleanIds(input?.participantIds).filter(id => profiles.has(id));
  const snapshot = eventSnapshot({ ...input, participantIds }, existing, actor);
  const { error } = await supabase
    .from("app_state")
    .update({ snapshot, updated_at: snapshot.updated_at })
    .eq("id", row.id);
  if (error) throw error;

  const event = normalizeSnapshot(snapshot, { updated_at: snapshot.updated_at });
  const before = new Set(existing.participantIds);
  const after = new Set(event.participantIds);
  const added = [...after].filter(id => !before.has(id));
  const existingParticipants = [...after].filter(id => before.has(id));
  const importantChanged = ["title", "date", "startTime", "endTime", "location", "description"].some(key => existing[key] !== event[key]) ||
    JSON.stringify(existing.pickupListIds) !== JSON.stringify(event.pickupListIds);
  const newlyCancelled = !existing.cancelled && event.cancelled;

  if (added.length) {
    await notifyEventUsers(
      supabase,
      added,
      "event_registration",
      event,
      actor,
      "Participation à un événement",
      `Tu participes à « ${event.title} » le ${eventMessageDate(event)}.`
    );
  }
  if (newlyCancelled && existingParticipants.length) {
    await notifyEventUsers(
      supabase,
      existingParticipants,
      "event_cancelled",
      event,
      actor,
      "Événement annulé",
      `« ${event.title} » du ${eventMessageDate(event)} a été annulé.`
    );
  } else if (importantChanged && existingParticipants.length) {
    await notifyEventUsers(
      supabase,
      existingParticipants,
      "event_updated",
      event,
      actor,
      "Événement modifié",
      `Les détails de « ${event.title} » ont été modifiés. Nouvelle date/heure : ${eventMessageDate(event)}.`
    );
  }
  return { event: publicEvent(event, profiles) };
}

export async function deleteEvent(supabase, profile, user, eventId) {
  if (!manager(profile)) throw Object.assign(new Error("Permission insuffisante"), { status: 403 });
  const row = await readEventRow(supabase, eventId);
  if (!row) return { deleted: false };
  const event = normalizeSnapshot(row.snapshot, row);
  const actor = actorFrom(profile, user);
  const { error } = await supabase.from("app_state").delete().eq("id", row.id);
  if (error) throw error;
  if (event.participantIds.length) {
    await notifyEventUsers(
      supabase,
      event.participantIds,
      "event_deleted",
      event,
      actor,
      "Événement supprimé",
      `« ${event.title} » du ${eventMessageDate(event)} a été supprimé.`
    );
  }
  return { deleted: true };
}

async function mutateOwnParticipation(supabase, profile, user, eventId, join) {
  const actor = actorFrom(profile, user);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await readEventRow(supabase, eventId);
    if (!row) throw Object.assign(new Error("Événement introuvable"), { status: 404 });
    const event = normalizeSnapshot(row.snapshot, row);
    if (event.cancelled) throw Object.assign(new Error("Cet événement est annulé"), { status: 400 });
    const participants = new Set(event.participantIds);
    const already = participants.has(user.id);
    if (join) participants.add(user.id); else participants.delete(user.id);
    if (already === join) return { event, changed: false };

    const updatedAt = new Date().toISOString();
    const snapshot = {
      ...(row.snapshot || {}),
      participant_ids: [...participants],
      updated_by_user_id: user.id,
      updated_by_name: actor.name,
      updated_at: updatedAt
    };
    const { data, error } = await supabase
      .from("app_state")
      .update({ snapshot, updated_at: updatedAt })
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) continue;

    const updated = normalizeSnapshot(snapshot, { updated_at: updatedAt });
    if (join) {
      await notifyEventUsers(
        supabase,
        [user.id],
        "event_registration",
        updated,
        actor,
        "Inscription confirmée",
        `Tu participes à « ${updated.title} » le ${eventMessageDate(updated)}.`
      );
    }
    return { event: updated, changed: true };
  }
  throw Object.assign(new Error("L’événement a changé pendant l’inscription. Réessaie."), { status: 409 });
}

export function joinEvent(supabase, profile, user, eventId) {
  return mutateOwnParticipation(supabase, profile, user, eventId, true);
}

export function leaveEvent(supabase, profile, user, eventId) {
  return mutateOwnParticipation(supabase, profile, user, eventId, false);
}

export { EVENT_PREFIX };
