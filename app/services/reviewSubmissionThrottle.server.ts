// Abuse-prevention for the two public, unauthenticated review-submission endpoints
// (api.reviews.tsx's storefront widget, r.$token.tsx's review-link flow) — neither requires a
// Shopify session, so nothing else in this app limits how many times the same visitor can
// submit. A DB-backed counter (not in-memory) is deliberate: Railway can run more than one
// instance of this app, and an in-memory counter would only ever see the traffic that happened
// to land on the same process, silently under-counting real abuse.
import crypto from "node:crypto";
import prisma from "../db.server";

// Generous enough that no real shopper — even one reviewing several items from the same
// order, from the same shared office/campus IP — should ever hit it, while still bounding a
// scripted flood to a small, moderatable number rather than an unlimited one.
const MAX_SUBMISSIONS_PER_WINDOW = 5;
const WINDOW_MINUTES = 15;

// Never store the raw IP — this table only ever needs to answer "how many hits from this
// bucket recently", never who the visitor was.
function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

// Handles the common "client, proxy1, proxy2" x-forwarded-for chain (leftmost is the
// original client) — Railway's edge sits in front of this app the same way most reverse
// proxy setups do. Falls back to null (never fabricated) when nothing is present, e.g. a
// direct request in local dev with no proxy in front of it.
export function extractClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  return realIp?.trim() || null;
}

// Records this submission attempt and reports whether the caller is currently over the
// limit — called once per real submission attempt, before createReview. A request with no
// discoverable IP (extractClientIp returned null) is never throttled: there's no bucket to
// rate-limit against, and silently blocking it would be indistinguishable from a real bug
// rather than real abuse-prevention.
export async function checkAndRecordSubmission(storeId: string, request: Request): Promise<{ allowed: boolean }> {
  const ip = extractClientIp(request);
  if (!ip) {
    return { allowed: true };
  }

  const ipHash = hashIp(ip);
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  const recentCount = await prisma.reviewSubmissionThrottle.count({
    where: { storeId, ipHash, createdAt: { gte: windowStart } },
  });

  if (recentCount >= MAX_SUBMISSIONS_PER_WINDOW) {
    return { allowed: false };
  }

  await prisma.reviewSubmissionThrottle.create({ data: { storeId, ipHash } });
  return { allowed: true };
}
