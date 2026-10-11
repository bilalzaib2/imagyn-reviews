import { describe, expect, it, vi } from "vitest";

// Typed with its real payload so the assertions below can read call arguments — an
// inferred zero-arg mock makes `mock.calls[0]` an empty tuple.
interface SentEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}

const sendEmail = vi.fn(async (payload: SentEmail) => ({ id: `fake-${payload.to}` }));

vi.mock("./provider.server", () => ({
  getEmailProvider: () => ({ name: "fake", sendEmail }),
}));

import { sendTestReviewRequestEmail } from "./testEmail.server";
import { getDefaultEmailTemplateContent } from "../email.shared";

describe("sendTestReviewRequestEmail", () => {
  it("sends with fromName set to the store's real name, matching a real customer send", async () => {
    await sendTestReviewRequestEmail("merchant@example.com", "store_1", "Coastal Threads");

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "merchant@example.com",
        fromName: "Coastal Threads",
      }),
    );
  });

  it("prefixes the subject with [Test] so a test is never mistaken for a real customer send", async () => {
    // Behaviour change: the pre-existing Settings → Request Scheduling test send now carries
    // this prefix too. Deliberate — these land in shared support inboxes.
    await sendTestReviewRequestEmail("merchant@example.com", "store_1", "Coastal Threads");

    const sent = sendEmail.mock.calls.at(-1)![0];
    expect(sent.subject.startsWith("[Test] ")).toBe(true);
  });

  it("sends the supplied draft rather than the saved template, so a merchant tests what's on screen", async () => {
    await sendTestReviewRequestEmail("merchant@example.com", "store_1", "Coastal Threads", {
      draft: { ...getDefaultEmailTemplateContent(), subject: "DRAFT_ONLY_SUBJECT" },
    });

    const sent = sendEmail.mock.calls.at(-1)![0];
    expect(sent.subject).toBe("[Test] DRAFT_ONLY_SUBJECT");
  });

  it("renders the requested template type, not always the review request", async () => {
    await sendTestReviewRequestEmail("merchant@example.com", "store_1", "Coastal Threads", {
      type: "reminder_final",
      draft: getDefaultEmailTemplateContent("reminder_final"),
    });

    // The subject is variable-substituted before sending, so this asserts the rendered form
    // (with {{product_name}} resolved) rather than the raw template string.
    const sent = sendEmail.mock.calls.at(-1)![0];
    const expected = getDefaultEmailTemplateContent("reminder_final").subject.replace("{{product_name}}", "Sample Product");
    expect(sent.subject).toBe(`[Test] ${expected}`);
    expect(sent.subject).not.toBe("[Test] " + getDefaultEmailTemplateContent().subject);
  });

  it("substitutes a sample discount code for a reward test, never leaving a raw token", async () => {
    await sendTestReviewRequestEmail("merchant@example.com", "store_1", "Coastal Threads", {
      type: "reward",
      draft: getDefaultEmailTemplateContent("reward"),
    });

    const sent = sendEmail.mock.calls.at(-1)![0];
    expect(sent.html).toContain("SAMPLE-CODE");
    expect(sent.html).not.toMatch(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/);
  });
});
