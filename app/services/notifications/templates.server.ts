export interface ReviewRequestEmailData {
  customerName: string;
  productName: string;
  storeName: string;
  reviewUrl: string;
  customMessage: string | null;
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Helvetica, Arial, sans-serif";

// Pure function, no I/O — the only thing that changes if the design language evolves or a
// second template (e.g. a reminder email) is added later. Table-based layout and inline
// styles are deliberate: email clients don't reliably support external/embedded CSS, so this
// can't reuse the app's own stylesheets the way admin/storefront UI does. Kept text-forward
// and monochrome (no product image, no decorative color) to match the typography-first,
// minimal Apple/Linear language documented in docs/DESIGN_SYSTEM.md without needing anything
// email clients tend to strip or mis-render.
export function buildReviewRequestEmail(data: ReviewRequestEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const firstName = data.customerName.trim().split(/\s+/)[0] || data.customerName.trim();
  const subject = `How was your ${data.productName}?`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#ffffff;font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
      <tr>
        <td align="center" style="padding:56px 24px;">
          <table role="presentation" width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-bottom:32px;">
                <p style="margin:0;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#8a8a8a;">
                  ${escapeHtml(data.storeName)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:16px;">
                <h1 style="margin:0;font-size:24px;line-height:1.35;font-weight:600;color:#111111;">
                  Hi ${escapeHtml(firstName)}, how was your ${escapeHtml(data.productName)}?
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:32px;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#4a4a4a;">
                  ${
                    data.customMessage
                      ? escapeHtml(data.customMessage)
                      : "Your feedback helps other shoppers decide with confidence — it only takes a minute."
                  }
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:40px;">
                <a
                  href="${escapeHtmlAttr(data.reviewUrl)}"
                  style="display:inline-block;background-color:#111111;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:8px;"
                >
                  Write a review
                </a>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #eeeeee;padding-top:20px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#a0a0a0;">
                  If the button above doesn't work, copy and paste this link into your browser:<br />
                  <a href="${escapeHtmlAttr(data.reviewUrl)}" style="color:#a0a0a0;">${escapeHtml(data.reviewUrl)}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `Hi ${firstName}, how was your ${data.productName}?

${data.customMessage || "Your feedback helps other shoppers decide with confidence — it only takes a minute."}

Write a review: ${data.reviewUrl}

— ${data.storeName}`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value);
}
