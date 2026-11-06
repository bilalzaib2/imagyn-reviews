// Product and store Q&A.
//
// Scope matches what the benchmark actually ships (see docs/JUDGEME_PARITY_AUDIT.md §11.13):
// a question has an asker, a body, an optional merchant answer and a published state. The
// moderation view is "answered or not". Everything else that will read questions — a product
// widget, a store FAQ page — reads this one table.
//
// TENANT ISOLATION
//
// Every function that touches a single question goes through requireQuestion, which resolves
// the id and the storeId in the SAME query and throws the same generic "Question not found."
// whether the id is bogus or belongs to another store. A caller cannot distinguish the two,
// so a question id from another store leaks nothing — the convention review.server.ts uses,
// and the one the tenant-isolation audit checks for.
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { parseReviewHideReason } from "./review.shared";
import { QuestionStatus } from "./question.shared";

export { QuestionStatus };

const questionInclude = {
  product: { select: { id: true, name: true } },
} satisfies Prisma.QuestionInclude;

export type QuestionWithProduct = Prisma.QuestionGetPayload<{ include: typeof questionInclude }>;

export interface QuestionQueryOptions {
  /** "" or undefined means every status. */
  status?: QuestionStatus;
  /** true = only answered, false = only unanswered, undefined = both. */
  answered?: boolean;
  search?: string;
  productId?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateQuestionInput {
  productId?: string | null;
  productTitle?: string | null;
  askerName: string;
  askerEmail?: string | null;
  body: string;
}

const BODY_MAX_LENGTH = 2000;
const ANSWER_MAX_LENGTH = 4000;
const NAME_MAX_LENGTH = 120;

/** Resolves a question within its store, or throws the same error a bogus id would. */
async function requireQuestion(storeId: string, id: string) {
  const existing = await prisma.question.findFirst({ where: { id, storeId, deletedAt: null } });

  if (!existing) {
    throw new Error("Question not found.");
  }

  return existing;
}

/** The filter clause shared by the list and its counts, so the two cannot drift. */
function buildQuestionWhere(storeId: string, options: QuestionQueryOptions = {}): Prisma.QuestionWhereInput {
  return {
    storeId,
    deletedAt: null,
    ...(options.status ? { status: options.status } : {}),
    ...(options.productId ? { productId: options.productId } : {}),
    // `answered` is derived from answeredAt, not from the answer text: an answer that was
    // edited to empty is still an answered question that the merchant then blanked, and
    // answeredAt is what the notification email keys off.
    ...(options.answered === true ? { answeredAt: { not: null } } : {}),
    ...(options.answered === false ? { answeredAt: null } : {}),
    ...(options.search
      ? {
          OR: [
            { body: { contains: options.search, mode: "insensitive" as const } },
            { answer: { contains: options.search, mode: "insensitive" as const } },
            { askerName: { contains: options.search, mode: "insensitive" as const } },
            { productTitle: { contains: options.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
}

export interface QuestionQueryResult {
  questions: QuestionWithProduct[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export async function getStoreQuestions(
  storeId: string,
  options: QuestionQueryOptions = {},
): Promise<QuestionQueryResult> {
  const limit = options.limit ?? 25;
  const where = buildQuestionWhere(storeId, options);

  const [totalCount, rows] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      include: questionInclude,
      // Unanswered first within each day would be nicer, but stable ordering matters more for
      // cursor pagination: newest first, id as the tie-break, exactly like reviews.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = rows.length > limit;
  const questions = hasMore ? rows.slice(0, limit) : rows;

  return {
    questions,
    nextCursor: hasMore && questions.length > 0 ? questions[questions.length - 1].id : null,
    hasMore,
    totalCount,
  };
}

export interface QuestionCounts {
  all: number;
  answered: number;
  unanswered: number;
}

/** Counts for the three tabs, in one query.
 *
 *  `answered` is deliberately dropped from the options for the same reason the review status
 *  counts drop `status`: a tab's count answers "how many will I see if I click this". */
export async function getStoreQuestionCounts(
  storeId: string,
  options: QuestionQueryOptions = {},
): Promise<QuestionCounts> {
  const where = buildQuestionWhere(storeId, { ...options, answered: undefined });

  const [all, answered] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.count({ where: { ...where, answeredAt: { not: null } } }),
  ]);

  return { all, answered, unanswered: all - answered };
}

export async function getStoreQuestion(storeId: string, id: string): Promise<QuestionWithProduct | null> {
  return prisma.question.findFirst({ where: { id, storeId, deletedAt: null }, include: questionInclude });
}

/** Records a shopper's question. Always PENDING: a question reaches the storefront only
 *  after a merchant publishes it, exactly as a review does. */
export async function createQuestion(storeId: string, input: CreateQuestionInput): Promise<QuestionWithProduct> {
  const body = input.body.trim();
  const askerName = input.askerName.trim();

  if (!body) throw new Error("Question cannot be empty.");
  if (body.length > BODY_MAX_LENGTH) throw new Error(`Question cannot be longer than ${BODY_MAX_LENGTH} characters.`);
  if (!askerName) throw new Error("Name is required.");

  // Verified in the same breath as the write: a productId from another store must not become
  // a question on this one.
  let productTitle = input.productTitle?.trim() || null;
  if (input.productId) {
    const product = await prisma.product.findFirst({
      where: { id: input.productId, storeId },
      select: { id: true, name: true },
    });

    if (!product) throw new Error("Product not found.");
    productTitle = productTitle ?? product.name;
  }

  return prisma.question.create({
    data: {
      storeId,
      productId: input.productId || null,
      productTitle,
      askerName: askerName.slice(0, NAME_MAX_LENGTH),
      askerEmail: input.askerEmail?.trim() || null,
      body,
    },
    include: questionInclude,
  });
}

/** Saves the merchant's answer.
 *
 *  Answering publishes: a merchant who has written a public answer has decided the question
 *  is fit to show, and making them press a second button is a step that only produces
 *  answered-but-invisible questions. Clearing the answer reverses both. */
export async function answerQuestion(storeId: string, id: string, answer: string): Promise<QuestionWithProduct> {
  const existing = await requireQuestion(storeId, id);
  const trimmed = answer.trim();

  if (trimmed.length > ANSWER_MAX_LENGTH) {
    throw new Error(`Answer cannot be longer than ${ANSWER_MAX_LENGTH} characters.`);
  }

  if (!trimmed) {
    return prisma.question.update({
      where: { id: existing.id },
      data: { answer: null, answeredAt: null, status: QuestionStatus.PENDING },
      include: questionInclude,
    });
  }

  return prisma.question.update({
    where: { id: existing.id },
    data: {
      answer: trimmed,
      // Preserved on an edit: answeredAt marks when the customer was first answered, which is
      // what the notification keys off, so rewording an answer must not re-trigger it.
      answeredAt: existing.answeredAt ?? new Date(),
      status: QuestionStatus.PUBLISHED,
      hiddenReason: null,
      hiddenAt: null,
    },
    include: questionInclude,
  });
}

export async function publishQuestion(storeId: string, id: string): Promise<QuestionWithProduct> {
  const existing = await requireQuestion(storeId, id);

  return prisma.question.update({
    where: { id: existing.id },
    data: { status: QuestionStatus.PUBLISHED, hiddenReason: null, hiddenAt: null },
    include: questionInclude,
  });
}

/** Hides a question, recording why — the same accountability record reviews keep. */
export async function hideQuestion(storeId: string, id: string, hideReason?: unknown): Promise<QuestionWithProduct> {
  const existing = await requireQuestion(storeId, id);

  return prisma.question.update({
    where: { id: existing.id },
    data: {
      status: QuestionStatus.REJECTED,
      hiddenReason: parseReviewHideReason(hideReason),
      hiddenAt: new Date(),
    },
    include: questionInclude,
  });
}

/** Soft delete, matching reviews — the row stays for audit and the Q&A export. */
export async function deleteQuestion(storeId: string, id: string): Promise<void> {
  const existing = await requireQuestion(storeId, id);
  await prisma.question.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
}

/** The storefront view: published, answered questions for one product, newest first.
 *
 *  Both conditions matter. An unanswered question on a product page is worse than none — it
 *  advertises an unanswered doubt to every future shopper. */
export async function getPublicQuestions(productId: string, limit = 20) {
  return prisma.question.findMany({
    where: {
      productId,
      deletedAt: null,
      status: QuestionStatus.PUBLISHED,
      answeredAt: { not: null },
    },
    select: { id: true, askerName: true, body: true, answer: true, answeredAt: true, createdAt: true },
    orderBy: [{ answeredAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}
