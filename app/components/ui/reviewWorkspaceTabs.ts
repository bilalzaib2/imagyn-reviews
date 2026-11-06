// The Reviews workspace's own tab set, shared by the three pages that belong to it so they
// cannot drift into showing different navigation from one another.
//
// All three routes are real. Customer Questions was deliberately absent until 2026-11-07,
// because a tab that navigates nowhere is worse than its absence; it was added once the
// Question model, question.server.ts and /app/questions existed to stand behind it.
import type { WorkspaceTab } from "./WorkspaceTabs";

export const REVIEW_WORKSPACE_TABS: readonly WorkspaceTab[] = [
  { label: "Reviews", to: "/app/reviews" },
  { label: "Review Requests", to: "/app/requests" },
  { label: "Customer Questions", to: "/app/questions" },
];
