import webPush from "web-push";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

const VAPID_CONFIG_ID = "web-push-config";
const PUSH_SUBSCRIPTION_PREFIX = "push-subscription:";
const DEFAULT_VAPID_SUBJECT = "https://gestion-stock-hd.vercel.app";
const MAX_SUBSCRIPTIONS_PER_USER = 20;

function cleanText(value, maxLength = 300) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function encryptionKey() {
  const secret = String(
    process.env.WEB_PUSH_STORAGE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
  if (!secret) throw new Error("Secret serveur requis pour protéger la clé Web Push");
  return createHash("sha256")
    .update(`gestion-stock-hd:web-push:v1:${secret}`)
    .digest();
}

function encryptPrivateKey(privateKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(privateKey), "utf8"),
    cipher.final()
  ]);
  return {
    ciphertext: base64url(encrypted),
    iv: base64url(iv),
    tag: base64url(cipher.getAuthTag())
  };
}

function decryptPrivateKey(snapshot) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(String(snapshot.private_key_iv || ""), "base64url")
  );
  decipher.setAuthTag(Buffer.from(String(snapshot.private_key_tag || ""), "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(String(snapshot.private_key_ciphertext || ""), "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function environmentConfig() {
  const publicKey = cleanText(process.env.VAPID_PUBLIC_KEY, 500);
  const privateKey = cleanText(process.env.VAPID_PRIVATE_KEY, 500);
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: cleanText(process.env.VAPID_SUBJECT, 500) || DEFAULT_VAPID_SUBJECT,
    source: "environment"
  };
}

function storedConfig(snapshot) {
  if (!snapshot || Number(snapshot.version || 0) !== 1) return null;
  const publicKey = cleanText(snapshot.public_key, 500);
  const subject = cleanText(snapshot.subject, 500) || DEFAULT_VAPID_SUBJECT;
  if (!publicKey || !snapshot.private_key_ciphertext || !snapshot.private_key_iv || !snapshot.private_key_tag) return null;
  try {
    return {
      publicKey,
      privateKey: decryptPrivateKey(snapshot),
      subject,
      source: "encrypted-app-state"
    };
  } catch {
    return null;
  }
}

function generatedConfigSnapshot() {
  const generated = webPush.generateVAPIDKeys();
  const encrypted = encryptPrivateKey(generated.privateKey);
  return {
    version: 1,
    public_key: generated.publicKey,
    private_key_ciphertext: encrypted.ciphertext,
    private_key_iv: encrypted.iv,
    private_key_tag: encrypted.tag,
    subject: cleanText(process.env.VAPID_SUBJECT, 500) || DEFAULT_VAPID_SUBJECT,
    created_at: new Date().toISOString()
  };
}

async function readStoredConfig(supabase) {
  const { data, error } = await supabase
    .from("app_state")
    .select("snapshot")
    .eq("id", VAPID_CONFIG_ID)
    .maybeSingle();
  if (error) throw error;
  return storedConfig(data?.snapshot);
}

async function createOrRepairStoredConfig(supabase) {
  const snapshot = generatedConfigSnapshot();
  const row = {
    id: VAPID_CONFIG_ID,
    snapshot,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from("app_state").insert(row);
  if (!error) return storedConfig(snapshot);

  if (String(error.code || "") === "23505") {
    const concurrent = await readStoredConfig(supabase);
    if (concurrent) return concurrent;
  }

  const { error: repairError } = await supabase.from("app_state").upsert(row);
  if (repairError) throw repairError;
  return storedConfig(snapshot);
}

export async function ensureWebPushConfig(supabase) {
  const config = environmentConfig() || await readStoredConfig(supabase) || await createOrRepairStoredConfig(supabase);
  if (!config?.publicKey || !config?.privateKey) throw new Error("Configuration Web Push indisponible");
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return config;
}

function endpointHash(endpoint) {
  return createHash("sha256").update(endpoint).digest("base64url").slice(0, 43);
}

function subscriptionRowId(userId, endpoint) {
  return `${PUSH_SUBSCRIPTION_PREFIX}${userId}:${endpointHash(endpoint)}`;
}

function cleanSubscription(raw) {
  const endpoint = String(raw?.endpoint || "").trim().slice(0, 3000);
  const p256dh = String(raw?.keys?.p256dh || "").trim().slice(0, 1000);
  const auth = String(raw?.keys?.auth || "").trim().slice(0, 1000);
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw Object.assign(new Error("Abonnement Web Push invalide"), { status: 400 });
  }
  return {
    endpoint,
    expirationTime: Number.isFinite(Number(raw?.expirationTime)) ? Number(raw.expirationTime) : null,
    keys: { p256dh, auth }
  };
}

function cleanDevice(raw = {}) {
  return {
    platform: cleanText(raw.platform, 50) || "Appareil inconnu",
    browser: cleanText(raw.browser, 50) || "Navigateur inconnu",
    mode: cleanText(raw.mode, 30) || "Navigateur"
  };
}

export async function savePushSubscription(supabase, userId, rawSubscription, device = {}) {
  const config = await ensureWebPushConfig(supabase);
  const subscription = cleanSubscription(rawSubscription);
  const now = new Date().toISOString();
  const id = subscriptionRowId(userId, subscription.endpoint);
  const { error } = await supabase.from("app_state").upsert({
    id,
    snapshot: {
      user_id: userId,
      subscription,
      vapid_public_key: config.publicKey,
      device: cleanDevice(device),
      created_at: now,
      updated_at: now
    },
    updated_at: now
  });
  if (error) throw error;

  const { data: rows, error: listError } = await supabase
    .from("app_state")
    .select("id,updated_at")
    .like("id", `${PUSH_SUBSCRIPTION_PREFIX}${userId}:%`)
    .order("updated_at", { ascending: false });
  if (listError) throw listError;
  const stale = (rows || []).slice(MAX_SUBSCRIPTIONS_PER_USER).map(row => row.id);
  if (stale.length) {
    const { error: cleanupError } = await supabase.from("app_state").delete().in("id", stale);
    if (cleanupError) console.warn("Nettoyage Web Push", cleanupError.message);
  }

  return { subscribed: true, endpoint: subscription.endpoint };
}

export async function removePushSubscription(supabase, userId, endpoint) {
  const cleanEndpoint = String(endpoint || "").trim();
  if (!cleanEndpoint) return { removed: false };
  const { error } = await supabase
    .from("app_state")
    .delete()
    .eq("id", subscriptionRowId(userId, cleanEndpoint));
  if (error) throw error;
  return { removed: true };
}

export async function removeAllPushSubscriptions(supabase, userId) {
  const { error } = await supabase
    .from("app_state")
    .delete()
    .like("id", `${PUSH_SUBSCRIPTION_PREFIX}${userId}:%`);
  if (error) throw error;
  return { removed: true };
}

export async function getWebPushClientConfig(supabase, userId) {
  const config = await ensureWebPushConfig(supabase);
  const { data, error } = await supabase
    .from("app_state")
    .select("snapshot")
    .like("id", `${PUSH_SUBSCRIPTION_PREFIX}${userId}:%`);
  if (error) throw error;
  const subscriptionCount = (data || []).filter(row =>
    String(row?.snapshot?.vapid_public_key || "") === config.publicKey
  ).length;
  return {
    enabled: true,
    publicKey: config.publicKey,
    subscriptionCount,
    generatedAutomatically: config.source === "encrypted-app-state"
  };
}

function notificationPayload(rows) {
  const first = rows[0];
  const snapshot = first?.snapshot || {};
  const multiple = rows.length > 1;
  const destination = multiple
    ? "notifications"
    : snapshot.type === "pickup_assignment" ? "pickups" : "assignments";
  const notificationId = multiple ? "" : first.id;
  const query = new URLSearchParams({ push: destination });
  if (notificationId) query.set("notification", notificationId);
  return {
    title: multiple ? `${rows.length} nouvelles tâches attribuées` : cleanText(snapshot.title, 100) || "Nouvelle tâche attribuée",
    body: multiple ? "Ouvre l’application pour consulter les détails." : cleanText(snapshot.message, 260),
    type: multiple ? "assignment_batch" : cleanText(snapshot.type, 50),
    notificationId,
    notificationIds: rows.map(row => row.id),
    destination,
    url: `/?${query.toString()}`,
    tag: multiple ? `assignment-batch-${Date.now()}` : first.id,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    timestamp: Date.now()
  };
}

async function subscriptionsForUser(supabase, userId, publicKey) {
  const { data, error } = await supabase
    .from("app_state")
    .select("id,snapshot")
    .like("id", `${PUSH_SUBSCRIPTION_PREFIX}${userId}:%`)
    .order("updated_at", { ascending: false })
    .limit(MAX_SUBSCRIPTIONS_PER_USER);
  if (error) throw error;

  const valid = [];
  const staleIds = [];
  for (const row of data || []) {
    const snapshot = row?.snapshot || {};
    if (String(snapshot.user_id || "") !== String(userId) ||
        String(snapshot.vapid_public_key || "") !== String(publicKey)) {
      staleIds.push(row.id);
      continue;
    }
    try {
      valid.push({ rowId: row.id, subscription: cleanSubscription(snapshot.subscription) });
    } catch {
      staleIds.push(row.id);
    }
  }
  if (staleIds.length) {
    const { error: cleanupError } = await supabase.from("app_state").delete().in("id", staleIds);
    if (cleanupError) console.warn("Nettoyage des abonnements Web Push", cleanupError.message);
  }
  return valid;
}

export async function sendWebPushNotifications(supabase, notificationRows = []) {
  if (!notificationRows.length) return { sent: 0, failed: 0, subscriptions: 0 };
  const config = await ensureWebPushConfig(supabase);
  const grouped = new Map();
  for (const row of notificationRows) {
    const userId = String(row?.snapshot?.user_id || "");
    if (!userId) continue;
    if (!grouped.has(userId)) grouped.set(userId, []);
    grouped.get(userId).push(row);
  }

  let sent = 0;
  let failed = 0;
  let subscriptionCount = 0;
  for (const [userId, rows] of grouped.entries()) {
    const subscriptions = await subscriptionsForUser(supabase, userId, config.publicKey);
    subscriptionCount += subscriptions.length;
    if (!subscriptions.length) continue;
    const payload = JSON.stringify(notificationPayload(rows));

    for (const entry of subscriptions) {
      try {
        await webPush.sendNotification(entry.subscription, payload, {
          TTL: 60 * 60 * 12,
          urgency: "high"
        });
        sent += 1;
      } catch (error) {
        const statusCode = Number(error?.statusCode || error?.status || 0);
        if ([404, 410].includes(statusCode)) {
          await supabase.from("app_state").delete().eq("id", entry.rowId).catch(() => {});
        } else {
          failed += 1;
          console.warn("Envoi Web Push impossible", { statusCode, message: error?.message });
        }
      }
    }
  }

  return { sent, failed, subscriptions: subscriptionCount };
}

export {
  PUSH_SUBSCRIPTION_PREFIX,
  VAPID_CONFIG_ID
};
