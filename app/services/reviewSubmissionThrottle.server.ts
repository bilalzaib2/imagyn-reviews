// Abuse-prevention for the public, unauthenticated storefront endpoints — review submission
// (api.reviews.tsx's widget, r.$token.tsx's review-link flow) and helpful-votes
// (api.reviews.vote.tsx). None requires a Shopify session, so nothing else in this app limits
// how many times the same visitor can act. A DB-backed counter (not in-memory) is deliberate:
// Railway can run more than one instance of this app, and an in-memory counter would only ever
// see the traffic that happened to land on the same process, silently under-counting real abuse.
import crypto from "node:crypto";
import prisma from "../db.server";

// Generous enough that no real shopper — even one reviewing several items from the same
// order, from the same shared office/campus IP — should ever hit it, while still bounding a
// scripted flood to a small, moderatable number rather than an unlimited one.
const MAX_SUBMISSIONS_PER_WINDOW = 5;

// Votes are a fundamentally different volume profile from submissions: one shopper reading a
// product page may legitimately mark a dozen reviews helpful in a single visit, so the
// submission ceiling would reject ordinary browsing. The unique (reviewId, visitorId)
// constraint on ReviewHelpfulVote already makes a single visitor idempotent per review, so
// what this bounds is the one real abuse vector — one IP cycling through fabricated visitorIds
// to move a review's helpfulCount, which rankByHelpfulness turns into storefront ordering.
const MAX_VOTES_PER_WINDOW = 60;

const WINDOW_MINUTES = 15;

/** Separate counting buckets inside the one throttle table. */
export type ThrottleScope = "submission" | "vote";

const LIMIT_BY_SCOPE: Record<ThrottleScope, number> = {
  submission: MAX_SUBMISSIONS_PER_WINDOW,
  vote: MAX_VOTES_PER_WINDOW,
};

// Never store the raw IP — this table only ever needs to answer "how many hits from this
// bucket recently", never who the visitor was.
//
// The scope is mixed into the hash rather than stored as its own column, which keeps votes and
// submissions in genuinely separate buckets (so browsing can never consume a shopper's ability
// to submit a review) without a schema migration. "submission" deliberately hashes the bare IP,
// byte-identical to what this function produced before scopes existed, so every throttle row
// already in the database keeps counting against the right bucket.
function hashIp(ip: string, scope: ThrottleScope): string {
  const material = scope === "submission" ? ip : `${scope}:${ip}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

// RFC1918 / loopback / link-local / unique-local. Used to skip over infrastructure hops when
// walking the X-Forwarded-For chain below.
function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, 100.64.0.0/10
    return false;
  }

  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::") return true;
  // fc00::/7 (unique-local) and fe80::/10 (link-local).
  if (/^f[cd][0-9a-f]{0,2}:/.test(normalized)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(normalized)) return true;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — classify on the embedded IPv4.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  if (mapped) return isPrivateAddress(mapped[1]);
  return false;
}

/**
 * The client IP, read from the X-Forwarded-For chain RIGHT to LEFT.
 *
 * This used to take the LEFTMOST entry, which made the throttle above decorative: a proxy
 * appends the address it received the connection from, so the leftmost entry is whatever the
 * first proxy was *told* — fully attacker-controlled. Any client could send
 * `X-Forwarded-For: <random>` on each request, land in a fresh bucket every time, and never hit
 * a limit.
 *
 * Reading right-to-left instead means each entry was observed by a real proxy rather than
 * claimed by the caller. Rather than assume a fixed number of trusted hops (guess too few and
 * the attacker still controls the bucket; guess too many and every request collapses into one
 * shared bucket, which throttles legitimate shoppers), this walks leftward past private
 * addresses — Railway's own edge/router hops are private, the real client is public — and takes
 * the first public address it finds. That is correct whether there is one infrastructure hop or
 * several, and needs no configuration.
 *
 * Falls back to the rightmost entry when every hop is private (an all-private deployment, or
 * local dev behind a proxy) so there is still a stable bucket, and to null — never a fabricated
 * value — when no header is present at all.
 */
export function extractClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);

    if (hops.length > 0) {
      for (let i = hops.length - 1; i >= 0; i -= 1) {
        if (!isPrivateAddress(hops[i])) {
          return hops[i];
        }
      }
      return hops[hops.length - 1];
    }
  }

  // Set by the proxy itself, not forwarded from the client, so it needs no chain walk.
  const realIp = request.headers.get("x-real-ip");
  return realIp?.trim() || null;
}

// Records this attempt and reports whether the caller is currently over the limit for the given
// scope — called once per real attempt, before the write it guards. A request with no
// discoverable IP (extractClientIp returned null) is never throttled: there's no bucket to
// rate-limit against, and silently blocking it would be indistinguishable from a real bug
// rather than real abuse-prevention.
export async function checkAndRecordSubmission(
  storeId: string,
  request: Request,
  scope: ThrottleScope = "submission",
): Promise<{ allowed: boolean }> {
  const ip = extractClientIp(request);
  if (!ip) {
    return { allowed: true };
  }

  const ipHash = hashIp(ip, scope);
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  const recentCount = await prisma.reviewSubmissionThrottle.count({
    where: { storeId, ipHash, createdAt: { gte: windowStart } },
  });

  if (recentCount >= LIMIT_BY_SCOPE[scope]) {
    return { allowed: false };
  }

  await prisma.reviewSubmissionThrottle.create({ data: { storeId, ipHash } });
  return { allowed: true };
}
