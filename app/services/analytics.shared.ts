// Pure, client-safe pieces of the Analytics contract — no Prisma/db import, so this can be
// imported directly by app.analytics.tsx's default-exported component (which runs on both
// server SSR and the client), unlike analytics.server.ts. Same split as email.shared.ts vs
// notifications/templates.server.tsx, widget.shared.ts vs widget.server.ts, etc.

export type AnalyticsDateRange = "7d" | "30d" | "90d" | "all";

export const ANALYTICS_DATE_RANGES: Array<{ value: AnalyticsDateRange; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const isValidAnalyticsDateRange = (value: string | null): value is AnalyticsDateRange =>
  ANALYTICS_DATE_RANGES.some((option) => option.value === value);
