// What counts as a valid logo, in one place.
//
// Email Studio has accepted uploads for a while. Brand Studio offered only a URL field —
// which asks a merchant to host an image somewhere and find its address, something most of
// them cannot do, and the reason that field sat empty. Both now accept a file, and both
// apply these rules: two screens disagreeing about what a valid logo is would be worse than
// either rule on its own.
import { describe, expect, it } from "vitest";
import {
  ALLOWED_LOGO_MIME_TYPES,
  MAX_LOGO_SIZE_BYTES,
  MAX_SVG_SIZE_BYTES,
  SVG_MIME_TYPE,
  validateRasterLogo,
} from "./logoUpload.shared";

const file = (type: string, size: number) => ({ type, size });

describe("accepts a real logo", () => {
  it.each(ALLOWED_LOGO_MIME_TYPES)("accepts %s", (type) => {
    expect(validateRasterLogo(file(type, 50_000))).toBeNull();
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateRasterLogo(file("image/png", MAX_LOGO_SIZE_BYTES))).toBeNull();
  });
});

describe("rejects everything else, with a reason a merchant can act on", () => {
  it("asks for a file when none was chosen", () => {
    expect(validateRasterLogo(null)).toBe("Choose an image file to upload.");
    expect(validateRasterLogo(undefined)).toBe("Choose an image file to upload.");
  });

  it("treats an empty file as no file", () => {
    expect(validateRasterLogo(file("image/png", 0))).toBe("Choose an image file to upload.");
  });

  it("names the formats it does accept", () => {
    const message = validateRasterLogo(file("image/gif", 10_000));
    expect(message).toBe("Logo must be a JPEG, PNG or WebP image.");
  });

  it.each(["application/pdf", "text/html", "image/tiff", "application/octet-stream", ""])(
    "rejects %s",
    (type) => {
      expect(validateRasterLogo(file(type, 10_000))).not.toBeNull();
    },
  );

  it("rejects one byte over the limit, and says the limit", () => {
    expect(validateRasterLogo(file("image/png", MAX_LOGO_SIZE_BYTES + 1))).toBe("Logo must be under 1MB.");
  });

  it("sends SVG to the path that can actually handle it", () => {
    // SVG is not simply rejected: it has a validate-and-rasterize path in Email Studio, so
    // the message points there rather than telling the merchant their file is wrong.
    expect(validateRasterLogo(file(SVG_MIME_TYPE, 10_000))).toBe("SVG logos are uploaded from Email Studio.");
  });

  it("checks the type before the size, so a huge PDF is called a PDF", () => {
    expect(validateRasterLogo(file("application/pdf", MAX_LOGO_SIZE_BYTES * 10))).toBe(
      "Logo must be a JPEG, PNG or WebP image.",
    );
  });
});

describe("the limits themselves", () => {
  it("keeps a logo well under the review-photo limit", () => {
    expect(MAX_LOGO_SIZE_BYTES).toBeLessThan(5 * 1024 * 1024);
  });

  it("holds SVG to a tighter bound, since a browser must parse it to rasterize", () => {
    expect(MAX_SVG_SIZE_BYTES).toBeLessThan(MAX_LOGO_SIZE_BYTES);
  });

  it("never allows SVG through the raster allowlist", () => {
    expect(ALLOWED_LOGO_MIME_TYPES).not.toContain(SVG_MIME_TYPE);
  });
});
