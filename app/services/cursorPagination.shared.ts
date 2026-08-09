// Pure page-number/cursor-stack math, shared by every cursor-paginated list in this app
// (app.reviews.tsx, app.products.tsx) — split out from the route components so it's
// unit-testable without React, and so each new paginated list reuses the same tested logic
// instead of re-implementing it.
//
// The core idea: cursor-based data fetching stays cursor-based all the way through (no
// offset/skip query, however deep the merchant pages) — but a page number and a reliable
// multi-hop Previous need more than a single "cursor" scalar can express. `history` is a
// stack of every cursor visited to reach the current page: history.length is always
// (current page - 1), and history[i] is the exact cursor that fetched page i+2. Previous pops
// the stack (restoring the exact cursor used to reach the prior page — not a guess); Next
// pushes the current page's own nextCursor.
export function parseCursorHistory(historyParam: string | null): string[] {
  if (!historyParam) return [];
  return historyParam.split(",").filter(Boolean);
}

export function serializeCursorHistory(history: string[]): string {
  return history.join(",");
}

export function pageNumberFor(history: string[]): number {
  return history.length + 1;
}

export function totalPagesFor(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

// The cursor to actually query with for the page `history` currently represents — undefined
// for page 1.
export function currentCursorFor(history: string[]): string | undefined {
  return history.length > 0 ? history[history.length - 1] : undefined;
}

export function historyForNextPage(history: string[], nextCursor: string): string[] {
  return [...history, nextCursor];
}

export function historyForPreviousPage(history: string[]): string[] {
  return history.slice(0, -1);
}

export interface ReviewRange {
  start: number;
  end: number;
}

// `pageItemCount` is the ACTUAL number of rows the current page returned (not assumed to
// always equal pageSize) — the last page is very likely to have fewer, and this stays correct
// even if rows were added/removed between page loads.
export function rangeFor(currentPage: number, pageSize: number, totalCount: number, pageItemCount: number): ReviewRange {
  if (totalCount === 0) {
    return { start: 0, end: 0 };
  }
  const start = (currentPage - 1) * pageSize + 1;
  const end = start + pageItemCount - 1;
  return { start, end };
}
