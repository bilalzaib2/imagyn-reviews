// The Reviews workspace's own tab set, shared by the two pages that belong to it so they
// cannot drift into showing different navigation from one another.
//
// Both routes are real and both already existed; this only names them in one place. Product
// Q&A ("Customer Questions") is deliberately absent — see WorkspaceTabs for why.
import type { WorkspaceTab } from "./WorkspaceTabs";

export const REVIEW_WORKSPACE_TABS: readonly WorkspaceTab[] = [
  { label: "Reviews", to: "/app/reviews" },
  { label: "Review Requests", to: "/app/requests" },
];
