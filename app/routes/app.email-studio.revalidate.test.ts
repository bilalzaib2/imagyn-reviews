import { describe, expect, it } from "vitest";
import { shouldRevalidate } from "./app.email-studio";

// Regression guard for a bug that made the editor feel broken in the real admin: the
// debounced preview POST revalidated the route loader, useLoaderData handed back a fresh
// object, and the draft-reset effect clobbered the merchant's in-progress edits. The visible
// symptoms were the Custom HTML and light/dark toggles snapping back ~400ms after a click,
// and typed text reverting.
//
// Two things prevent it now: the reset effect keys on the template type rather than the
// loader object's identity, and this function stops the pointless revalidation at source.
const args = (intent?: string) => {
  const formData = new FormData();
  if (intent) formData.set("_intent", intent);
  return {
    formData: intent ? formData : undefined,
    defaultShouldRevalidate: true,
  } as unknown as Parameters<typeof shouldRevalidate>[0];
};

describe("shouldRevalidate", () => {
  it("does NOT revalidate after a preview — the submission that caused the clobber", () => {
    expect(shouldRevalidate(args("preview"))).toBe(false);
  });

  it("does not revalidate for the other read-only intents", () => {
    for (const intent of ["upload-logo", "validate-svg", "send-test", "duplicate"]) {
      expect(shouldRevalidate(args(intent))).toBe(false);
    }
  });

  it("DOES revalidate after save and reset, so the editor reflects what was persisted", () => {
    expect(shouldRevalidate(args("save"))).toBe(true);
    expect(shouldRevalidate(args("reset"))).toBe(true);
  });

  it("falls back to the default for ordinary navigations, which carry no intent", () => {
    expect(shouldRevalidate(args())).toBe(true);
  });
});
