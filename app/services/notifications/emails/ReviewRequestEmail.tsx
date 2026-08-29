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
  /** Hides the storeName eyebrow line entirely when false — see email.shared.ts's
   *  EmailTemplateContent.showStoreName. */
  showStoreName: boolean;
  reviewUrl: string;
  // Omitted for the Email Studio preview/test-email paths (sample data) — the footer line only
  // renders when present. See templates.server.tsx's ReviewRequestEmailData.
  unsubscribeUrl?: string;
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
  showStoreName,
  reviewUrl,
  unsubscribeUrl,
}: ReviewRequestEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#ffffff", fontFamily: FONT_FAMILY }}>
        <Container style={{ maxWidth: "480px", padding: "56px 24px" }}>
          {logoUrl ? (
            // Merchant-uploaded logo: capped to a max width, no fixed height, so a
            // non-square logo (most wordmarks aren't) never gets stretched into a square —
            // the one hard rule from a first pass that hardcoded width=height=28. No fallback
            // mark is rendered here when a merchant hasn't uploaded one (see the footer
            // instead) — this slot is the email's primary, above-the-fold branding position,
            // and showing Imagyn's own icon there made a customer's first impression of an
            // unbranded email read as "sent by Imagyn," not "sent by the store."
            <Section style={{ paddingBottom: "24px" }}>
              <Img src={logoUrl} width="40" alt={storeName} style={{ maxHeight: "40px", height: "auto" }} />
            </Section>
          ) : null}

          {showStoreName ? (
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
          ) : null}

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

          {unsubscribeUrl ? (
            <Section style={{ paddingTop: "12px" }}>
              <Text style={{ margin: 0, fontSize: "12px", lineHeight: "1.6", color: "#a0a0a0" }}>
                <a href={unsubscribeUrl} style={{ color: "#a0a0a0" }}>
                  Unsubscribe
                </a>{" "}
                from future emails like this.
              </Text>
            </Section>
          ) : null}

          {/* One small, quiet line — the merchant's own branding above does all the real
              work; this is attribution, not a second ad. The mark here is tiny (14px) and
              sits only in this footer, never in the header's primary branding position, so
              it can never read as "this email is from Imagyn" — see the logo Section above. */}
          <Section style={{ paddingTop: "20px" }}>
            <Text style={{ margin: 0, fontSize: "11px", lineHeight: "1.5", color: "#c2c2c2" }}>
              <Img
                src="https://app.imagyn.co/apple-touch-icon.png?v=3"
                width="14"
                height="14"
                alt=""
                style={{ borderRadius: "3px", verticalAlign: "middle", marginRight: "5px" }}
              />
              Powered by Imagyn Reviews
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
