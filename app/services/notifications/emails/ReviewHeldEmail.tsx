import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";

export interface ReviewHeldEmailProps {
  storeName: string;
  reviewerName: string;
  productName: string;
  rating: number;
  reason: string;
  reviewsUrl: string;
}

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Helvetica, Arial, sans-serif";

// Sent by moderationRules.server.ts's sendHeldReviewNotification whenever a new review is
// held by an automatic Moderation Rule — mirrors ReviewRequestEmail.tsx's monochrome,
// React-Email-primitives-only style so the two templates read as the same product.
export function ReviewHeldEmail({ storeName, reviewerName, productName, rating, reason, reviewsUrl }: ReviewHeldEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>A new review needs your attention</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#ffffff", fontFamily: FONT_FAMILY }}>
        <Container style={{ maxWidth: "480px", padding: "56px 24px" }}>
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
              A review was held for moderation
            </Text>
          </Section>

          <Section style={{ paddingBottom: "8px" }}>
            <Text style={{ margin: 0, fontSize: "15px", lineHeight: "1.6", color: "#4a4a4a" }}>
              {reviewerName} left a {rating}-star review of {productName}. Your Moderation Rules held it instead
              of publishing it automatically.
            </Text>
          </Section>

          <Section style={{ paddingBottom: "32px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: "13px",
                lineHeight: "1.6",
                color: "#a0a0a0",
              }}
            >
              {reason}
            </Text>
          </Section>

          <Section style={{ paddingBottom: "40px" }}>
            <Button
              href={reviewsUrl}
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
              Review it now
            </Button>
          </Section>

          <Hr style={{ borderColor: "#eeeeee", margin: 0 }} />

          <Section style={{ paddingTop: "20px" }}>
            <Text style={{ margin: 0, fontSize: "12px", lineHeight: "1.6", color: "#a0a0a0" }}>
              If the button above doesn&apos;t work, copy and paste this link into your browser:
              <br />
              <a href={reviewsUrl} style={{ color: "#a0a0a0" }}>
                {reviewsUrl}
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
