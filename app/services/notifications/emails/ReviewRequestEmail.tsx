import { Body, Button, Container, Head, Hr, Html, Img, Preview, Section, Text } from "@react-email/components";

import type {
  EmailAlign,
  EmailDensity,
  EmailFontFamily,
  EmailSection,
  EmailTextSize,
  EmailTheme,
} from "../../email.shared";

export interface ReviewRequestEmailProps {
  // The inbox preview snippet. templates.server.tsx resolves this from the merchant's
  // previewText (falling back to the rendered subject), so this component never decides it.
  previewText: string;
  // heading/bodyText/closingText arrive already {{variable}}-substituted — see
  // templates.server.tsx, the one place that turns a merchant's EmailTemplateContent plus
  // this send's customer/store/product data into final strings. This component only renders.
  heading: string;
  bodyText: string;
  closingText: string;
  buttonText: string;

  accentColor: string;
  buttonTextColor: string;
  theme: EmailTheme;
  fontFamily: EmailFontFamily;
  headingSize: EmailTextSize;
  bodySize: EmailTextSize;
  density: EmailDensity;
  contentWidth: number;
  cornerRadius: number;
  buttonStyle: "filled" | "outline";
  buttonAlign: EmailAlign;

  logoUrl: string | null;
  /** Used instead of logoUrl when theme === "dark". Falls back to logoUrl when absent. */
  logoDarkUrl: string | null;
  logoWidth: number;

  storeName: string;
  /** Hides the storeName eyebrow line entirely when false. */
  showStoreName: boolean;
  /** Hides the "Powered by Imagyn Reviews" footer line — a real Pro-only capability (see
   *  email.shared.ts's sanitizeEmailTemplateContentForPlan, the actual enforcement point;
   *  this prop only renders whatever it is given). */
  showPoweredBy: boolean;

  /** The purchased product. Both are optional because a send does not always have them —
   *  the product block is skipped entirely rather than rendering an empty frame or a
   *  placeholder image. Never invented. */
  productName?: string | null;
  productImageUrl?: string | null;

  /** Ordered, enabled-filtered body blocks. */
  sections: EmailSection[];

  /** Already-sanitized HTML (emailSanitize.server.ts). When present it replaces the whole
   *  structured body; the compliance footer below is still rendered by this component, so a
   *  merchant cannot drop the unsubscribe line by switching to custom HTML. */
  customHtml?: string | null;

  reviewUrl: string;
  // Omitted for the Email Studio preview/test-email paths (sample data) — the footer link
  // only renders when present. See templates.server.tsx's ReviewRequestEmailData.
  unsubscribeUrl?: string;
}

// Email-safe stacks only. No @font-face: email clients do not reliably load webfonts, so
// offering a real typeface here would silently fall back to something else in most inboxes.
// "sans" stays Helvetica to match the product's own locked typography.
const FONT_STACKS: Record<EmailFontFamily, string> = {
  sans: "Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
};

const HEADING_SIZES: Record<EmailTextSize, number> = { small: 20, medium: 24, large: 30 };
const BODY_SIZES: Record<EmailTextSize, number> = { small: 14, medium: 15, large: 17 };
const DENSITY_SCALE: Record<EmailDensity, number> = { compact: 0.7, normal: 1, relaxed: 1.35 };

/** Two fixed palettes rather than a prefers-color-scheme media query.
 *
 *  Email clients handle colour-scheme wildly inconsistently — Gmail and Outlook both apply
 *  their own auto-inversion that a sender cannot predict or opt out of reliably. Shipping a
 *  real, explicitly-chosen palette renders the same everywhere, which is what a merchant
 *  picking "dark" actually wants. The colour-scheme meta tags in <Head> below ask the
 *  better-behaved clients not to invert on top of our choice. */
const PALETTES: Record<EmailTheme, {
  background: string;
  text: string;
  muted: string;
  faint: string;
  hairline: string;
  cardBackground: string;
}> = {
  light: {
    background: "#ffffff",
    text: "#111111",
    muted: "#4a4a4a",
    faint: "#a0a0a0",
    hairline: "#eeeeee",
    cardBackground: "#fafafa",
  },
  dark: {
    background: "#0e0e10",
    text: "#f4f4f5",
    muted: "#c3c3c7",
    faint: "#8b8b93",
    hairline: "#2a2a2e",
    cardBackground: "#18181b",
  },
};

