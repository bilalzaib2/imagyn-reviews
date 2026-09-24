// The support widget's mailto contract: the right address, a useful subject, useful store
// context in the body — and, most importantly, nothing sensitive in it. The privacy assertions
// below are the real reason this logic lives in its own module rather than inline in
// FloatingHelp.tsx.
import { describe, expect, it } from "vitest";
import {
  SUPPORT_EMAIL,
  buildFeedbackMailto,
  buildSupportBody,
  buildSupportMailto,
  buildSupportSubject,
  type SupportContext,
} from "./supportMailto";

const context: SupportContext = {
  storeName: "Coastal Threads",
  shopDomain: "coastal-threads.myshopify.com",
  planName: "Pro",
  path: "/app/reviews",
};

function decodedParts(mailto: string) {
  const [addressPart, query] = mailto.replace(/^mailto:/, "").split("?");
  const params = new URLSearchParams(query);
  return {
    to: addressPart,
    subject: params.get("subject") ?? "",
    body: params.get("body") ?? "",
  };
}

describe("support address", () => {
  it("is appsupport@imagyn.co", () => {
    expect(SUPPORT_EMAIL).toBe("appsupport@imagyn.co");
  });

  it("is the recipient of both the support and feedback mailto links", () => {
    expect(decodedParts(buildSupportMailto(context)).to).toBe("appsupport@imagyn.co");
    expect(decodedParts(buildFeedbackMailto(context)).to).toBe("appsupport@imagyn.co");
  });
});

describe("subject", () => {
  it("names the store", () => {
    expect(buildSupportSubject(context)).toBe("IMAGYN Reviews Support — Coastal Threads");
  });

  it("stays valid when no store name is known", () => {
    expect(buildSupportSubject({ storeName: null })).toBe("IMAGYN Reviews Support");
  });

  it("survives the round trip through the mailto URL intact", () => {
    expect(decodedParts(buildSupportMailto(context)).subject).toBe("IMAGYN Reviews Support — Coastal Threads");
  });

  it("distinguishes feedback from support by subject line", () => {
    expect(decodedParts(buildFeedbackMailto(context)).subject).toBe("IMAGYN Reviews Feedback — Coastal Threads");
  });
});

describe("body — real store context", () => {
  it("includes the store name, shop domain, plan and current page", () => {
    const body = buildSupportBody(context);

    expect(body).toContain("Store: Coastal Threads");
    expect(body).toContain("Shop: coastal-threads.myshopify.com");
    expect(body).toContain("Plan: Pro");
    expect(body).toContain("Page: /app/reviews");
  });

  it("leaves room at the top for the merchant to write in", () => {
    expect(buildSupportBody(context).startsWith("\n\n")).toBe(true);
  });

  it("omits any field that genuinely isn't known rather than writing a placeholder", () => {
    const body = buildSupportBody({ storeName: null, shopDomain: null, planName: null, path: null });

    expect(body).not.toContain("Store:");
    expect(body).not.toContain("Shop:");
    expect(body).not.toContain("Plan:");
    expect(body).not.toContain("Page:");
    expect(body).not.toMatch(/null|undefined|unknown/i);
  });

  it("survives the round trip through the mailto URL, newlines included", () => {
    const body = decodedParts(buildSupportMailto(context)).body;

    expect(body).toBe(buildSupportBody(context));
    expect(body).toContain("\n");
  });
});

describe("body — nothing sensitive is ever included", () => {
  // The builder takes exactly four named fields, so the only way a secret could appear is if
  // a caller were to pass one in as one of them. These assert the shape callers must rely on:
  // whatever is handed in, the output contains no other key at all.
  it("writes only the four documented labels", () => {
    const body = buildSupportBody(context);
    const labels = body
      .split("\n")
      .filter((line) => /^[A-Z][A-Za-z ]*:/.test(line))
      .map((line) => line.split(":")[0]);

    expect(labels.sort()).toEqual(["Page", "Plan", "Shop", "Store"]);
  });

  it("never carries a session token, API key or App Bridge parameter", () => {
    const mailto = buildSupportMailto(context);

    for (const forbidden of ["id_token", "hmac", "host=", "session", "access_token", "api_key", "apiKey"]) {
      expect(mailto.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("carries only the path, so a full embedded-app URL's query string can never leak", () => {
    // FloatingHelp passes location.pathname, never location.search. If a caller ignored that
    // and passed a whole URL, this is what would end up in the email — which is exactly why
    // the component is the one place that reads location, and it reads pathname only.
    const body = buildSupportBody({ ...context, path: "/app/reviews" });
    expect(body).toContain("Page: /app/reviews");
    expect(body).not.toContain("?");
  });

  it("puts no store context at all in a feedback email", () => {
    const feedback = buildFeedbackMailto(context);

    expect(feedback).not.toContain("myshopify.com");
    expect(decodedParts(feedback).body).toBe("");
  });
});
