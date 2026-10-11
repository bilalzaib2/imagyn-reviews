import { describe, expect, it } from "vitest";
import {
  emailHtmlWasModified,
  sanitizeEmailHtml,
  sanitizeSvgMarkup,
  validateSvgLogo,
} from "./emailSanitize.server";

// These are the security tests for the two untrusted inputs Email Studio accepts: raw HTML a
// merchant types into the custom-template editor, and an SVG they upload as a logo.
//
// Both reach places that execute or render markup — the preview iframe inside the merchant's
// authenticated Shopify admin session, and real customers' inboxes. A regression here is a
// stored-XSS bug and an App Store rejection, not a cosmetic defect, which is why the
// assertions below are about what must NOT survive rather than about formatting.

describe("sanitizeEmailHtml — script execution", () => {
  it("removes a script tag and its contents, leaving no executable text behind", () => {
    const result = sanitizeEmailHtml('<p>Hi</p><script>alert(document.cookie)</script>');

    expect(result).not.toContain("<script");
    // The payload text must go too. Stripping only the tag would leave "alert(document.cookie)"
    // as visible body copy in the email.
    expect(result).not.toContain("alert");
    expect(result).toContain("<p>Hi</p>");
  });

  it("strips inline event handlers", () => {
    for (const html of [
      '<p onclick="steal()">Click</p>',
      '<img src="https://example.com/a.png" onerror="steal()" />',
      '<div onmouseover="steal()">Hover</div>',
    ]) {
      const result = sanitizeEmailHtml(html);
      expect(result).not.toMatch(/on[a-z]+\s*=/i);
      expect(result).not.toContain("steal");
    }
  });

  it("strips javascript: and vbscript: URLs while keeping ordinary links", () => {
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
    expect(sanitizeEmailHtml('<a href="vbscript:msgbox(1)">x</a>')).not.toContain("vbscript:");
    expect(sanitizeEmailHtml('<a href="https://example.com">x</a>')).toContain("https://example.com");
    expect(sanitizeEmailHtml('<a href="mailto:hi@example.com">x</a>')).toContain("mailto:hi@example.com");
  });

  it("strips a data: URL, which can smuggle markup past a naive URL check", () => {
    const result = sanitizeEmailHtml('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>');
    expect(result).not.toContain("data:text/html");
  });

  it("removes framing and embedding elements entirely", () => {
    for (const tag of ["iframe", "object", "embed", "form", "input", "link", "meta", "base", "style", "svg"]) {
      const result = sanitizeEmailHtml(`<${tag}>payload</${tag}>`);
      expect(result).not.toContain(`<${tag}`);
    }
  });

  it("neutralizes style-attribute script vectors but keeps ordinary styling", () => {
    const dangerous = sanitizeEmailHtml('<p style="width: expression(alert(1)); behavior: url(x.htc)">x</p>');
    expect(dangerous).not.toContain("expression");
    expect(dangerous).not.toContain("behavior");

    const safe = sanitizeEmailHtml('<p style="color: #ff0000; padding: 12px">x</p>');
    expect(safe).toContain("color");
    expect(safe).toContain("#ff0000");
  });

  it("survives a mutation-XSS style nesting attempt", () => {
    // Malformed/nested markup is where hand-rolled sanitizers classically fail: the parser
    // that strips and the parser that later renders disagree about where tags close.
    const result = sanitizeEmailHtml('<div><p><script>alert(1)</script></p></div><scr<script>ipt>alert(2)</scr</script>ipt>');

    // What matters is that nothing executable survives. Fragments of the payload may remain
    // as HTML-escaped literal text ("ipt&gt;alert(2)"), which renders as visible characters
    // in the email body and cannot run — asserting their absence would be testing output
    // formatting, not safety.
    expect(result).not.toContain("<script");
    expect(result).not.toMatch(/on[a-z]+\s*=/i);
    expect(result).not.toContain("javascript:");
  });
});

