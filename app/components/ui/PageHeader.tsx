import type { ReactNode } from "react";
import shellStyles from "../../styles/app.shell.module.css";

type PageHeaderProps = {
  /** Defaults to "Imagyn Reviews" — the eyebrow every page already used. Pass a
   *  <SettingsBreadcrumb> element instead for the six pages reached from the Settings sidebar
   *  that need breadcrumb context (see that component's own header comment for why). */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

// Consolidates the header markup eight separate route files repeated verbatim
// (<header className={shellStyles.header}><div className={shellStyles.headerContent}>...).
// Uses the exact same app.shell.module.css classes those pages already shared — this is a
// component wrapper around an existing pattern, not a new visual language.
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className={shellStyles.header}>
      <div className={shellStyles.headerContent}>
        <p className={shellStyles.eyebrow}>{eyebrow ?? "Imagyn Reviews"}</p>
        <h1 className={shellStyles.title}>{title}</h1>
        {description ? <p className={shellStyles.subtitle}>{description}</p> : null}
      </div>
      {actions ? <div className={shellStyles.headerActions}>{actions}</div> : null}
    </header>
  );
}
