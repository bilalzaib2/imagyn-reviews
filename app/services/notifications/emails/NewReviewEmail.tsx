import { Body, Button, Container, Head, Hr, Html, Img, Preview, Section, Text } from "@react-email/components";

export interface NewReviewEmailProps {
  storeName: string;
  reviewerName: string;
  rating: number;
  /** Null whenever the customer genuinely left no title — never substituted with the review
   *  body, the product name, or any other invented stand-in. */
  title: string | null;
  content: string;
  /** Null only when a review somehow has no product name recorded; never a placeholder. */
  productName: string | null;
  /** The review's real createdAt, pre-formatted by the caller (this template does no
   *  timezone/locale guessing of its own). */
  submittedAt: string;
  /** The Review row's own verifiedPurchase column — IMAGYN's own verification signal, never a
   *  source platform's imported claim (see Review.sourceVerified in schema.prisma). */
  verifiedPurchase: boolean;
  /** "Storefront widget" / "Review request email" — how this review actually reached the
   *  store, derived from real data by the caller. Null when it can't be determined. */
  source: string | null;
  /** Whether a Moderation Rule auto-published this review, held it, or left it for manual
   *  moderation — the merchant's single most useful "do I need to act on this" signal. */
  statusLabel: string;
  viewUrl: string;
  replyUrl: string;
}

const FONT_FAMILY = "Helvetica, Arial, sans-serif";

// Longer reviews are truncated in the email body and the merchant is sent to the app to read
// the rest — an email is a notification, not a second review-reading surface, and an
// unbounded paste of customer text makes the two CTAs below scroll off the screen.
const MAX_CONTENT_CHARS = 600;

function truncate(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_CONTENT_CHARS) {
    return { text: value, truncated: false };
  }
  return { text: `${value.slice(0, MAX_CONTENT_CHARS).trimEnd()}…`, truncated: true };
}

function stars(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

// Sent by reviewNotifications.server.ts's sendNewReviewNotification whenever a customer
// submits a new review. Mirrors ReviewHeldEmail.tsx's monochrome, React-Email-primitives-only
// style so every Imagyn merchant notification reads as the same product. Every field rendered
// here comes from the Review row itself — nothing is inferred, defaulted to a friendly-looking
// placeholder, or synthesized when absent: a missing title simply isn't rendered, and the
// "Verified buyer" line only appears for a review that genuinely carries that flag.
export function NewReviewEmail({
  storeName,
  reviewerName,
  rating,
  title,
  content,
  productName,
  submittedAt,
  verifiedPurchase,
  source,
  statusLabel,
  viewUrl,
  replyUrl,
}: NewReviewEmailProps) {
  const body = truncate(content);

  const metaParts = [submittedAt, source].filter(Boolean) as string[];

  return (
    <Html lang="en">
      <Head />
      <Preview>{`${reviewerName} left a ${rating}-star review`}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#ffffff", fontFamily: FONT_FAMILY }}>
        <Container style={{ maxWidth: "480px", padding: "56px 24px" }}>
          <Section style={{ paddingBottom: "24px" }}>
            <Img
              src="https://app.imagyn.co/apple-touch-icon.png?v=3"
              width="28"
              height="28"
              alt="Imagyn Reviews"
              style={{ borderRadius: "6px" }}
            />
          </Section>

          <Section style={{ paddingBottom: "32px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: "13px",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "#8a8a8a",
              }}
            >
              {storeName}
            </Text>
          </Section>

          <Section style={{ paddingBottom: "16px" }}>
            <Text style={{ margin: 0, fontSize: "24px", lineHeight: "1.35", fontWeight: 600, color: "#111111" }}>
              You have a new review
            </Text>
          </Section>

          <Section style={{ paddingBottom: "24px" }}>
            <Text style={{ margin: 0, fontSize: "15px", lineHeight: "1.6", color: "#4a4a4a" }}>
              {productName
                ? `${reviewerName} reviewed ${productName}.`
                : `${reviewerName} left a new review.`}
            </Text>
          </Section>

          <Section
            style={{
              paddingBottom: "8px",
              borderLeft: "2px solid #eeeeee",
              paddingLeft: "16px",
            }}
          >
            <Text style={{ margin: 0, fontSize: "17px", lineHeight: "1.4", color: "#111111", letterSpacing: "0.08em" }}>
              {stars(rating)}
            </Text>

            {title ? (
              <Text style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: "1.5", fontWeight: 600, color: "#111111" }}>
                {title}
              </Text>
            ) : null}

            <Text style={{ margin: "12px 0 0", fontSize: "15px", lineHeight: "1.6", color: "#4a4a4a" }}>
              {body.text}
            </Text>

            {body.truncated ? (
              <Text style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: "1.6", color: "#a0a0a0" }}>
                Open the review to read the rest.
              </Text>
            ) : null}

            {verifiedPurchase ? (
              <Text style={{ margin: "12px 0 0", fontSize: "13px", lineHeight: "1.6", color: "#1a7f4b" }}>
                Verified buyer
              </Text>
            ) : null}
          </Section>

          <Section style={{ paddingTop: "16px", paddingBottom: "32px" }}>
            <Text style={{ margin: 0, fontSize: "13px", lineHeight: "1.6", color: "#a0a0a0" }}>
              {statusLabel}
            </Text>
            {metaParts.length > 0 ? (
              <Text style={{ margin: "4px 0 0", fontSize: "13px", lineHeight: "1.6", color: "#a0a0a0" }}>
                {metaParts.join(" · ")}
              </Text>
            ) : null}
          </Section>

          <Section style={{ paddingBottom: "12px" }}>
            <Button
              href={viewUrl}
              style={{
                backgroundColor: "#111111",
                color: "#ffffff",
                textDecoration: "none",
                fontSize: "15px",
                fontWeight: 600,
                padding: "14px 28px",
                borderRadius: "8px",
              }}
            >
              View review
            </Button>
          </Section>

          <Section style={{ paddingBottom: "40px" }}>
            <Button
              href={replyUrl}
              style={{
                backgroundColor: "#ffffff",
                color: "#111111",
                textDecoration: "none",
                fontSize: "15px",
                fontWeight: 600,
                padding: "13px 27px",
                borderRadius: "8px",
                border: "1px solid #dddddd",
              }}
            >
              Reply to review
            </Button>
          </Section>

          <Hr style={{ borderColor: "#eeeeee", margin: 0 }} />

          <Section style={{ paddingTop: "20px" }}>
            <Text style={{ margin: 0, fontSize: "12px", lineHeight: "1.6", color: "#a0a0a0" }}>
              If the buttons above don&apos;t work, copy and paste this link into your browser:
              <br />
              <a href={viewUrl} style={{ color: "#a0a0a0" }}>
                {viewUrl}
              </a>
            </Text>
          </Section>

          <Section style={{ paddingTop: "12px" }}>
            <Text style={{ margin: 0, fontSize: "12px", lineHeight: "1.6", color: "#a0a0a0" }}>
              You&apos;re receiving this because new-review notifications are on for {storeName}. Turn them off in
              Imagyn Reviews under Settings → Publishing &amp; Moderation.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
