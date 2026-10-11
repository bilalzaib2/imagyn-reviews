import sanitizeHtml from "sanitize-html";

// Imagyn Reviews — sanitization for merchant-authored email assets.
//
// Two untrusted inputs reach this app's rendering paths once Email Studio allows custom
// templates and SVG logos: raw HTML a merchant types, and an SVG file a merchant uploads.
// Both end up somewhere that executes or renders markup, so both are treated as hostile
// input regardless of the fact that the "attacker" is usually the shop owner themselves.
//
// Why the shop owner is still a threat model here:
//  - The Email Studio preview renders into an iframe inside the merchant's own authenticated
//    admin session. Unsanitized HTML there is stored XSS against Shopify admin, reachable by
//    any staff account with app access, not just the owner.
//  - Rendered output is emailed to real customers. Anything that survives sanitization is
//    something this app put in a customer's inbox over the merchant's sending identity.
//  - Shopify App Store review treats either of the above as a hard rejection.
//
// This module is the single sanitization boundary. It runs on SAVE (so nothing dangerous is
// ever persisted) and again on SEND/PREVIEW (so a row persisted by an older, weaker version
// of this code still cannot ship). Sanitizing twice is deliberate — persisted data is not
// trusted just because it is persisted.
//
// A vetted library does the parsing. Hand-rolled HTML sanitizers are a well-known source of
// bypasses (mutation XSS, namespace confusion, parser differentials); this is not a place to
// save a dependency.

// ---------------------------------------------------------------- Custom HTML

/** Structural and text markup an email client will actually render. Deliberately excludes
 *  anything scriptable or externally-loading: no script/style/link/meta/base, no iframe,
 *  object, embed or form, and no inline <svg> (which email clients do not render anyway, and
 *  which is a scripting surface in a browser preview). */
const ALLOWED_EMAIL_TAGS = [
  "a", "b", "blockquote", "br", "center", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "li", "ol", "p", "pre", "small", "span", "strong", "sub", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
];

/** The permitted shape of a style-attribute VALUE.
 *
 *  Allowing properties is not enough on its own — the value is where the historical
 *  style-attribute script vectors live: `width: expression(alert(1))`, `behavior: url(x.htc)`,
 *  `-moz-binding: url(...)`, `background: url(javascript:...)` and `@import`. An earlier
 *  version of this regex permitted letters and parentheses freely, which let
 *  `expression(alert(1))` through verbatim; the test suite caught it.
 *
 *  The leading negative lookahead rejects those constructs outright, including any `url(`,
 *  while the character class still permits the colour functions real email templates use
 *  (`rgb()`, `rgba()`, `hsl()`). */
const SAFE_STYLE_VALUE = [
  /^(?!.*(?:expression|behaviou?r|javascript|vbscript|-moz-binding|@import|url\s*\())[#a-zA-Z0-9\s.,%'"\-/_()]*$/i,
];

const ALLOWED_STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    "background-color": SAFE_STYLE_VALUE,
    "border": SAFE_STYLE_VALUE,
    "border-bottom": SAFE_STYLE_VALUE,
    "border-collapse": SAFE_STYLE_VALUE,
    "border-color": SAFE_STYLE_VALUE,
    "border-left": SAFE_STYLE_VALUE,
    "border-radius": SAFE_STYLE_VALUE,
    "border-right": SAFE_STYLE_VALUE,
    "border-top": SAFE_STYLE_VALUE,
    "color": SAFE_STYLE_VALUE,
    "display": SAFE_STYLE_VALUE,
    "font-family": SAFE_STYLE_VALUE,
    "font-size": SAFE_STYLE_VALUE,
    "font-style": SAFE_STYLE_VALUE,
    "font-weight": SAFE_STYLE_VALUE,
    "height": SAFE_STYLE_VALUE,
    "letter-spacing": SAFE_STYLE_VALUE,
    "line-height": SAFE_STYLE_VALUE,
    "margin": SAFE_STYLE_VALUE,
    "margin-bottom": SAFE_STYLE_VALUE,
    "margin-left": SAFE_STYLE_VALUE,
    "margin-right": SAFE_STYLE_VALUE,
    "margin-top": SAFE_STYLE_VALUE,
    "max-width": SAFE_STYLE_VALUE,
    "min-width": SAFE_STYLE_VALUE,
    "padding": SAFE_STYLE_VALUE,
    "padding-bottom": SAFE_STYLE_VALUE,
    "padding-left": SAFE_STYLE_VALUE,
    "padding-right": SAFE_STYLE_VALUE,
    "padding-top": SAFE_STYLE_VALUE,
    "text-align": SAFE_STYLE_VALUE,
    "text-decoration": SAFE_STYLE_VALUE,
    "text-transform": SAFE_STYLE_VALUE,
    "vertical-align": SAFE_STYLE_VALUE,
    "width": SAFE_STYLE_VALUE,
  },
};

