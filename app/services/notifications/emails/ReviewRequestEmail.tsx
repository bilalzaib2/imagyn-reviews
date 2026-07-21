import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";

export interface ReviewRequestEmailProps {
  customerName: string;
  productName: string;
  storeName: string;
  reviewUrl: string;
  customMessage: string | null;
}

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Helvetica, Arial, sans-serif";

// Matches the app's own typography-first, monochrome design language (docs/DESIGN_SYSTEM.md)
// using only React Email's cross-client-safe primitives — no external CSS/fonts, since email
// clients don't reliably support either. This is the sole template today; a second one (e.g.
// a reminder email) would live alongside it in this same directory.
export function ReviewRequestEmail({
  customerName,
  productName,
  storeName,
  reviewUrl,
  customMessage,
}: ReviewRequestEmailProps) {
  const firstName = customerName.trim().split(/\s+/)[0] || customerName.trim();

  return (
    <Html lang="en">
      <Head />
      <Preview>How was your {productName}?</Preview>
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
              Hi {firstName}, how was your {productName}?
            </Text>
          </Section>

          <Section style={{ paddingBottom: "32px" }}>
            <Text style={{ margin: 0, fontSize: "15px", lineHeight: "1.6", color: "#4a4a4a" }}>
              {customMessage || "Your feedback helps other shoppers decide with confidence — it only takes a minute."}
            </Text>
          </Section>

          <Section style={{ paddingBottom: "40px" }}>
            <Button
              href={reviewUrl}
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
              Write a review
            </Button>
          </Section>

          <Hr style={{ borderColor: "#eeeeee", margin: 0 }} />

          <Section style={{ paddingTop: "20px" }}>
            <Text style={{ margin: 0, fontSize: "12px", lineHeight: "1.6", color: "#a0a0a0" }}>
              If the button above doesn&apos;t work, copy and paste this link into your browser:
              <br />
              <a href={reviewUrl} style={{ color: "#a0a0a0" }}>
                {reviewUrl}
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
