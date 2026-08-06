import { authenticate } from "../shopify.server";

// Every /app/* route calls authenticate.admin(request) independently in its own loader
// and/or action (Shopify's own app template pattern). React Router runs all matched
// routes' loaders for a single navigation in parallel, so a document load like /app
// (matching both app.tsx's layout loader and app._index.tsx's loader) fires two
// concurrent authenticate.admin(request) calls carrying the identical incoming session
// token. When the stored offline session is missing or expired, each of those parallel
// calls independently decides "no valid session" and independently exchanges that same
// session token for a fresh offline token with Shopify's token endpoint — confirmed live
// via production logs, which showed duplicate "No valid session found" / "Requesting
// offline access token" entries for one Dashboard load. Neither the SDK's token-exchange
// strategy nor the underlying @shopify/shopify-api tokenExchange() call deduplicates
// concurrent exchanges of the same token, so this is an unguarded race against Shopify's
// token endpoint — a plausible source of the intermittent "already-authenticated merchant
// sees the login screen" reports, since a token endpoint that rejects a second exchange of
// an already-consumed JWT would only affect one of the racing requests, not both.
//
// This wrapper collapses concurrent authenticate.admin calls carrying the same session
// token into a single in-flight authentication, so only one token exchange ever happens
// per navigation, regardless of how many routes in the matched tree call it.
const inFlightAdminAuth = new Map<string, ReturnType<typeof authenticate.admin>>();

function getSessionTokenKey(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  return new URL(request.url).searchParams.get("id_token");
}

export function authenticateAdminDeduped(request: Request): ReturnType<typeof authenticate.admin> {
  const key = getSessionTokenKey(request);
  if (!key) {
    return authenticate.admin(request);
  }

  const inFlight = inFlightAdminAuth.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = authenticate.admin(request).finally(() => {
    inFlightAdminAuth.delete(key);
  });

  inFlightAdminAuth.set(key, promise);
  return promise;
}