const EMAIL_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_EMAIL_TAGS,
  allowedAttributes: {
    a: ["href", "name", "target", "rel", "style"],
    img: ["src", "alt", "width", "height", "style"],
    table: ["width", "border", "cellpadding", "cellspacing", "align", "bgcolor", "style", "role"],
    td: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor", "style"],
    th: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor", "style"],
    tr: ["align", "valign", "bgcolor", "style"],
    "*": ["style", "align", "dir", "lang", "title"],
  },
  allowedStyles: ALLOWED_STYLES,
  // mailto/tel are legitimate in an email; javascript:, vbscript:, file: and data: are not.
  // data: is excluded even for images: email clients overwhelmingly block it, and it is a
  // convenient carrier for markup-in-a-URL tricks.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  // A protocol-relative URL inherits the *rendering client's* scheme, which for a mail client
  // is undefined — forcing an explicit scheme keeps links from silently breaking.
  allowProtocolRelative: false,
  // Drop the contents of anything disallowed-and-dangerous rather than leaving the text
  // behind. Without this, `<script>alert(1)</script>` would strip the tag but keep "alert(1)"
  // as visible body text in the email.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed", "template"],
  // Every external link leaves the merchant's email for a third-party site; noopener prevents
  // the opened page from reaching back through window.opener.
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }, true),
  },
  disallowedTagsMode: "discard",
};

/** Sanitizes merchant-authored email HTML. Safe to call on already-sanitized input
 *  (idempotent), which is what lets it run on both save and send. */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html, EMAIL_HTML_OPTIONS);
}

/** True when sanitizing would change the markup — i.e. the input contained something that is
 *  not allowed. Used by the editor to tell a merchant *that* their HTML was altered, instead
 *  of silently rewriting what they typed and leaving them to discover it in a real inbox. */
export function emailHtmlWasModified(html: string): boolean {
  return sanitizeEmailHtml(html) !== html;
}

// ---------------------------------------------------------------- SVG logos

/** Elements that make an SVG more than a drawing. `script` is the obvious one; the rest are
 *  the non-obvious ones that have all been real XSS or SSRF vectors:
 *   - foreignObject embeds arbitrary HTML (and therefore scripts) inside the SVG
 *   - use/image can reference an external or same-origin document
 *   - animate/set can mutate an attribute to a javascript: URL after load
 *   - handler/listener are SVG's own event-binding elements
 *   - style can carry @import and historically url(javascript:) */
const FORBIDDEN_SVG_ELEMENTS = [
  "script", "foreignObject", "iframe", "embed", "object", "handler", "listener",
  "animate", "animateTransform", "animateMotion", "set", "use", "image", "style", "audio", "video",
];

/** Reasons an SVG is rejected outright rather than stripped. Returned to the merchant so the
 *  message can name the actual problem. */
export interface SvgRejection {
  reason: string;
}

