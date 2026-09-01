import shellStyles from "../../styles/app.shell.module.css";
import styles from "./settings-breadcrumb.module.css";

// Replaces the generic "Imagyn Reviews" eyebrow on pages that are reached from the Settings
// sidebar (app.settings.tsx) but, for real, pre-existing URL-compatibility reasons, aren't
// nested React Router children of it — Email Studio, Product Management, Widgets, Brand
// Studio, Medals, Plan & Billing all live at their own top-level route. That split is exactly
// why the Settings sidebar itself disappears when a merchant follows one of those links: this
// is the low-risk fix (a real link back, not a cosmetic label) rather than restructuring those
// six routes' URLs, which would be a much larger change for the same practical outcome.
//
// Plain <a>, not React Router's <Link> — same reason app.settings.tsx's own sidebar uses real
// anchors: a client-side pushState here is exactly the kind of history change Shopify's
// embedded shell silently reverts once it doesn't recognize the resulting URL (see
// app.settings.tsx's own header comment on this). A real top-level navigation back to Settings
// has nothing for the shell to fight.
export function SettingsBreadcrumb({ current }: { current: string }) {
  return (
    <p className={shellStyles.eyebrow}>
      <a href="/app/settings" className={styles.link}>Settings</a> &rsaquo; {current}
    </p>
  );
}
