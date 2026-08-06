import { createAssignmentNotifications } from "./notifications.js";

const BASELINE_PREFIX = "notification-baseline:";

function assignmentIds(entity, userId) {
  const assigned = Array.isArray(entity?.assignedEmployeeIds) ? entity.assignedEmployeeIds.map(String) : [];
  return assigned.includes(String(userId || ""));
}

function currentAssignmentSnapshot(shared, userId) {
  return {
    user_id: userId,
    item_ids: (shared?.items || []).filter(item => item?.id && assignmentIds(item, userId)).map(item => item.id),
    pickup_list_ids: (shared?.pickupLists || []).filter(list => list?.id && assignmentIds(list, userId)).map(list => list.id),
    updated_at: new Date().toISOString()
  };
}

function latestHistory(shared, predicate) {
  return (shared?.history || [])
    .filter(predicate)
    .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))[0] || null;
}

function itemActor(shared, item) {
  const event = latestHistory(shared, entry => entry?.type === "assignment_changed" && entry?.itemId === item.id);
  return {
    actorUserId: String(event?.actorUserId || item?.updatedByUserId || ""),
    actorName: String(event?.actorName || item?.updatedBy || "Système")
  };
}

function pickupActor(shared, list) {
  const event = latestHistory(shared, entry =>
    entry?.pickupListId === list.id && ["pickup_created", "pickup_updated"].includes(entry?.type)
  );
  return {
    actorUserId: String(event?.actorUserId || list?.updatedByUserId || ""),
    actorName: String(event?.actorName || list?.updatedBy || list?.createdBy || "Système")
  };
}

async function saveBaseline(supabase, userId, snapshot) {
  const { error } = await supabase.from("app_state").upsert({
    id: `${BASELINE_PREFIX}${userId}`,
    snapshot,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

export async function ensureAssignmentNotifications(supabase, userId) {
  const [{ data: sharedRow, error: sharedError }, { data: baselineRow, error: baselineError }] = await Promise.all([
    supabase.from("app_state").select("snapshot").eq("id", "default").maybeSingle(),
    supabase.from("app_state").select("snapshot").eq("id", `${BASELINE_PREFIX}${userId}`).maybeSingle()
  ]);
  if (sharedError) throw sharedError;
  if (baselineError) throw baselineError;

  const shared = sharedRow?.snapshot || null;
  if (!shared) return { initialized: false, created: 0 };

  const nextBaseline = currentAssignmentSnapshot(shared, userId);
  const previous = baselineRow?.snapshot;
  if (!previous || String(previous.user_id || "") !== String(userId)) {
    await saveBaseline(supabase, userId, nextBaseline);
    return { initialized: true, created: 0 };
  }

  const previousItems = new Set(Array.isArray(previous.item_ids) ? previous.item_ids : []);
  const previousPickups = new Set(Array.isArray(previous.pickup_list_ids) ? previous.pickup_list_ids : []);
  let created = 0;

  for (const item of shared.items || []) {
    if (!item?.id || previousItems.has(item.id) || !assignmentIds(item, userId)) continue;
    const actor = itemActor(shared, item);
    const result = await createAssignmentNotifications(supabase, {
      before: { items: [], pickupLists: [] },
      after: { items: [item], pickupLists: [], departments: shared.departments || [] },
      approvedUserIds: [userId],
      ...actor
    });
    created += Number(result?.created || 0);
  }

  for (const list of shared.pickupLists || []) {
    if (!list?.id || previousPickups.has(list.id) || !assignmentIds(list, userId)) continue;
    const actor = pickupActor(shared, list);
    const result = await createAssignmentNotifications(supabase, {
      before: { items: [], pickupLists: [] },
      after: { items: [], pickupLists: [list], departments: shared.departments || [] },
      approvedUserIds: [userId],
      ...actor
    });
    created += Number(result?.created || 0);
  }

  await saveBaseline(supabase, userId, nextBaseline);
  return { initialized: false, created };
}

export { BASELINE_PREFIX };