const SVG_ROOT = /<svg[\s>]/i;
const EVENT_HANDLER_ATTR = /\son[a-z]+\s*=/i;
const SCRIPT_URL = /(javascript|vbscript|data)\s*:/i;
const EXTERNAL_REF = /(xlink:href|href)\s*=\s*["']?\s*(https?:)?\/\//i;
const ENTITY_DECLARATION = /<!ENTITY/i;
const DOCTYPE_WITH_SUBSET = /<!DOCTYPE[^>]*\[/i;

/**
 * Validates an uploaded SVG, failing CLOSED.
 *
 * This rejects rather than silently sanitizing, on purpose. A logo is a small, simple
 * drawing; if one arrives carrying a script, an external reference or an XML entity, the
 * right answer is to refuse it and tell the merchant to export a clean file — not to quietly
 * mutate their artwork and hope the stripping was complete. The cost of a false positive is
 * "upload a PNG instead", which is a safe direction to fail in.
 *
 * Detection is pattern-based rather than a full XML parse. That is a deliberate trade: for
 * *rejection* (as opposed to neutralization) an over-eager match is harmless, and this avoids
 * depending on a parser's own quirks to decide whether something is dangerous. Anything that
 * survives this is still run through sanitizeSvgMarkup below before it is stored.
 */
export function validateSvgLogo(svg: string): SvgRejection | null {
  if (!SVG_ROOT.test(svg)) {
    return { reason: "That file doesn't look like an SVG." };
  }
  if (ENTITY_DECLARATION.test(svg) || DOCTYPE_WITH_SUBSET.test(svg)) {
    // XML entity expansion — billion-laughs denial of service, and the classic vector for
    // reading local files through an SVG renderer.
    return { reason: "SVG contains XML entity declarations, which aren't allowed." };
  }
  if (EVENT_HANDLER_ATTR.test(svg)) {
    return { reason: "SVG contains event handler attributes (onload, onclick, …)." };
  }
  if (SCRIPT_URL.test(svg)) {
    return { reason: "SVG contains a script or data: URL." };
  }
  if (EXTERNAL_REF.test(svg)) {
    return { reason: "SVG references an external file. Export it with embedded artwork instead." };
  }

  for (const element of FORBIDDEN_SVG_ELEMENTS) {
    // Word-bounded so <path> is not matched by "a", and <animateTransform> is caught by its
    // own entry rather than slipping past an <animate> check.
    if (new RegExp(`<\\s*${element}\\b`, "i").test(svg)) {
      return { reason: `SVG contains a <${element}> element, which isn't allowed in a logo.` };
    }
  }

  return null;
}

/** Shape-only allow-list. Anything not named here is discarded. */
const ALLOWED_SVG_TAGS = [
  "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "text", "tspan",
];

const ALLOWED_SVG_ATTRS = [
  "viewBox", "xmlns", "xmlns:xlink", "version", "width", "height", "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry", "d", "points", "transform", "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-opacity",
  "opacity", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
  "clip-path", "clip-rule", "mask", "id", "class", "font-family", "font-size", "font-weight",
  "text-anchor", "dominant-baseline", "preserveAspectRatio",
];

/**
 * Strips an SVG down to the allow-listed drawing elements above.
 *
 * Belt-and-braces behind validateSvgLogo: that function decides whether a file is acceptable
 * at all, this one guarantees that whatever is stored contains nothing but shapes. Parsed in
 * xmlMode with casing preserved, because SVG is case-sensitive — `viewBox` and `linearGradient`
 * are different names from `viewbox` and `lineargradient`, and an HTML-mode parse would
 * lowercase them and silently destroy the artwork.
 */
export function sanitizeSvgMarkup(svg: string): string {
  return sanitizeHtml(svg, {
    allowedTags: ALLOWED_SVG_TAGS,
    allowedAttributes: { "*": ALLOWED_SVG_ATTRS },
    allowedSchemes: [],
    allowProtocolRelative: false,
    nonTextTags: ["script", "style"],
    disallowedTagsMode: "discard",
    parser: {
      xmlMode: true,
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
      recognizeSelfClosing: true,
    },
  });
}
