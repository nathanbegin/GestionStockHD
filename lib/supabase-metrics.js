// Process-local cache; serverless instances each collect at most once per minute.
let cached = null;
let pending = null;
const TTL = 60_000;
export function parseMetrics(source) {
  const types = new Map(), help = new Map(), series = [];
  for (const line of source.split('\n')) {
    const meta = line.match(/^# (TYPE|HELP) ([a-zA-Z_:][\w:]*) (.*)$/);
    if (meta) { (meta[1] === 'TYPE' ? types : help).set(meta[2], meta[3]); continue; }
    const match = line.match(/^([a-zA-Z_:][\w:]*)(\{.*\})?\s+([-+\d.eE]+)(?:\s+\d+)?\s*$/);
    if (!match || !Number.isFinite(Number(match[3]))) continue;
    const labels = {};
    for (const m of (match[2] || '').matchAll(/(\w+)="((?:\\.|[^"\\])*)"/g)) {
      labels[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    series.push({ name: match[1], labels, value: Number(match[3]), type: types.get(match[1]) || 'untyped', help: help.get(match[1]) || '' });
  }
  return series;
}
export async function collectSupabaseMetrics() {
  if (cached && Date.now() - cached.collectedAt < TTL) return { ...cached, cached: true };
  if (pending) return pending;
  pending = (async () => {
    const collectedAt = Date.now();
    try {
      const key = process.env.SUPABASE_SECRET_KEY;
      if (!key) throw new Error('NOT_CONFIGURED');
      const url = new URL('/customer/v1/privileged/metrics', process.env.SUPABASE_URL);
      const response = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`username:${key}`).toString('base64')}` }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const body = await response.text();
      const responseBytes = Buffer.byteLength(body);
      const series = parseMetrics(body);
      if (!series.length) throw new Error('EMPTY_METRICS');
      cached = { ok: true, collectedAt, time: new Date(collectedAt).toISOString(), series, responseBytes, cacheSeconds: 60 };
    } catch (error) {
      cached = { ok: false, collectedAt, time: new Date(collectedAt).toISOString(), code: /^(HTTP_\d+|NOT_CONFIGURED|EMPTY_METRICS)$/.test(error.message) ? error.message : 'CONNECTION_FAILED', series: [], cacheSeconds: 60 };
    }
    return { ...cached, cached: false };
  })();
  try { return await pending; } finally { pending = null; }
}
