// Unit tests for the cursor-stack pagination math — specifically covering the bug the old
// single-scalar `prevCursor` had: Next, Next, Previous used to strand the merchant on page 2
// with Previous now disabled, unable to get back to page 1. These tests simulate that exact
// sequence (and deeper ones) purely against the stack functions, no React/DOM involved.
import { describe, expect, it } from "vitest";
import {
  currentCursorFor,
  historyForNextPage,
  historyForPreviousPage,
  pageNumberFor,
  parseCursorHistory,
  rangeFor,
  serializeCursorHistory,
  totalPagesFor,
} from "./cursorPagination.shared";

describe("parseCursorHistory / serializeCursorHistory", () => {
  it("parses an empty/null param as page 1 (no history)", () => {
    expect(parseCursorHistory(null)).toEqual([]);
    expect(parseCursorHistory("")).toEqual([]);
  });

  it("round-trips a serialized history", () => {
    const history = ["cursor_a", "cursor_b", "cursor_c"];
    expect(parseCursorHistory(serializeCursorHistory(history))).toEqual(history);
  });
});

describe("pageNumberFor / currentCursorFor", () => {
  it("page 1 has no history and no cursor", () => {
    expect(pageNumberFor([])).toBe(1);
    expect(currentCursorFor([])).toBeUndefined();
  });

  it("page number is history length + 1, cursor is the last stack entry", () => {
    expect(pageNumberFor(["c1"])).toBe(2);
    expect(currentCursorFor(["c1"])).toBe("c1");

    expect(pageNumberFor(["c1", "c2", "c3"])).toBe(4);
    expect(currentCursorFor(["c1", "c2", "c3"])).toBe("c3");
  });
});

describe("historyForNextPage / historyForPreviousPage — the actual bug this replaces", () => {
  it("Next pushes the current page's nextCursor onto the stack", () => {
    let history: string[] = [];
    history = historyForNextPage(history, "cursor_page2");
    expect(history).toEqual(["cursor_page2"]);
    expect(pageNumberFor(history)).toBe(2);

    history = historyForNextPage(history, "cursor_page3");
    expect(history).toEqual(["cursor_page2", "cursor_page3"]);
    expect(pageNumberFor(history)).toBe(3);
  });

  it("Previous pops the stack, restoring the exact cursor used to reach the prior page", () => {
    const history = ["cursor_page2", "cursor_page3"];
    const back = historyForPreviousPage(history);
    expect(back).toEqual(["cursor_page2"]);
    expect(currentCursorFor(back)).toBe("cursor_page2");
    expect(pageNumberFor(back)).toBe(2);
  });

  it("Previous from page 2 returns to page 1 (empty history, no cursor)", () => {
    const history = ["cursor_page2"];
    const back = historyForPreviousPage(history);
    expect(back).toEqual([]);
    expect(currentCursorFor(back)).toBeUndefined();
    expect(pageNumberFor(back)).toBe(1);
  });

  it("Next, Next, Previous lands back on page 2 with a working Previous to page 1 (the old bug)", () => {
    let history: string[] = [];

    // Page 1 -> 2
    history = historyForNextPage(history, "cursor_page2");
    // Page 2 -> 3
    history = historyForNextPage(history, "cursor_page3");
    expect(pageNumberFor(history)).toBe(3);

    // Page 3 -> Previous -> should land on page 2, cursor restored to cursor_page2
    history = historyForPreviousPage(history);
    expect(pageNumberFor(history)).toBe(2);
    expect(currentCursorFor(history)).toBe("cursor_page2");

    // Critically: Previous must still work from here (this is exactly what broke before —
    // the old single `prevCursor` scalar got deleted on the first Previous, disabling the
    // button here even though the merchant is still on page 2, not page 1).
    history = historyForPreviousPage(history);
    expect(pageNumberFor(history)).toBe(1);
    expect(currentCursorFor(history)).toBeUndefined();
  });

  it("supports arbitrarily deep forward navigation and full backward unwinding", () => {
    let history: string[] = [];
    for (let i = 2; i <= 20; i += 1) {
      history = historyForNextPage(history, `cursor_page${i}`);
    }
    expect(pageNumberFor(history)).toBe(20);

    for (let page = 19; page >= 1; page -= 1) {
      history = historyForPreviousPage(history);
      expect(pageNumberFor(history)).toBe(page);
    }
    expect(history).toEqual([]);
  });
});

describe("totalPagesFor", () => {
  it("computes total pages from count and page size, minimum 1", () => {
    expect(totalPagesFor(0, 25)).toBe(1);
    expect(totalPagesFor(1, 25)).toBe(1);
    expect(totalPagesFor(25, 25)).toBe(1);
    expect(totalPagesFor(26, 25)).toBe(2);
    expect(totalPagesFor(2517, 25)).toBe(101);
  });
});

describe("rangeFor", () => {
  it("returns 0-0 for an empty result set", () => {
    expect(rangeFor(1, 25, 0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("computes the correct range for a full first page", () => {
    expect(rangeFor(1, 25, 2517, 25)).toEqual({ start: 1, end: 25 });
  });

  it("computes the correct range for a middle page", () => {
    expect(rangeFor(3, 25, 2517, 25)).toEqual({ start: 51, end: 75 });
  });

  it("computes the correct range for a partial final page (2,517 reviews / 25 per page)", () => {
    // 2517 / 25 = 100 full pages (2500 reviews) + a 101st page with the remaining 17.
    expect(rangeFor(101, 25, 2517, 17)).toEqual({ start: 2501, end: 2517 });
  });
});
