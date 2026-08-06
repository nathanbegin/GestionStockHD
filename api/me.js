import { getAuthContext, json, sendError } from "../lib/auth.js";
import { ensureAssignmentNotifications } from "../lib/notification-baseline.js";
import {
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "../lib/notifications.js";

export default async function handler(request, response) {
  try {
    const view = String(request.query?.view || "");
    const notificationsRequest = view === "notifications" || request.method === "POST";
    const { supabase, profile, user } = await getAuthContext(request, {
      allowPending: !notificationsRequest
    });

    if (request.method === "GET" && view === "notifications") {
      await ensureAssignmentNotifications(supabase, user.id);
      return json(response, 200, await listUserNotifications(supabase, user.id));
    }

    if (request.method === "POST") {
      const action = String(request.body?.action || "");
      if (action === "notificationRead") {
        const result = await markNotificationRead(supabase, user.id, request.body?.notificationId);
        return json(response, 200, result);
      }
      if (action === "notificationReadAll") {
        const result = await markAllNotificationsRead(supabase, user.id);
        return json(response, 200, result);
      }
      return json(response, 400, { error: "Action de notification inconnue" });
    }

    if (request.method !== "GET") return json(response, 405, { error: "Méthode non permise" });

    const { count } = await supabase.from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "approved")
      .eq("role", "admin");
    return json(response, 200, {
      profile,
      bootstrapAvailable: Number(count || 0) === 0 && Boolean(process.env.APP_PIN)
    });
  } catch (error) {
    return sendError(response, error, "Impossible de charger le profil ou les notifications");
  }
}
