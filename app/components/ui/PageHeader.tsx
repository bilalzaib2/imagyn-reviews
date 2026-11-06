import type { ReactNode } from "react";
import shellStyles from "../../styles/app.shell.module.css";

type PageHeaderProps = {
  /**
   * Optional, and it has NO default any more.
   *
   * It used to default to "Imagyn Reviews", which printed the app's own name above the title
   * of every page inside the app — information the merchant already has from the Shopify
   * Admin chrome around the iframe, repeated on every screen. A label that is identical
   * everywhere carries no information and costs a line of vertical space on each page, so it
   * is now rendered only when a caller passes something real.
   *
   * In practice that means a <SettingsBreadcrumb>, on the pages reached from the Settings
   * sidebar, where the eyebrow genuinely says where you are.
   */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

// Consolidates the header markup eight separate route files repeated verbatim
// (<header className={shellStyles.header}><div className={shellStyles.headerContent}>...).
// Uses the exact same app.shell.module.css classes those pages already shared — this is a
// component wrapper around an existing pattern, not a new visual language.
//
// 2026-11-06: the "Imagyn Reviews" eyebrow it used to print on every page is gone. See the
// eyebrow prop for why.
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className={shellStyles.header}>
      <div className={shellStyles.headerContent}>
        {eyebrow ? <p className={shellStyles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={shellStyles.title}>{title}</h1>
        {description ? <p className={shellStyles.subtitle}>{description}</p> : null}
      </div>
      {actions ? <div className={shellStyles.headerActions}>{actions}</div> : null}
    </header>
  );
}
