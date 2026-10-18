// Shared Email Branding — the one place that decides which logo an email renders.
//
// The problem this exists to solve: the logo used to live only inside each
// EmailTemplate.content JSON, so a merchant had to upload it separately for the review
// request, both reminders and the reward email, and changing it left stale URLs behind in
// whichever templates they forgot. Judge.me and Loox both solve this with global branding
// applied to every email (see docs/EMAIL_EXPERIENCE_AUDIT.md), and this is that layer.
//
// Resolution order, for both the live preview and the real send — there is deliberately
// only ONE implementation so the two cannot drift:
//
//   1. logoSource === "custom"  -> the template's own logoUrl/logoDarkUrl.
//   2. otherwise                -> the store's shared emailLogoUrl/emailLogoDarkUrl.
//   3. dark palette with no dark asset -> fall back to the light asset.
//   4. nothing configured       -> null, and the renderer shows the text brand header.
import type { EmailTemplateContent } from "./email.shared";

export interface SharedEmailBranding {
  emailLogoUrl: string | null;
  emailLogoDarkUrl: string | null;
}

export interface ResolvedEmailLogo {
  /** The light-palette asset, or null when nothing is configured. */
  logoUrl: string | null;
  /** The dark-palette asset. Null means "reuse logoUrl", matching the renderer's own rule. */
  logoDarkUrl: string | null;
  /** True when this template is following the store's shared branding. */
  inheritsShared: boolean;
}

/**
 * Which logo this template should render.
 *
 * A template that overrides but has no asset of its own is treated as having no logo rather
 * than quietly falling back to the shared one — an explicit override saying "not the shared
 * logo" must not be reinterpreted as "the shared logo".
 */
export function resolveEmailLogo(
  content: Pick<EmailTemplateContent, "logoUrl" | "logoDarkUrl" | "logoSource">,
  branding: SharedEmailBranding | null,
): ResolvedEmailLogo {
  if (content.logoSource === "custom") {
    return { logoUrl: content.logoUrl, logoDarkUrl: content.logoDarkUrl, inheritsShared: false };
  }

  return {
    logoUrl: branding?.emailLogoUrl ?? null,
    logoDarkUrl: branding?.emailLogoDarkUrl ?? null,
    inheritsShared: true,
  };
}

/**
 * The asset actually painted for a given palette.
 *
 * Mirrors ReviewRequestEmail's own `theme === "dark" ? logoDarkUrl || logoUrl : logoUrl`
 * rule, exposed here so the preview and any status copy can answer "what will the customer
 * see?" without duplicating that condition.
 */
export function logoForTheme(resolved: ResolvedEmailLogo, theme: "light" | "dark"): string | null {
  return theme === "dark" ? resolved.logoDarkUrl || resolved.logoUrl : resolved.logoUrl;
}
