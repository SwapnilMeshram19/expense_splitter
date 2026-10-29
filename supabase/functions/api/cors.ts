/**
 * Browsers (the web app) need CORS; the Android app sends no Origin and gets no CORS headers.
 * WEB_ORIGINS is a comma-separated allow-list, e.g. "https://split.ssoftapp.in,http://localhost:5173".
 * CORS is not the security boundary (every request still needs a valid user token); it only stops
 * other sites' pages from reading the responses.
 */
const allowed = new Set(
  (Deno.env.get('WEB_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (!origin || !allowed.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // supabase-js's own list (retries, tracing) plus ours: a header missing here fails the
    // preflight, which the browser reports as a network error.
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, x-client-info, x-retry-count, traceparent, tracestate, baggage, x-sync-origin',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
