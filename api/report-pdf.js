import { getAuthContext, json, sendError } from "../lib/auth.js";
import { createPickupReport } from "../lib/report-pdf.js";

const MAX_BROWSER_CLOCK_DRIFT_MS = 15 * 60 * 1000;
const MAX_UTC_OFFSET_MINUTES = 14 * 60;

function filenamePart(value) {
  return String(value || "ramassage").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "ramassage";
}

function timeZoneOffsetMinutes(date, timeZone) {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const localAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    );
    const offset = Math.round((localAsUtc - date.getTime()) / 60000);
    return Number.isFinite(offset) && Math.abs(offset) <= MAX_UTC_OFFSET_MINUTES ? offset : null;
  } catch {
    return null;
  }
}

function browserLocalGeneratedAt(body) {
  const serverNow = new Date();
  const browserNow = new Date(String(body?.clientGeneratedAt || ""));
  const browserTimeIsValid = !Number.isNaN(browserNow.getTime())
    && Math.abs(browserNow.getTime() - serverNow.getTime()) <= MAX_BROWSER_CLOCK_DRIFT_MS;
  const reference = browserTimeIsValid ? browserNow : serverNow;

  let offsetMinutes = timeZoneOffsetMinutes(reference, String(body?.clientTimeZone || "").trim());
  if (offsetMinutes === null) {
    const suppliedOffset = Number(body?.clientUtcOffsetMinutes);
    if (Number.isInteger(suppliedOffset) && Math.abs(suppliedOffset) <= MAX_UTC_OFFSET_MINUTES) {
      offsetMinutes = suppliedOffset;
    }
  }

  if (offsetMinutes === null) return reference;
  return new Date(reference.getTime() + offsetMinutes * 60 * 1000);
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "Méthode non permise" });
  try {
    const { supabase, profile } = await getAuthContext(request);
    const pickupListId = String(request.body?.pickupListId || "");
    const { data, error } = await supabase.from("app_state").select("snapshot").eq("id", "default").single();
    if (error) throw error;
    const snapshot = data?.snapshot || {};
    const pickup = (snapshot.pickupLists || []).find(x => x.id === pickupListId);
    if (!pickup) return json(response, 404, { error: "Liste de ramassage introuvable" });
    const generatedAt = browserLocalGeneratedAt(request.body);
    const bytes = createPickupReport(snapshot, pickup, profile, generatedAt);
    response.status(200);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${filenamePart(pickup.name)}.pdf"`);
    response.setHeader("Cache-Control", "no-store");
    response.end(bytes);
  } catch (error) {
    return sendError(response, error, "Création du PDF impossible");
  }
}
