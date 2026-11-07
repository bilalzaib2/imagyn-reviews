// Is our storefront widget actually on the merchant's published theme?
//
// WHY THIS IS NOT A SERVER CHECK, AND WHY THERE IS NO read_themes SCOPE
//
// The obvious route is to read `config/settings_data.json` from the published theme and look
// for our block. That needs the `read_themes` scope, and adding a scope forces every existing
// merchant to re-authorize before the app works again.
//
// App Bridge exposes `shopify.app.extensions()`, which reports activation status for this
// app's theme app extension blocks on the published theme and needs **no additional scopes**.
// Its one limitation — the data is only available while the app is open in the admin — is
// irrelevant here, because the only place the answer is shown is a screen the merchant is
// looking at.
//
// Status values are Shopify's own:
//   active       the block or embed is present in a theme
//   available    it exists but is not currently active
//   unavailable  it exists but is disabled, e.g. by an `available_if` condition
//
// Anything we cannot read becomes "unknown", never "not installed". Telling a merchant their
// widget is missing when we simply could not look is worse than saying nothing: they would go
// and re-add a block that is already there.

/** Shopify's ActivationStatus, plus our own "we could not find out". */
export type ThemeBlockStatus = "active" | "available" | "unavailable" | "unknown";

interface ThemeActivation {
  handle?: unknown;
  name?: unknown;
  target?: unknown;
  status?: unknown;
}

interface ExtensionInfo {
  handle?: unknown;
  type?: unknown;
  activations?: unknown;
}

export interface ThemeBlockSummary {
  status: ThemeBlockStatus;
  /** Display names of blocks currently in the theme. */
  active: string[];
  /** Display names of blocks that exist but are not in the theme. */
  inactive: string[];
}

const KNOWN_STATUSES = new Set(["active", "available", "unavailable"]);

function activationsOf(extension: ExtensionInfo): ThemeActivation[] {
  return Array.isArray(extension.activations) ? (extension.activations as ThemeActivation[]) : [];
}

function nameOf(activation: ThemeActivation, index: number): string {
  if (typeof activation.name === "string" && activation.name.trim()) return activation.name.trim();
  if (typeof activation.handle === "string" && activation.handle.trim()) return activation.handle.trim();
  return `Block ${index + 1}`;
}

/**
 * Reduces `shopify.app.extensions()` output to one answer about the storefront widget.
 *
 * Deliberately tolerant of the input: this comes from a platform API whose shape has already
 * changed once across App Bridge versions, and a thrown TypeError on a dashboard because a
 * field was renamed would be a far worse outcome than "unknown".
 */
export function summariseThemeBlocks(extensions: unknown): ThemeBlockSummary {
  if (!Array.isArray(extensions)) {
    return { status: "unknown", active: [], inactive: [] };
  }

  const themeExtensions = (extensions as ExtensionInfo[]).filter(
    (extension) => typeof extension === "object" && extension !== null && extension.type === "theme_app_extension",
  );

  const blocks = themeExtensions.flatMap((extension) =>
    activationsOf(extension).filter(
      (activation) =>
        // The null guard is load-bearing: a null entry in the array makes `activation.status`
        // throw, and a TypeError here would take down the whole dashboard.
        typeof activation === "object" &&
        activation !== null &&
        typeof activation.status === "string" &&
        KNOWN_STATUSES.has(activation.status),
    ),
  );

  // No theme extension reported at all. That is not evidence of absence — an older App Bridge
  // returns nothing here — so it stays unknown.
  if (blocks.length === 0) {
    return { status: "unknown", active: [], inactive: [] };
  }

  const active = blocks.filter((block) => block.status === "active").map(nameOf);
  const inactive = blocks.filter((block) => block.status !== "active").map(nameOf);

  // One active block is enough for reviews to appear, so the summary leads with the best
  // state any block achieved rather than the worst.
  const status: ThemeBlockStatus = active.length > 0
    ? "active"
    : blocks.some((block) => block.status === "available")
      ? "available"
      : "unavailable";

  return { status, active, inactive };
}

/** Merchant-facing wording. Never claims installation that was not observed. */
export function themeBlockStatusLabel(status: ThemeBlockStatus): string {
  switch (status) {
    case "active":
      return "Live on your theme";
    case "available":
      return "Not added to your theme yet";
    case "unavailable":
      return "Disabled in your theme";
    default:
      return "Theme status unavailable";
  }
}
