const NOTIFICATION_PREFIX = "notification:";
const MAX_NOTIFICATIONS = 150;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

function cleanText(value, maxLength = 220) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function assignmentIds(entity) {
  return [...new Set((Array.isArray(entity?.assignedEmployeeIds) ? entity.assignedEmployeeIds : [])
    .map(value => String(value || "").trim())
    .filter(Boolean))];
}

function entityVersion(entity, fallback) {
  const date = parseDate(entity?.updatedAt || entity?.createdAt || fallback);
  return date ? date.getTime() : Date.now();
}

function safePart(value, maxLength = 90) {
  return cleanText(value, maxLength).replace(/[^a-zA-Z0-9._-]/g, "-") || "unknown";
}

function notificationRowId(userId, type, entityId, version) {
  return `${NOTIFICATION_PREFIX}${safePart(userId)}:${safePart(type, 40)}:${safePart(entityId)}:${safePart(version, 32)}`;
}

function formatSku(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)}` : cleanText(value, 40);
}

function newAssignmentTargets(previousEntity, nextEntity, approvedIds) {
  const previous = new Set(assignmentIds(previousEntity));
  return assignmentIds(nextEntity).filter(userId => approvedIds.has(userId) && !previous.has(userId));
}

function notificationSnapshot({
  userId,
  type,
  title,
  message,
  entityId,
  itemId = "",
  pickupListId = "",
  actorUserId = "",
  actorName = "Système",
  createdAt,
  details = {}
}) {
  return {
    user_id: userId,
    type,
    title: cleanText(title, 100),
    message: cleanText(message, 300),
    entity_id: cleanText(entityId, 100),
    item_id: cleanText(itemId, 100),
    pickup_list_id: cleanText(pickupListId, 100),
    actor_user_id: cleanText(actorUserId, 100),
    actor_name: cleanText(actorName, 100) || "Système",
    created_at: createdAt,
    read_at: null,
    details: details && typeof details === "object" ? details : {}
  };
}

export async function createAssignmentNotifications(supabase, {
  before,
  after,
  actorUserId = "",
  actorName = "Système",
  approvedUserIds = []
}) {
  if (!before || !after) return { created: 0 };

  const approvedIds = new Set((approvedUserIds || []).map(String));
  if (!approvedIds.size) return { created: 0 };

  const now = new Date().toISOString();
  const departments = new Map((after.departments || []).map(entry => [entry?.id, entry?.name || ""]));
  const previousItems = new Map((before.items || []).filter(item => item?.id).map(item => [item.id, item]));
  const previousPickups = new Map((before.pickupLists || []).filter(list => list?.id).map(list => [list.id, list]));
  const rows = [];

  for (const item of after.items || []) {
    if (!item?.id) continue;
    const version = entityVersion(item, now);
    const sku = formatSku(item.sku);
    const itemName = cleanText(item.name, 120) || "Article";
    const department = cleanText(departments.get(item.departmentId), 80);
    const location = cleanText(item.stockLocation, 120);
    for (const userId of newAssignmentTargets(previousItems.get(item.id), item, approvedIds)) {
      if (userId === actorUserId) continue;
      const rowId = notificationRowId(userId, "item", item.id, version);
      rows.push({
        id: rowId,
        snapshot: notificationSnapshot({
          userId,
          type: "item_assignment",
          title: "Nouvelle tâche attribuée",
          message: [sku || itemName, sku ? itemName : "", department, location ? `À récupérer : ${location}` : ""].filter(Boolean).join(" · "),
          entityId: item.id,
          itemId: item.id,
          actorUserId,
          actorName,
          createdAt: now,
          details: {
            sku,
            itemName,
            department,
            stockLocation: location,
            salesLocation: cleanText(item.salesLocation, 120),
            priority: cleanText(item.priority, 20)
          }
        }),
        updated_at: now
      });
    }
  }

  for (const list of after.pickupLists || []) {
    if (!list?.id) continue;
    const version = entityVersion(list, now);
    const name = cleanText(list.name, 120) || "Liste de ramassage";
    const itemCount = Array.isArray(list.itemIds) ? list.itemIds.length : 0;
    const pickupLocation = cleanText(list.pickupLocation, 120);
    for (const userId of newAssignmentTargets(previousPickups.get(list.id), list, approvedIds)) {
      if (userId === actorUserId) continue;
      const rowId = notificationRowId(userId, "pickup", list.id, version);
      rows.push({
        id: rowId,
        snapshot: notificationSnapshot({
          userId,
          type: "pickup_assignment",
          title: "Nouvelle liste de ramassage",
          message: [name, `${itemCount} article${itemCount === 1 ? "" : "s"}`, pickupLocation ? `Départ : ${pickupLocation}` : ""].filter(Boolean).join(" · "),
          entityId: list.id,
          pickupListId: list.id,
          actorUserId,
          actorName,
          createdAt: now,
          details: { name, itemCount, pickupLocation }
        }),
        updated_at: now
      });
    }
  }

  if (!rows.length) return { created: 0 };
  const { error } = await supabase.from("app_state").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: true
  });
  if (error) throw error;
  return { created: rows.length };
}

function cleanNotificationRow(row, userId) {
  const snapshot = row?.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  if (String(snapshot.user_id || "") !== String(userId || "")) return null;
  const created = parseDate(snapshot.created_at || row?.updated_at);
  if (!created || Date.now() - created.getTime() > RETENTION_MS) return null;
  return {
    id: row.id,
    type: cleanText(snapshot.type, 40),
    title: cleanText(snapshot.title, 100) || "Notification",
    message: cleanText(snapshot.message, 300),
    itemId: cleanText(snapshot.item_id, 100),
    pickupListId: cleanText(snapshot.pickup_list_id, 100),
    actorUserId: cleanText(snapshot.actor_user_id, 100),
    actorName: cleanText(snapshot.actor_name, 100) || "Système",
    createdAt: created.toISOString(),
    readAt: parseDate(snapshot.read_at)?.toISOString() || null,
    details: snapshot.details && typeof snapshot.details === "object" ? snapshot.details : {}
  };
}

export async function listUserNotifications(supabase, userId) {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  const { data, error } = await supabase
    .from("app_state")
    .select("id,snapshot,updated_at")
    .like("id", `${NOTIFICATION_PREFIX}${userId}:%`)
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(MAX_NOTIFICATIONS);
  if (error) throw error;

  const notifications = (data || [])
    .map(row => cleanNotificationRow(row, userId))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    notifications,
    unreadCount: notifications.filter(notification => !notification.readAt).length,
    serverTime: new Date().toISOString()
  };
}

async function notificationRowForUser(supabase, userId, notificationId) {
  const id = String(notificationId || "");
  if (!id.startsWith(`${NOTIFICATION_PREFIX}${userId}:`)) return null;
  const { data, error } = await supabase
    .from("app_state")
    .select("id,snapshot,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function markNotificationRead(supabase, userId, notificationId) {
  const row = await notificationRowForUser(supabase, userId, notificationId);
  if (!row) return { updated: false };
  const snapshot = row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  if (snapshot.read_at) return { updated: false };
  const { error } = await supabase
    .from("app_state")
    .update({ snapshot: { ...snapshot, read_at: new Date().toISOString() } })
    .eq("id", row.id);
  if (error) throw error;
  return { updated: true };
}

export async function markAllNotificationsRead(supabase, userId) {
  const { data, error } = await supabase
    .from("app_state")
    .select("id,snapshot")
    .like("id", `${NOTIFICATION_PREFIX}${userId}:%`);
  if (error) throw error;

  const unread = (data || []).filter(row => !row?.snapshot?.read_at);
  if (!unread.length) return { updated: 0 };
  const readAt = new Date().toISOString();
  const results = await Promise.all(unread.map(row =>
    supabase.from("app_state").update({ snapshot: { ...(row.snapshot || {}), read_at: readAt } }).eq("id", row.id)
  ));
  const failed = results.find(result => result.error);
  if (failed?.error) throw failed.error;
  return { updated: unread.length, readAt };
}

export { NOTIFICATION_PREFIX };
