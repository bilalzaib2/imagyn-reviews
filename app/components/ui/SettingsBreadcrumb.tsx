import { Link } from "react-router";
import shellStyles from "../../styles/app.shell.module.css";
import styles from "./settings-breadcrumb.module.css";

// Replaces the generic "Imagyn Reviews" eyebrow on pages that are reached from the Settings
// sidebar (app.settings.tsx) but, for real, pre-existing URL-compatibility reasons, aren't
// nested React Router children of it — Email Studio, Product Management, Widgets, Brand
// Studio, Medals, Plan & Billing all live at their own top-level route. That split is exactly
// why the Settings sidebar itself disappears when a merchant follows one of those links: this
// is the low-risk fix (a real link back, not a cosmetic label) rather than restructuring those
// six routes' URLs, which would be a much larger change for the same practical outcome.
export function SettingsBreadcrumb({ current }: { current: string }) {
  return (
    <p className={shellStyles.eyebrow}>
      <Link to="/app/settings" className={styles.link}>Settings</Link> &rsaquo; {current}
    </p>
  );
}
