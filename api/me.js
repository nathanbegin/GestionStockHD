import { getAuthContext, json, sendError } from "../lib/auth.js";
import { ensureAssignmentNotifications } from "../lib/notification-baseline.js";
import {
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "../lib/notifications.js";
import {
  getWebPushClientConfig,
  removeAllPushSubscriptions,
  removePushSubscription,
  savePushSubscription
} from "../lib/web-push.js";
import {
  createEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  listEvents,
  updateEvent
} from "../lib/events.js";

export default async function handler(request, response) {
  try {
    const view = String(request.query?.view || "");
    const protectedRequest = ["notifications", "push-config", "events"].includes(view) || request.method === "POST";
    const { supabase, profile, user } = await getAuthContext(request, {
      allowPending: !protectedRequest
    });

    if (request.method === "GET" && view === "notifications") {
      await ensureAssignmentNotifications(supabase, user.id);
      return json(response, 200, await listUserNotifications(supabase, user.id));
    }

    if (request.method === "GET" && view === "push-config") {
      return json(response, 200, await getWebPushClientConfig(supabase, user.id));
    }

    if (request.method === "GET" && view === "events") {
      return json(response, 200, await listEvents(supabase, profile, user));
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
      if (action === "pushSubscribe") {
        const result = await savePushSubscription(
          supabase,
          user.id,
          request.body?.subscription,
          request.body?.device
        );
        return json(response, 200, result);
      }
      if (action === "pushUnsubscribe") {
        const result = await removePushSubscription(supabase, user.id, request.body?.endpoint);
        return json(response, 200, result);
      }
      if (action === "pushUnsubscribeAll") {
        const result = await removeAllPushSubscriptions(supabase, user.id);
        return json(response, 200, result);
      }
      if (action === "eventCreate") {
        return json(response, 200, await createEvent(supabase, profile, user, request.body?.event));
      }
      if (action === "eventUpdate") {
        return json(response, 200, await updateEvent(supabase, profile, user, request.body?.eventId, request.body?.event));
      }
      if (action === "eventDelete") {
        return json(response, 200, await deleteEvent(supabase, profile, user, request.body?.eventId));
      }
      if (action === "eventJoin") {
        return json(response, 200, await joinEvent(supabase, profile, user, request.body?.eventId));
      }
      if (action === "eventLeave") {
        return json(response, 200, await leaveEvent(supabase, profile, user, request.body?.eventId));
      }
      return json(response, 400, { error: "Action inconnue" });
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
    if ([400, 403, 404, 409].includes(Number(error?.status || 0))) {
      return json(response, Number(error.status), { error: error.message });
    }
    return sendError(response, error, "Impossible de charger le profil, les notifications ou les événements");
  }
}
