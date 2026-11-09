// Brand Studio accepts a logo file, not just a URL.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTE = readFileSync("app/routes/app.appearance.tsx", "utf8");

describe("the upload is wired end to end", () => {
  it("handles an upload-logo intent", () => {
    expect(ROUTE).toMatch(/intent === "upload-logo"/);
  });

  it("validates through the shared rules rather than its own", () => {
    expect(ROUTE).toContain("validateRasterLogo");
    expect(ROUTE).not.toMatch(/ALLOWED_LOGO_MIME_TYPES\s*=/);
  });

  it("submits multipart, or the File never arrives", () => {
    expect(ROUTE).toMatch(/encType: "multipart\/form-data"/);
  });

  it("does not persist on upload — the merchant still saves", () => {
    // Matches Email Studio, and keeps "I picked a file" distinct from "I committed to it".
    const action = ROUTE.slice(ROUTE.indexOf('intent === "upload-logo"'));
    const body = action.slice(0, action.indexOf("\n    if (intent"));
    expect(body).not.toMatch(/appearanceService\.(save|update)/);
    expect(body).toMatch(/return \{ ok: true, intent: "upload-logo", url: uploaded\.url \}/);
  });

  it("writes the returned URL into the draft so the preview updates", () => {
    expect(ROUTE).toMatch(/result\.intent === "upload-logo"[\s\S]{0,120}update\("images", \{ logoUrl: result\.url \}\)/);
  });

  it("shows upload errors without clobbering other results", () => {
    expect(ROUTE).toMatch(/const logoFetcher = useFetcher<ActionData>\(\)/);
    expect(ROUTE).toMatch(/logoUploadError/);
  });

  it("keeps the URL field as an alternative", () => {
    expect(ROUTE).toMatch(/label="Logo URL"/);
  });

  it("offers a way to remove a logo", () => {
    expect(ROUTE).toMatch(/update\("images", \{ logoUrl: null \}\)/);
  });
});