/** Merchant copy is a textarea, so a blank line means a new paragraph. Rendering the raw
 *  string would collapse all of it onto one line in HTML, which is why the shipped defaults
 *  (which are deliberately multi-paragraph) need this. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** Single-newline runs inside one paragraph stay as line breaks — a sign-off is usually
 *  "Thanks,\nStore Name" and should not become one run-on line. */
function withLineBreaks(paragraph: string) {
  const lines = paragraph.split("\n");
  return lines.map((line, index) => (
    <span key={index}>
      {line}
      {index < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

// Renders every merchant-editable value as a prop from Email Studio (app.email-studio.tsx)
// via templates.server.tsx. This file owns layout/markup only — never copy, colour defaults
// or plan rules (those live in email.shared.ts, the single source of truth both the editor
// and the real send path read).
export function ReviewRequestEmail({
  previewText,
  heading,
  bodyText,
  closingText,
  buttonText,
  accentColor,
  buttonTextColor,
  theme,
  fontFamily,
  headingSize,
  bodySize,
  density,
  contentWidth,
  cornerRadius,
  buttonStyle,
  buttonAlign,
  logoUrl,
  logoDarkUrl,
  logoWidth,
  storeName,
  showStoreName,
  showPoweredBy,
  productName,
  productImageUrl,
  sections,
  customHtml,
  reviewUrl,
  unsubscribeUrl,
}: ReviewRequestEmailProps) {
  const palette = PALETTES[theme];
  const font = FONT_STACKS[fontFamily];
  const scale = DENSITY_SCALE[density];
  const gap = (base: number) => `${Math.round(base * scale)}px`;
  const effectiveLogo = theme === "dark" ? logoDarkUrl || logoUrl : logoUrl;

  const blocks: Record<string, React.ReactNode> = {
    logo: effectiveLogo ? (
      // Capped by width with height auto, so a non-square wordmark is never stretched. No
      // fallback mark is rendered when a merchant has not uploaded one: this is the email's
      // primary above-the-fold branding position, and putting Imagyn's own icon here made an
      // unbranded email read as "sent by Imagyn", not "sent by the store".
      <Section key="logo" style={{ paddingBottom: gap(24) }}>
        <Img
          src={effectiveLogo}
          width={String(logoWidth)}
          alt={storeName}
          style={{ maxHeight: `${Math.round(logoWidth * 1.5)}px`, height: "auto" }}
        />
      </Section>
    ) : null,

    storeName: showStoreName ? (
      <Section key="storeName" style={{ paddingBottom: gap(32) }}>
        <Text
          style={{
            margin: 0,
            fontSize: "13px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: palette.faint,
          }}
        >
          {storeName}
        </Text>
      </Section>
    ) : null,

    heading: (
      <Section key="heading" style={{ paddingBottom: gap(16) }}>
        <Text
          style={{
            margin: 0,
            fontSize: `${HEADING_SIZES[headingSize]}px`,
            lineHeight: "1.35",
            fontWeight: 600,
            color: palette.text,
          }}
        >
          {heading}
        </Text>
      </Section>
    ),

    body: (
      <Section key="body" style={{ paddingBottom: gap(32) }}>
        {paragraphsOf(bodyText).map((paragraph, index, all) => (
          <Text
            key={index}
            style={{
              margin: 0,
              marginBottom: index < all.length - 1 ? gap(14) : 0,
              fontSize: `${BODY_SIZES[bodySize]}px`,
              lineHeight: "1.6",
              color: palette.muted,
            }}
          >
            {withLineBreaks(paragraph)}
          </Text>
        ))}
      </Section>
    ),

    // Rendered only when this send genuinely has a product. Nothing here is invented: no
    // placeholder image, no "your recent order" stand-in for a missing name.
    product: productName ? (
      <Section
        key="product"
        style={{
          paddingBottom: gap(32),
        }}
      >
        <table
          role="presentation"
          cellPadding={0}
          cellSpacing={0}
          style={{
            width: "100%",
            backgroundColor: palette.cardBackground,
            borderRadius: `${cornerRadius}px`,
          }}
        >
          <tbody>
            <tr>
              {productImageUrl ? (
                <td style={{ width: "64px", padding: "14px 0 14px 14px", verticalAlign: "middle" }}>
                  <Img
                    src={productImageUrl}
                    width="56"
                    height="56"
                    alt=""
                    style={{ borderRadius: `${Math.max(0, cornerRadius - 2)}px`, objectFit: "cover" }}
                  />
                </td>
              ) : null}
              <td style={{ padding: "14px", verticalAlign: "middle" }}>
                <Text style={{ margin: 0, fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase", color: palette.faint }}>
                  Your purchase
                </Text>
                <Text style={{ margin: 0, marginTop: "3px", fontSize: "14px", fontWeight: 600, color: palette.text }}>
                  {productName}
                </Text>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
    ) : null,

    button: (
      <Section key="button" style={{ paddingBottom: gap(40), textAlign: buttonAlign }}>
        <Button
          href={reviewUrl}
          style={{
            backgroundColor: buttonStyle === "filled" ? accentColor : "transparent",
            border: buttonStyle === "outline" ? `1px solid ${accentColor}` : "none",
            color: buttonStyle === "filled" ? buttonTextColor : accentColor,
            textDecoration: "none",
            fontSize: "15px",
            fontWeight: 600,
            padding: "14px 28px",
            borderRadius: `${cornerRadius}px`,
          }}
        >
          {buttonText}
        </Button>
      </Section>
    ),

    closing: closingText.trim() ? (
      <Section key="closing" style={{ paddingBottom: gap(32) }}>
        {paragraphsOf(closingText).map((paragraph, index) => (
          <Text
            key={index}
            style={{
              margin: 0,
              fontSize: `${BODY_SIZES[bodySize]}px`,
              lineHeight: "1.6",
              color: palette.muted,
            }}
          >
            {withLineBreaks(paragraph)}
          </Text>
        ))}
      </Section>
    ) : null,
  };

  return (
    <Html lang="en">
      <Head>
        {/* Asks well-behaved clients not to apply their own inversion on top of the palette
            the merchant deliberately chose. Clients that ignore it (Gmail) will still do
            their own thing — which is exactly why the palettes above are explicit rather
            than a prefers-color-scheme query. */}
        <meta name="color-scheme" content={theme} />
        <meta name="supported-color-schemes" content={theme} />
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: palette.background, fontFamily: font }}>
        <Container style={{ maxWidth: `${contentWidth}px`, padding: `${gap(56)} 24px` }}>
          {customHtml ? (
            // Pre-sanitized upstream (emailSanitize.server.ts) on both save and send. The
            // compliance footer below still renders, so switching to custom HTML cannot drop
            // the unsubscribe line or the attribution.
            // A plain <div>, not React Email's <Section>: that component renders its own
            // children (a table wrapper), and React refuses to accept both children and
            // dangerouslySetInnerHTML on the same element — which crashed every custom-HTML
            // send until a render test caught it.
            <div
              style={{ paddingBottom: gap(32), color: palette.text, fontSize: `${BODY_SIZES[bodySize]}px` }}
              dangerouslySetInnerHTML={{ __html: customHtml }}
            />
          ) : (
            sections.filter((section) => section.enabled).map((section) => blocks[section.id] ?? null)
          )}

          <Hr style={{ borderColor: palette.hairline, margin: 0 }} />

          <Section style={{ paddingTop: gap(20) }}>
            <Text style={{ margin: 0, fontSize: "12px", lineHeight: "1.6", color: palette.faint }}>
              {/* Custom HTML replaces the whole structured body, so there may be no button
                  above to refer to — in that mode this line is the email's guaranteed route
                  to the review form, and it has to describe itself accordingly. */}
              {customHtml
                ? "Leave your review here:"
                : "If the button above doesn't work, copy and paste this link into your browser:"}
              <br />
              <a href={reviewUrl} style={{ color: palette.faint }}>
                {reviewUrl}
              </a>
            </Text>
          </Section>

          {unsubscribeUrl ? (
            <Section style={{ paddingTop: gap(12) }}>
              <Text style={{ margin: 0, fontSize: "12px", lineHeight: "1.6", color: palette.faint }}>
                <a href={unsubscribeUrl} style={{ color: palette.faint }}>
                  Unsubscribe
                </a>{" "}
                from future emails like this.
              </Text>
            </Section>
          ) : null}

          {/* One small, quiet line — the merchant's own branding above does all the real
              work; this is attribution, not a second ad. The mark is tiny and sits only in
              this footer, never in the header's primary branding position, so it can never
              read as "this email is from Imagyn". Real Pro-gated removal (showPoweredBy),
              enforced server-side in email.shared.ts, not just hidden in the editor. */}
          {showPoweredBy ? (
            <Section style={{ paddingTop: gap(20) }}>
              <Text style={{ margin: 0, fontSize: "11px", lineHeight: "1.5", color: palette.faint }}>
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
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
