import { Body, Button, Container, Head, Hr, Html, Img, Preview, Section, Text } from "@react-email/components";

export interface ReviewRequestEmailProps {
  // The inbox preview snippet — templates.server.tsx passes the already-rendered subject here,
  // matching what most email clients actually show next to the subject line.
  previewText: string;
  // heading/bodyText arrive already {{variable}}-substituted — see templates.server.tsx,
  // which is the one place that owns turning a merchant's EmailTemplateContent + this send's
  // customer/store/product data into these final strings. This component only ever renders,
  // never resolves variables itself.
  heading: string;
  bodyText: string;
  buttonText: string;
  accentColor: string;
  logoUrl: string | null;
  storeName: string;
  reviewUrl: string;
}

const FONT_FAMILY = "Helvetica, Arial, sans-serif";

// Matches the app's own typography-first design language (docs/DESIGN_SYSTEM.md) using only
// React Email's cross-client-safe primitives — no external CSS/fonts, since email clients
// don't reliably support either. Every merchant-editable value (heading, body, button text,
// accent color, logo) comes in as a prop from Email Studio (app.email-studio.tsx) via
// templates.server.tsx — this file owns layout/markup only, never copy or color defaults
// (those live in email.shared.ts's getDefaultEmailTemplateContent, the single source of truth
// both the editor and the real send path read).
export function ReviewRequestEmail({
  previewText,
  heading,
  bodyText,
  buttonText,
  accentColor,
  logoUrl,
  storeName,
  reviewUrl,
}: ReviewRequestEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#ffffff", fontFamily: FONT_FAMILY }}>
        <Container style={{ maxWidth: "480px", padding: "56px 24px" }}>
          <Section style={{ paddingBottom: "24px" }}>
            {logoUrl ? (
              <Img src={logoUrl} width="28" height="28" alt={storeName} style={{ borderRadius: "6px" }} />
            ) : (
              <Img
                src="https://app.imagyn.co/apple-touch-icon.png"
                width="28"
                height="28"
                alt="Imagyn Reviews"
                style={{ borderRadius: "6px" }}
              />
            )}
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
              {heading}
            </Text>
          </Section>

          <Section style={{ paddingBottom: "32px" }}>
            <Text style={{ margin: 0, fontSize: "15px", lineHeight: "1.6", color: "#4a4a4a" }}>{bodyText}</Text>
          </Section>

          <Section style={{ paddingBottom: "40px" }}>
            <Button
              href={reviewUrl}
              style={{
                backgroundColor: accentColor,
                color: "#ffffff",
                textDecoration: "none",
                fontSize: "15px",
                fontWeight: 600,
                padding: "14px 28px",
                borderRadius: "8px",
              }}
            >
              {buttonText}
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
