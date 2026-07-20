export const ReviewStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

export const HelpfulVoteValue = {
  HELPFUL: "HELPFUL",
  NOT_HELPFUL: "NOT_HELPFUL",
} as const;

export type HelpfulVoteValue = (typeof HelpfulVoteValue)[keyof typeof HelpfulVoteValue];
