// Product and store Q&A — creation, answering, moderation, tenant isolation and the edges.
//
// The storefront consequences are what make these worth pinning: an unanswered question
// escaping onto a product page advertises an unanswered doubt to every future shopper, and a
// question id from another store must reveal nothing at all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionStatus, answeredFilterForTab, QUESTION_TABS } from "./question.shared";

const question = {
  id: "q_1",
  storeId: "store_1",
  productId: "prod_1",
  productTitle: "Brown Ceramic Plate",
  askerName: "Dana",
  askerEmail: "dana@example.com",
  body: "Is this dishwasher safe?",
  answer: null as string | null,
  answeredAt: null as Date | null,
  status: QuestionStatus.PENDING,
  deletedAt: null,
};

const qFindFirst = vi.fn();
const qFindMany = vi.fn();
const qCreate = vi.fn();
const qUpdate = vi.fn();
const qCount = vi.fn();
const pFindFirst = vi.fn();

vi.mock("../db.server", () => ({
  default: {
    question: {
      get findFirst() {
        return qFindFirst;
      },
      get findMany() {
        return qFindMany;
      },
      get create() {
        return qCreate;
      },
      get update() {
        return qUpdate;
      },
      get count() {
        return qCount;
      },
    },
    product: {
      get findFirst() {
        return pFindFirst;
      },
    },
  },
}));

const svc = await import("./question.server");

const lastCreateData = () => qCreate.mock.calls[0][0].data;
const lastUpdateData = () => qUpdate.mock.calls[0][0].data;
const lastFindManyWhere = () => qFindMany.mock.calls[0][0].where;

beforeEach(() => {
  [qFindFirst, qFindMany, qCreate, qUpdate, qCount, pFindFirst].forEach((fn) => fn.mockReset());
  qFindFirst.mockResolvedValue(question);
  qFindMany.mockResolvedValue([]);
  qCreate.mockResolvedValue(question);
  qUpdate.mockResolvedValue(question);
  qCount.mockResolvedValue(0);
  pFindFirst.mockResolvedValue({ id: "prod_1", name: "Brown Ceramic Plate" });
});

