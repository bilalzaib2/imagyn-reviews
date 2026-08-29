import { describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn(async () => ({ id: "fake-message-id" }));

vi.mock("./provider.server", () => ({
  getEmailProvider: () => ({ name: "fake", sendEmail }),
}));

import { sendTestReviewRequestEmail } from "./testEmail.server";

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
});
