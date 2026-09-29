// Shared plumbing for the public consumer API (/api/public/v1/*), which powers
// reviews.imagyn.co. Kept in its own module rather than reusing api.reviews.tsx's helpers so
// the two surfaces can never drift into each other: those are App-Proxy-signed and
// store-scoped, these are unauthenticated and cross-store.
//
// This file has no loader/action of its own — flat-routes only treats a module as a route when
// it exports one, so this is a plain shared module that happens to sit in the routes folder
// next to the endpoints that use it.

/** Public data is read-only and already published, so a wildcard origin is correct here — the
 *  consumer site, a preview deploy and anyone reading the API get identical bytes. Nothing
 *  behind this layer is authenticated, so there is no cookie or token for a hostile origin to
 *  ride on. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Cached at the edge for a minute, served stale for an hour while revalidating. Review content
 *  changes rarely and a consumer browsing pages should never wait on the database for content
 *  that was identical thirty seconds ago. */
const CACHE_CONTROL = "public, max-age=60, s-maxage=60, stale-while-revalidate=3600";

export function publicJson(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
      ...CORS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

export function publicError(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}

export function isPreflight(request: Request): boolean {
  return request.method === "OPTIONS";
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** GET-only. Anything else is rejected before a query runs — this layer has no mutations by
 *  design, and saying so explicitly is cheaper than relying on the absence of an action. */
export function assertGet(request: Request): Response | null {
  if (isPreflight(request)) return preflight();
  if (request.method !== "GET") return publicError("Method not allowed.", 405);
  return null;
}

export function readString(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

export function readBool(url: URL, key: string): boolean {
  return url.searchParams.get(key) === "true";
}

export function readInt(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
