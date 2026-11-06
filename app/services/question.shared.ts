// Shared between the server service and any client that renders a question, so neither
// imports the other's module graph. Mirrors review.shared.ts.

export const QuestionStatus = {
  PENDING: "PENDING",
  PUBLISHED: "PUBLISHED",
  REJECTED: "REJECTED",
} as const;

export type QuestionStatus = (typeof QuestionStatus)[keyof typeof QuestionStatus];

/** The three merchant-facing views, matching the benchmark's tabs. */
export const QUESTION_TABS = [
  { id: "", label: "All questions" },
  { id: "answered", label: "With answers" },
  { id: "unanswered", label: "Without answers" },
] as const;

export type QuestionTabId = (typeof QUESTION_TABS)[number]["id"];

/** Maps a tab id to the `answered` filter. undefined means "both". */
export function answeredFilterForTab(tab: string): boolean | undefined {
  if (tab === "answered") return true;
  if (tab === "unanswered") return false;
  return undefined;
}
