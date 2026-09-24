declare const Deno: {
  env: { get(key: string): string | undefined };
};

/**
 * Browser-facing CORS for the edge functions.
 *
 * Origins are echoed back only when they appear in the allowlist — arbitrary
 * origins are never reflected, and a disallowed origin simply gets no
 * `Access-Control-Allow-Origin` header, which the browser treats as a block.
 *
 * Override per environment without a code change:
 *   npx supabase secrets set ALLOWED_ORIGINS="https://commandcenter.bmspros.com.au,https://staging.example"
 */
const DEFAULT_ALLOWED_ORIGINS = [
  "https://commandcenter.bmspros.com.au",
  "http://localhost:8080",
];

const ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
].join(", ");

const DEFAULT_METHODS = "POST, OPTIONS";

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  if (!raw?.trim()) return DEFAULT_ALLOWED_ORIGINS;
  return raw.split(",").map(stripTrailingSlash).filter(Boolean);
}

/** The allowlisted origin for this request, or `null` when it is not permitted. */
export function resolveAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin");
  if (!origin) return null;
  return allowedOrigins().includes(stripTrailingSlash(origin)) ? origin : null;
}

/** CORS headers that do not depend on the caller's origin. */
export function baseCorsHeaders(
  methods: string = DEFAULT_METHODS,
): Record<string, string> {
  return {
    Vary: "Origin",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

export function corsHeadersFor(
  req: Request,
  methods: string = DEFAULT_METHODS,
): Record<string, string> {
  const headers = baseCorsHeaders(methods);
  const origin = resolveAllowedOrigin(req);
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** 204 preflight reply carrying only the negotiated CORS headers. */
export function preflightResponse(req: Request, methods?: string): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeadersFor(req, methods),
  });
}

/**
 * Wrap a handler so preflights are answered and every response carries the
 * negotiated origin. Lets a function keep its existing response-building code
 * while the origin decision stays in one place.
 */
export function serveWithCors(
  handler: (req: Request) => Response | Promise<Response>,
  methods: string = DEFAULT_METHODS,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return preflightResponse(req, methods);

    const res = await handler(req);
    const origin = resolveAllowedOrigin(req);
    if (!origin) return res;

    try {
      res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set("Vary", "Origin");
      return res;
    } catch {
      // Immutable headers (e.g. a piped upstream response) — rebuild instead.
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }
  };
}
