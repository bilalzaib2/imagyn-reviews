import { Body, Container, Head, Hr, Html, Img, Preview, Section, Text } from "@react-email/components";

export interface SupportRequestEmailProps {
  /** What the merchant typed. Rendered as text, never as markup. */
  subject: string;
  message: string;
  /** One of the fixed category options, or null when the merchant left it unset. */
  category: string | null;
  storeName: string;
  shopDomain: string;
  /** Merchant-facing plan name ("Free"/"Pro"), when resolvable. */
  planName: string | null;
  /** The in-app path the merchant was on when they opened the form (e.g. "/app/widgets"). */
  appSection: string | null;
  /** The store's own contact email, when the Admin API returned one — used as Reply-To on the
   *  send itself, and shown here so support knows who they're replying to. */
  merchantEmail: string | null;
  submittedAt: string;
}

const FONT_FAMILY = "Helvetica, Arial, sans-serif";

// Sent by supportRequest.server.ts to IMAGYN's own support inbox — an internal notification,
// not merchant-facing mail, so it follows ReviewHeldEmail.tsx's plain monochrome style and
// carries no branding controls.
//
// Everything rendered here is either typed by the merchant or resolved server-side from the
// authenticated session. React Email escapes interpolated text, so a merchant cannot inject
// markup into this email through the subject or message.
export function SupportRequestEmail({
  subject,
  message,
  category,
  storeName,
  shopDomain,
  planName,
  appSection,
  merchantEmail,
  submittedAt,
}: SupportRequestEmailProps) {
  const rows: Array<[string, string]> = [
    ["Store", storeName],
    ["Shop", shopDomain],
  ];

  if (planName) {
    rows.push(["Plan", planName]);
  }
  if (category) {
    rows.push(["Category", category]);
  }
  if (appSection) {
    rows.push(["Page", appSection]);
  }
  if (merchantEmail) {
    rows.push(["Merchant email", merchantEmail]);
  }
  rows.push(["Submitted", submittedAt]);

  return (
    <Html lang="en">
      <Head />
      <Preview>{`${storeName}: ${subject}`}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#ffffff", fontFamily: FONT_FAMILY }}>
        <Container style={{ maxWidth: "560px", padding: "48px 24px" }}>
          <Section style={{ paddingBottom: "24px" }}>
            <Img
              src="https://app.imagyn.co/apple-touch-icon.png?v=3"
              width="28"
              height="28"
              alt="Imagyn Reviews"
              style={{ borderRadius: "6px" }}
            />
          </Section>

          <Section style={{ paddingBottom: "8px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: "13px",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "#8a8a8a",
              }}
            >
              Support request
            </Text>
          </Section>

          <Section style={{ paddingBottom: "24px" }}>
            <Text style={{ margin: 0, fontSize: "22px", lineHeight: "1.35", fontWeight: 600, color: "#111111" }}>
              {subject}
            </Text>
          </Section>

          <Section
            style={{
              paddingBottom: "8px",
              borderLeft: "2px solid #eeeeee",
              paddingLeft: "16px",
            }}
          >
            {/* whiteSpace preserves the merchant's own line breaks without needing to convert
                them to markup. */}
            <Text
              style={{
                margin: 0,
                fontSize: "15px",
                lineHeight: "1.6",
                color: "#4a4a4a",
                whiteSpace: "pre-wrap",
              }}
            >
              {message}
            </Text>
          </Section>

          <Section style={{ paddingTop: "32px" }}>
            <Hr style={{ borderColor: "#eeeeee", margin: "0 0 16px" }} />
            {rows.map(([label, value]) => (
              <Text
                key={label}
                style={{ margin: "0 0 4px", fontSize: "13px", lineHeight: "1.6", color: "#6a6a6a" }}
              >
                <strong style={{ color: "#111111" }}>{label}:</strong> {value}
              </Text>
            ))}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
