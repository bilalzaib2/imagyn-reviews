// Logo upload limits, shared by every screen that accepts one.
//
// Email Studio has accepted logo uploads for a while; Brand Studio only ever offered a URL
// field, which asks a merchant to host an image somewhere and paste a link — something most
// of them cannot do. Both now accept a file, and both apply exactly these rules, because two
// screens disagreeing about what counts as a valid logo is how one of them ends up accepting
// a 4MB TIFF that the other would have rejected.

/** A logo renders small, so there is no reason to accept anything large. Deliberately well
 *  under reviewMedia.server.ts's 5MB review-photo limit. */
export const MAX_LOGO_SIZE_BYTES = 1 * 1024 * 1024;

/** Raster formats, uploaded as-is. SVG is NOT here: it takes a separate two-step path
 *  (validate and sanitize server-side, rasterize client-side) — see the validate-svg intent
 *  in app.email-studio.tsx. */
export const ALLOWED_LOGO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const SVG_MIME_TYPE = "image/svg+xml";

/** A logo is a small drawing. Anything larger is almost certainly an embedded raster or a
 *  pathological file, and a browser has to parse it before rasterizing. */
export const MAX_SVG_SIZE_BYTES = 256 * 1024;

export interface LogoFileFacts {
  type: string;
  size: number;
}

/**
 * Validates a raster logo, returning a merchant-facing message or null when it is fine.
 *
 * Returns the message rather than throwing: every caller renders it next to the field, and
 * an exception would have to be caught and converted at each one.
 */
export function validateRasterLogo(file: LogoFileFacts | null | undefined): string | null {
  if (!file || file.size === 0) return "Choose an image file to upload.";
  if (file.type === SVG_MIME_TYPE) return "SVG logos are uploaded from Email Studio.";
  if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type)) return "Logo must be a JPEG, PNG or WebP image.";
  if (file.size > MAX_LOGO_SIZE_BYTES) return "Logo must be under 1MB.";
  return null;
}
