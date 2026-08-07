const PRESENCE_PREFIX = "presence:";
const NOTIFICATION_PREFIX = "notification:";
const NOTIFICATION_BASELINE_PREFIX = "notification-baseline:";
const PUSH_SUBSCRIPTION_PREFIX = "push-subscription:";

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanSharedSnapshot(snapshot, userId) {
  const now = new Date().toISOString();
  return {
    ...snapshot,
    employees: (Array.isArray(snapshot?.employees) ? snapshot.employees : [])
      .filter(employee => employee?.id !== userId),
    items: (Array.isArray(snapshot?.items) ? snapshot.items : []).map(item => ({
      ...item,
      assignedEmployeeIds: [...new Set((Array.isArray(item?.assignedEmployeeIds) ? item.assignedEmployeeIds : [])
        .filter(id => id !== userId))]
    })),
    pickupLists: (Array.isArray(snapshot?.pickupLists) ? snapshot.pickupLists : []).map(list => ({
      ...list,
      assignedEmployeeIds: [...new Set((Array.isArray(list?.assignedEmployeeIds) ? list.assignedEmployeeIds : [])
        .filter(id => id !== userId))]
    })),
    deletedEmployeeIds: [...new Set([
      ...(Array.isArray(snapshot?.deletedEmployeeIds) ? snapshot.deletedEmployeeIds : []),
      userId
    ])],
    meta: {
      ...(snapshot?.meta || {}),
      updatedAt: now,
      lastSyncAt: now
    }
  };
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
    throw requestError("Il faut conserver au moins un administrateur approuvé", 409);
  }
}

async function cleanupSharedState(supabase, userId) {
  const { data, error } = await supabase
    .from("app_state")
    .select("snapshot")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  if (!data?.snapshot) return;

  const snapshot = cleanSharedSnapshot(data.snapshot, userId);
  const { error: updateError } = await supabase
    .from("app_state")
    .update({ snapshot, updated_at: new Date().toISOString() })
    .eq("id", "default");
  if (updateError) throw updateError;
}

export async function deleteUserAccount(supabase, {
  actorUserId,
  target,
  targetAuthUser,
  targetRoles = []
}) {
  const userId = String(target?.id || targetAuthUser?.id || "");
  if (!userId) throw requestError("Utilisateur introuvable", 404);
  if (userId === actorUserId) {
    throw requestError("Tu ne peux pas supprimer le compte actuellement connecté", 409);
  }

  if (target?.approval_status === "approved" && targetRoles.includes("admin")) {
    await ensureAnotherApprovedAdmin(supabase, userId);
  }

  const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteAuthError) throw deleteAuthError;

  const cleanupLabels = [
    "profil",
    "présence",
    "notifications",
    "suivi des notifications",
    "abonnements Web Push",
    "données partagées"
  ];
  const cleanupResults = await Promise.allSettled([
    supabase.from("profiles").delete().eq("id", userId),
    supabase.from("app_state").delete().like("id", `${PRESENCE_PREFIX}${userId}:%`),
    supabase.from("app_state").delete().like("id", `${NOTIFICATION_PREFIX}${userId}:%`),
    supabase.from("app_state").delete().eq("id", `${NOTIFICATION_BASELINE_PREFIX}${userId}`),
    supabase.from("app_state").delete().like("id", `${PUSH_SUBSCRIPTION_PREFIX}${userId}:%`),
    cleanupSharedState(supabase, userId)
  ]);

  const cleanupWarnings = cleanupResults
    .map((result, index) => {
      if (result.status === "rejected") return cleanupLabels[index];
      if (result.value?.error) return cleanupLabels[index];
      return null;
    })
    .filter(Boolean);

  if (cleanupWarnings.length) {
    console.warn("Compte supprimé avec nettoyage partiel", { userId, cleanupWarnings });
  }

  return {
    deleted: true,
    userId,
    email: target?.email || targetAuthUser?.email || "",
    fullName: target?.full_name || targetAuthUser?.user_metadata?.full_name || "Utilisateur",
    cleanupComplete: cleanupWarnings.length === 0,
    cleanupWarnings
  };
}
