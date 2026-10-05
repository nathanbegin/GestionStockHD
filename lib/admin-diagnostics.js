import crypto from 'node:crypto';
import { getAuthContext, json, sendError } from './auth.js';

export default async function adminDiagnostics(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Méthode non permise' });
  try {
    const { supabase, user } = await getAuthContext(request, { minimumRole: 'admin' });
    const started = Date.now();
    const probe = async (name, run) => {
      const start = Date.now();
      try {
        const result = await run();
        if (result?.error) return { name, ok: false, latencyMs: Date.now() - start, code: result.error.code || 'SERVICE_ERROR' };
        return { name, ok: true, latencyMs: Date.now() - start, data: result };
      } catch { return { name, ok: false, latencyMs: Date.now() - start, code: 'CONNECTION_FAILED' }; }
    };
    const probes = await Promise.all([
      probe('database', () => supabase.from('app_state').select('snapshot').eq('id', 'default').maybeSingle()),
      probe('profiles', () => supabase.from('profiles').select('id,role,approval_status')),
      probe('storage', () => supabase.storage.getBucket('stock-location-photos')),
      probe('databaseMetrics', () => supabase.rpc('admin_console_metrics')),
      probe('openai', async () => {
        if (!process.env.OPENAI_API_KEY) return { error: { code: 'NOT_CONFIGURED' } };
        const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(8000) });
        await r.arrayBuffer();
        return r.ok ? { httpStatus: r.status } : { error: { code: `HTTP_${r.status}` } };
      })
    ]);
    const database = probes.find(p => p.name === 'database');
    const snapshot = database?.data?.data?.snapshot || {};
    const profiles = probes.find(p => p.name === 'profiles')?.data?.data || [];
    const counts = Object.fromEntries(['items','lists','departments','employees','pickupLists','history','deletedIds'].map(key => [key, Array.isArray(snapshot[key]) ? snapshot[key].length : 0]));
    counts.itemsWithLabelPhoto = (snapshot.items || []).filter(x => x.photo).length;
    counts.itemsWithStoragePhoto = (snapshot.items || []).filter(x => x.stockPhotoPath).length;
    counts.profiles = profiles.length;
    counts.pendingAccounts = profiles.filter(p => p.approval_status === 'pending').length;
    if (!database?.ok) for (const key of Object.keys(counts)) if (!['profiles', 'pendingAccounts'].includes(key)) counts[key] = null;
    if (!probes.find(p => p.name === 'profiles')?.ok) { counts.profiles = null; counts.pendingAccounts = null; }
    const url = new URL(process.env.SUPABASE_URL);
    const ref = url.hostname.endsWith('.supabase.co') ? url.hostname.split('.')[0] : null;
    const bytes = value => Number(value) > 0 ? Number(value) : null;
    const bucket = probes.find(p => p.name === 'storage')?.data?.data;
    const metrics = probes.find(p => p.name === 'databaseMetrics')?.data?.data || null;
    // Return summaries only. Snapshots, API keys, auth tokens and user records stay on the server.
    return json(response, 200, {
      requestId: crypto.randomUUID(), time: new Date().toISOString(), durationMs: Date.now() - started,
      services: probes.map(({ data, ...p }) => p), counts,
      snapshotBytes: database?.ok ? Buffer.byteLength(JSON.stringify(snapshot)) : null,
      databaseMetrics: metrics,
      storage: bucket ? { id: bucket.id, public: bucket.public, fileSizeLimit: bucket.file_size_limit, allowedMimeTypes: bucket.allowed_mime_types } : null,
      quotas: { databaseBytes: bytes(process.env.ADMIN_DATABASE_QUOTA_BYTES), storageBytes: bytes(process.env.ADMIN_STORAGE_QUOTA_BYTES), source: 'Limites configurées pour ce projet, pas des quotas facturés automatiquement.' },
      identifiers: { projectRef: ref, supabaseHost: url.hostname, snapshotId: 'default', bucketId: 'stock-location-photos', administratorId: user.id, deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null, commit: process.env.VERCEL_GIT_COMMIT_SHA || null, region: process.env.VERCEL_REGION || null, environment: process.env.VERCEL_ENV || 'local' },
      runtime: { node: process.version, processUptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage() },
      configuration: { visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-5-nano', screenModel: process.env.OPENAI_HD_SCREEN_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-5-nano', realtime: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY), push: Boolean(process.env.VAPID_PRIVATE_KEY), apiKey: Boolean(process.env.OPENAI_API_KEY) },
      dashboards: ref ? { supabase: `https://supabase.com/dashboard/project/${ref}`, usage: `https://supabase.com/dashboard/project/${ref}/settings/billing/usage` } : {}
    });
  } catch (error) { return sendError(response, error, 'Diagnostics indisponibles'); }
}