describe("asking a question", () => {
  it("stores the question against the store and product", async () => {
    await svc.createQuestion("store_1", { productId: "prod_1", askerName: "Dana", body: "Is this dishwasher safe?" });

    const data = lastCreateData();
    expect(data.storeId).toBe("store_1");
    expect(data.productId).toBe("prod_1");
    expect(data.body).toBe("Is this dishwasher safe?");
  });

  it("starts PENDING, so nothing reaches the storefront unreviewed", async () => {
    await svc.createQuestion("store_1", { askerName: "Dana", body: "A perfectly ordinary question?" });
    // The column default carries this; the service must not override it.
    expect(lastCreateData().status).toBeUndefined();
  });

  it("denormalises the product title so it survives the product being deleted", async () => {
    await svc.createQuestion("store_1", { productId: "prod_1", askerName: "Dana", body: "Dishwasher safe?" });
    expect(lastCreateData().productTitle).toBe("Brown Ceramic Plate");
  });

  it("allows a store-level question with no product", async () => {
    await svc.createQuestion("store_1", { askerName: "Dana", body: "Do you ship internationally?" });
    expect(lastCreateData().productId).toBeNull();
    expect(pFindFirst).not.toHaveBeenCalled();
  });

  it("trims whitespace from the body and name", async () => {
    await svc.createQuestion("store_1", { askerName: "  Dana  ", body: "  Is it heavy?  " });
    expect(lastCreateData().body).toBe("Is it heavy?");
    expect(lastCreateData().askerName).toBe("Dana");
  });

  it.each([["an empty body", ""], ["a whitespace-only body", "   "]])("rejects %s", async (_label, body) => {
    await expect(svc.createQuestion("store_1", { askerName: "Dana", body })).rejects.toThrow("cannot be empty");
    expect(qCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing name", async () => {
    await expect(svc.createQuestion("store_1", { askerName: "  ", body: "Valid question?" })).rejects.toThrow(
      "Name is required.",
    );
  });

  it("rejects a body beyond the length limit", async () => {
    await expect(
      svc.createQuestion("store_1", { askerName: "Dana", body: "x".repeat(2001) }),
    ).rejects.toThrow("cannot be longer than");
  });

  it("stores no email when none is given", async () => {
    await svc.createQuestion("store_1", { askerName: "Dana", body: "Valid question?" });
    expect(lastCreateData().askerEmail).toBeNull();
  });

  it("refuses a product belonging to another store", async () => {
    pFindFirst.mockResolvedValue(null);
    await expect(
      svc.createQuestion("store_1", { productId: "prod_other", askerName: "Dana", body: "Valid question?" }),
    ).rejects.toThrow("Product not found.");
    expect(qCreate).not.toHaveBeenCalled();
  });

  it("scopes the product check to the asking store", async () => {
    await svc.createQuestion("store_1", { productId: "prod_1", askerName: "Dana", body: "Valid question?" });
    expect(pFindFirst.mock.calls[0][0].where).toMatchObject({ id: "prod_1", storeId: "store_1" });
  });
});

describe("answering", () => {
  it("saves the answer, stamps it and publishes", async () => {
    await svc.answerQuestion("store_1", "q_1", "Yes, it is dishwasher safe.");

    const data = lastUpdateData();
    expect(data.answer).toBe("Yes, it is dishwasher safe.");
    expect(data.answeredAt).toBeInstanceOf(Date);
    expect(data.status).toBe(QuestionStatus.PUBLISHED);
  });

  it("keeps the original answeredAt when an answer is reworded", async () => {
    // answeredAt is what the notification email keys off; re-stamping it would re-notify a
    // customer because the merchant fixed a typo.
    const first = new Date("2026-01-01T00:00:00Z");
    qFindFirst.mockResolvedValue({ ...question, answer: "Yes.", answeredAt: first });

    await svc.answerQuestion("store_1", "q_1", "Yes — it is dishwasher safe on the top rack.");
    expect(lastUpdateData().answeredAt).toBe(first);
  });

  it("clearing the answer unpublishes and unstamps it", async () => {
    qFindFirst.mockResolvedValue({ ...question, answer: "Yes.", answeredAt: new Date() });

    await svc.answerQuestion("store_1", "q_1", "   ");

    const data = lastUpdateData();
    expect(data.answer).toBeNull();
    expect(data.answeredAt).toBeNull();
    expect(data.status).toBe(QuestionStatus.PENDING);
  });

  it("clears any previous hide when answered", async () => {
    await svc.answerQuestion("store_1", "q_1", "Yes.");
    expect(lastUpdateData().hiddenReason).toBeNull();
    expect(lastUpdateData().hiddenAt).toBeNull();
  });

  it("rejects an answer beyond the length limit", async () => {
    await expect(svc.answerQuestion("store_1", "q_1", "x".repeat(4001))).rejects.toThrow("cannot be longer than");
  });
});

describe("moderation", () => {
  it("hiding records the reason and the time", async () => {
    await svc.hideQuestion("store_1", "q_1", "offensive");

    const data = lastUpdateData();
    expect(data.status).toBe(QuestionStatus.REJECTED);
    expect(data.hiddenReason).toBe("offensive");
    expect(data.hiddenAt).toBeInstanceOf(Date);
  });

  it("will not store a reason it does not offer", async () => {
    await svc.hideQuestion("store_1", "q_1", "because I said so");
    expect(lastUpdateData().hiddenReason).toBeNull();
  });

  it("publishing clears the hide record", async () => {
    await svc.publishQuestion("store_1", "q_1");

    const data = lastUpdateData();
    expect(data.status).toBe(QuestionStatus.PUBLISHED);
    expect(data.hiddenReason).toBeNull();
    expect(data.hiddenAt).toBeNull();
  });

  it("deleting is soft, so the row survives for audit", async () => {
    await svc.deleteQuestion("store_1", "q_1");
    expect(lastUpdateData().deletedAt).toBeInstanceOf(Date);
  });
});

describe("tenant isolation", () => {
  it.each([
    ["answerQuestion", () => svc.answerQuestion("store_2", "q_1", "Yes.")],
    ["publishQuestion", () => svc.publishQuestion("store_2", "q_1")],
    ["hideQuestion", () => svc.hideQuestion("store_2", "q_1", "spam")],
    ["deleteQuestion", () => svc.deleteQuestion("store_2", "q_1")],
  ])("%s refuses another store's question", async (_label, call) => {
    qFindFirst.mockResolvedValue(null);
    await expect(call()).rejects.toThrow("Question not found.");
    expect(qUpdate).not.toHaveBeenCalled();
  });

  it("gives a cross-tenant id the same error as a bogus one", async () => {
    qFindFirst.mockResolvedValue(null);
    const cross = await svc.publishQuestion("store_2", "q_1").catch((e: Error) => e.message);
    const bogus = await svc.publishQuestion("store_1", "nope").catch((e: Error) => e.message);
    expect(cross).toBe(bogus);
  });

  it("scopes every list query by store", async () => {
    await svc.getStoreQuestions("store_1");
    expect(lastFindManyWhere()).toMatchObject({ storeId: "store_1", deletedAt: null });
  });
});

describe("the storefront view", () => {
  it("shows only published AND answered questions", async () => {
    await svc.getPublicQuestions("prod_1");

    const where = lastFindManyWhere();
    expect(where.status).toBe(QuestionStatus.PUBLISHED);
    expect(where.answeredAt).toEqual({ not: null });
    expect(where.deletedAt).toBeNull();
  });

  it("never exposes the asker's email", async () => {
    await svc.getPublicQuestions("prod_1");
    expect(Object.keys(qFindMany.mock.calls[0][0].select)).not.toContain("askerEmail");
  });
});

describe("tabs and counts", () => {
  it("maps each tab to the right filter", () => {
    expect(answeredFilterForTab("")).toBeUndefined();
    expect(answeredFilterForTab("answered")).toBe(true);
    expect(answeredFilterForTab("unanswered")).toBe(false);
    expect(answeredFilterForTab("nonsense")).toBeUndefined();
  });

  it("offers exactly the benchmark's three views", () => {
    expect(QUESTION_TABS.map((t) => t.label)).toEqual(["All questions", "With answers", "Without answers"]);
  });

  it("derives unanswered by subtraction, so the three always reconcile", async () => {
    qCount.mockResolvedValueOnce(10).mockResolvedValueOnce(4);
    const counts = await svc.getStoreQuestionCounts("store_1");
    expect(counts).toEqual({ all: 10, answered: 4, unanswered: 6 });
  });

  it("ignores the answered filter when counting, so no tab reads zero", async () => {
    await svc.getStoreQuestionCounts("store_1", { answered: true });
    expect(qCount.mock.calls[0][0].where.answeredAt).toBeUndefined();
  });

  it("keeps every other filter while counting", async () => {
    await svc.getStoreQuestionCounts("store_1", { search: "shipping" });
    expect(JSON.stringify(qCount.mock.calls[0][0].where)).toContain("shipping");
  });
});