describe("sanitizeEmailHtml — legitimate email markup", () => {
  it("keeps the table/text structure real email templates are built from", () => {
    const html =
      '<table role="presentation" cellpadding="0" width="100%"><tbody><tr><td align="center" style="padding: 16px">' +
      '<h1>Hello</h1><p>Body <strong>copy</strong> and <em>emphasis</em>.</p>' +
      '<a href="https://example.com/review">Write a review</a></td></tr></tbody></table>';
    const result = sanitizeEmailHtml(html);

    expect(result).toContain("<table");
    expect(result).toContain("<td");
    expect(result).toContain("<h1>Hello</h1>");
    expect(result).toContain("<strong>copy</strong>");
    expect(result).toContain("https://example.com/review");
  });

  it("keeps images with their dimensions", () => {
    const result = sanitizeEmailHtml('<img src="https://cdn.example.com/logo.png" alt="Logo" width="120" height="40" />');

    expect(result).toContain("https://cdn.example.com/logo.png");
    expect(result).toContain('alt="Logo"');
    expect(result).toContain('width="120"');
  });

  it("adds noopener to outbound links so the opened page can't reach window.opener", () => {
    const result = sanitizeEmailHtml('<a href="https://example.com">x</a>');
    expect(result).toContain("noopener");
  });

  it("is idempotent, which is what makes it safe to run on both save and send", () => {
    const once = sanitizeEmailHtml('<p style="color:#111">Hi</p><script>alert(1)</script>');
    expect(sanitizeEmailHtml(once)).toBe(once);
  });

  it("returns an empty string for empty input rather than throwing", () => {
    expect(sanitizeEmailHtml("")).toBe("");
  });
});

describe("emailHtmlWasModified", () => {
  it("reports when markup had to be changed, so the editor can say so instead of silently rewriting", () => {
    expect(emailHtmlWasModified('<p>Hi</p><script>alert(1)</script>')).toBe(true);
  });

  it("reports no change for markup that is already clean", () => {
    const clean = sanitizeEmailHtml('<p>Hi</p>');
    expect(emailHtmlWasModified(clean)).toBe(false);
  });
});

describe("validateSvgLogo — rejects rather than silently repairing", () => {
  const SAFE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#111111"/></svg>';

  it("accepts an ordinary shape-only logo", () => {
    expect(validateSvgLogo(SAFE_SVG)).toBeNull();
  });

  it("rejects a file that isn't an SVG at all", () => {
    expect(validateSvgLogo("not markup")).not.toBeNull();
  });

  it("rejects embedded scripts", () => {
    const rejection = validateSvgLogo('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(rejection).not.toBeNull();
    expect(rejection?.reason).toMatch(/script/i);
  });

  it("rejects event handler attributes", () => {
    expect(validateSvgLogo('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')).not.toBeNull();
  });

  it("rejects foreignObject, which smuggles arbitrary HTML into a drawing", () => {
    const rejection = validateSvgLogo('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body>x</body></foreignObject></svg>');
    expect(rejection).not.toBeNull();
    expect(rejection?.reason).toMatch(/foreignObject/i);
  });

  it("rejects XML entity declarations (billion laughs, local file disclosure)", () => {
    const rejection = validateSvgLogo(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>',
    );
    expect(rejection).not.toBeNull();
    expect(rejection?.reason).toMatch(/entity/i);
  });

  it("rejects external references", () => {
    expect(validateSvgLogo('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>')).not.toBeNull();
  });

  it("rejects animation elements, which can rewrite an attribute into a script URL after load", () => {
    expect(
      validateSvgLogo('<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" to="javascript:alert(1)"/></svg>'),
    ).not.toBeNull();
  });

  it("rejects <use>, which can dereference another document", () => {
    expect(validateSvgLogo('<svg xmlns="http://www.w3.org/2000/svg"><use href="#x"/></svg>')).not.toBeNull();
  });
});

describe("sanitizeSvgMarkup — belt and braces behind validation", () => {
  it("preserves case-sensitive SVG names that an HTML-mode parse would destroy", () => {
    // viewBox and linearGradient are not viewbox and lineargradient. Lower-casing them
    // silently breaks the artwork, which is why the parser runs in xmlMode.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
      '<rect width="10" height="10" fill="url(#g)"/></svg>';
    const result = sanitizeSvgMarkup(svg);

    expect(result).toContain("viewBox");
    expect(result).toContain("linearGradient");
    expect(result).toContain("gradientUnits");
  });

  it("drops anything outside the shape allow-list", () => {
    const result = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0h1v1H0z"/></svg>',
    );

    expect(result).not.toContain("<script");
    expect(result).not.toContain("alert");
    expect(result).toContain("<path");
  });

  it("drops event handler attributes even on allowed elements", () => {
    const result = sanitizeSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z" onclick="alert(1)"/></svg>');

    expect(result).not.toMatch(/on[a-z]+\s*=/i);
    expect(result).toContain("<path");
  });
});
