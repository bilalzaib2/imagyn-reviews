import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { handleTopLevelNavigate } from "./topLevelNavigate";
import buttonStyles from "./button.module.css";
import styles from "./action-card.module.css";

type ActionCardProps = {
  title: string;
  description: ReactNode;
  action: { label: string; href: string };
  badge?: ReactNode;
};

// A real, clickable feature entry — title + one-line description + a single obvious action —
// replacing bare text links wherever a Settings/Overview page needs to say "here's a thing
// you can configure."
//
// Deliberately a real <button onClick>, NOT an <a href> (this component's own history: it used
// to be a real anchor, on the theory that "a real anchor/window.location" is what every
// navigation in this app needs — true for the window.location part, false for the anchor part).
// app.settings.tsx's sidebar already discovered and documented the actual failure mode: App
// Bridge intercepts a same-origin anchor click in this iframe *before* any of the anchor's own
// handler code (native or scripted) ever runs — confirmed there by comparing against production
// request logs, which showed zero second HTTP request at all on click. A bare href with no
// onClick is worse (no chance to intervene at all), but even an onClick={preventDefault +
// navigate} on an <a> doesn't help, because App Bridge's interception happens first. The fix
// proven there — and applied here for exactly the same reason — is removing anchor semantics
// entirely: a <button> has nothing for App Bridge's click interception to match against, so
// window.location.assign runs as a real, un-intercepted top-level navigation. Appends the
// current query string itself (host/shop/embedded/session params) so every caller gets that
// correctness for free instead of having to remember it per call site.
export function ActionCard({ title, description, action, badge }: ActionCardProps) {
  const location = useLocation();

  return (
    <div className={styles.card}>
      <div className={styles.copy}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{title}</h3>
          {badge}
        </div>
        <p className={styles.description}>{description}</p>
      </div>
      <button
        type="button"
        onClick={(event) => handleTopLevelNavigate(event, action.href, location.search)}
        className={`${buttonStyles.button} ${buttonStyles.secondary} ${styles.actionButton}`}
      >
        {action.label}
      </button>
    </div>
  );
}
