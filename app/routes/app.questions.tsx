// Customer questions — the third view of the reviews workspace.
//
// Scope deliberately matches the benchmark (docs/JUDGEME_PARITY_AUDIT.md §11.13): three tabs
// (all / with answers / without answers), an answer box, and moderation that records why a
// question was hidden. Everything it does goes through question.server.ts, which is where the
// tenant scoping lives.
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigation, useRouteError, useSearchParams } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Frame, Modal, Toast } from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Table, type TableColumn } from "../components/ui/Table";
import { WorkspaceTabs } from "../components/ui/WorkspaceTabs";
import { REVIEW_WORKSPACE_TABS } from "../components/ui/reviewWorkspaceTabs";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { Banner } from "../components/ui/Banner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import {
  answerQuestion,
  deleteQuestion,
  getStoreQuestionCounts,
  getStoreQuestions,
  hideQuestion,
  publishQuestion,
  type QuestionWithProduct,
} from "../services/question.server";
import { answeredFilterForTab, QUESTION_TABS, QuestionStatus } from "../services/question.shared";
import { REVIEW_HIDE_REASONS, reviewHideReasonLabel, type ReviewHideReasonId } from "../services/review.shared";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.questions.module.css";

const PAGE_SIZE = 25;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const url = new URL(request.url);
  const tab = url.searchParams.get("tab")?.trim() || "";
  const search = url.searchParams.get("search")?.trim() || "";

  const filters = { search: search || undefined };

  const [result, counts] = await Promise.all([
    getStoreQuestions(store.id, { ...filters, answered: answeredFilterForTab(tab), limit: PAGE_SIZE }),
    getStoreQuestionCounts(store.id, filters),
  ]);

  return { questions: result.questions, totalCount: result.totalCount, counts, tab, search };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");
  const questionId = String(formData.get("questionId") || "");

  if (!questionId) {
    return { ok: false, error: "Missing question id." };
  }

  try {
    switch (intent) {
      case "answer":
        await answerQuestion(store.id, questionId, String(formData.get("answer") || ""));
        return { ok: true, message: "Answer saved and published." };
      case "publish":
        await publishQuestion(store.id, questionId);
        return { ok: true, message: "Question published." };
      case "hide":
        // The service narrows this to an offered id; anything else is stored as no reason.
        await hideQuestion(store.id, questionId, formData.get("hideReason"));
        return { ok: true, message: "Question hidden." };
      case "delete":
        await deleteQuestion(store.id, questionId);
        return { ok: true, message: "Question deleted." };
      default:
        return { ok: false, error: "Unknown action." };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
};

function statusToneFor(question: QuestionWithProduct) {
  if (question.status === QuestionStatus.PUBLISHED) return "success" as const;
  if (question.status === QuestionStatus.REJECTED) return "danger" as const;
  return "warning" as const;
}

function statusLabelFor(question: QuestionWithProduct) {
  if (question.status === QuestionStatus.PUBLISHED) return "Published";
  if (question.status === QuestionStatus.REJECTED) return "Hidden";
  return "Pending";
}

export default function QuestionsPage() {
  const { questions, counts, tab, search } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigation = useNavigation();
  const fetcher = useFetcher<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(search);
  const [answering, setAnswering] = useState<QuestionWithProduct | null>(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [hidePrompt, setHidePrompt] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState<ReviewHideReasonId>(REVIEW_HIDE_REASONS[0].id);
  const [toast, setToast] = useState<{ content: string; error: boolean } | null>(null);

  const isBusy = fetcher.state !== "idle" || navigation.state === "loading";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data;
    setToast({ content: data.ok ? (data.message ?? "Done.") : (data.error ?? "Failed."), error: !data.ok });
    if (data.ok) setAnswering(null);
  }, [fetcher.state, fetcher.data]);

  // Debounced search, so a query runs once the merchant stops typing rather than per keystroke.
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchInput) next.set("search", searchInput);
      else next.delete("search");
      setSearchParams(next, { replace: true, preventScrollReset: true });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, search, searchParams, setSearchParams]);

  const submit = (fields: Record<string, string>) => fetcher.submit(fields, { method: "post" });

  const countFor = (tabId: string) =>
    tabId === "answered" ? counts.answered : tabId === "unanswered" ? counts.unanswered : counts.all;

  const columns: TableColumn<QuestionWithProduct>[] = useMemo(
    () => [
      {
        key: "asker",
        header: "Customer",
        width: "14%",
        hideOnNarrow: true,
        render: (question) => <span className={styles.asker}>{question.askerName}</span>,
      },
      {
        key: "question",
        header: "Question",
        render: (question) => (
          <div>
            <p className={styles.questionBody}>{question.body}</p>
            {question.answer ? <p className={styles.answerPreview}>{question.answer}</p> : null}
          </div>
        ),
      },
      {
        key: "product",
        header: "Product",
        width: "16%",
        hideOnNarrow: true,
        render: (question) => (
          <span className={styles.product}>{question.product?.name ?? question.productTitle ?? "Store"}</span>
        ),
      },
      {
        key: "status",
        header: "Status",
        width: "7rem",
        render: (question) => (
          <div className={styles.statusCell}>
            <StatusBadge tone={statusToneFor(question)}>{statusLabelFor(question)}</StatusBadge>
            {question.hiddenReason ? (
              <span className={styles.hiddenReason}>
                {reviewHideReasonLabel(question.hiddenReason) ?? question.hiddenReason}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        width: "12rem",
        headerHidden: true,
        interactive: true,
        render: (question) => (
          <div className={styles.rowActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={isBusy}
              onClick={() => {
                setAnswering(question);
                setAnswerDraft(question.answer ?? "");
              }}
            >
              {question.answer ? "Edit answer" : "Answer"}
            </Button>
            {question.status === QuestionStatus.REJECTED ? (
              <Button
                type="button"
                variant="ghost"
                disabled={isBusy}
                onClick={() => submit({ _intent: "publish", questionId: question.id })}
              >
                Restore
              </Button>
            ) : (
              <Button type="button" variant="ghost" disabled={isBusy} onClick={() => setHidePrompt(question.id)}>
                Hide
              </Button>
            )}
          </div>
        ),
      },
    ],
    // submit and isBusy are the only values the cells close over that change.
    [isBusy], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      <Container as="main">
        <div className={`${shellStyles.page} ${shellStyles.reveal}`}>
          <header className={shellStyles.header}>
            <div className={shellStyles.headerContent}>
              <h1 className={shellStyles.title}>Customer questions</h1>
              <p className={shellStyles.subtitle}>
                Answer what shoppers ask, and publish the answers to your product pages.
              </p>
            </div>
          </header>

          <WorkspaceTabs tabs={REVIEW_WORKSPACE_TABS} currentPath={location.pathname} search={location.search} />

          <Section>
            <div className={styles.toolbar}>
              <div className={styles.tabs} role="group" aria-label="Filter questions">
                {QUESTION_TABS.map((option) => (
                  <button
                    key={option.id || "all"}
                    type="button"
                    className={`${styles.tab} ${tab === option.id ? styles.tabActive : ""}`}
                    aria-pressed={tab === option.id}
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      if (option.id) next.set("tab", option.id);
                      else next.delete("tab");
                      setSearchParams(next, { preventScrollReset: true });
                    }}
                  >
                    {option.label}
                    <span className={styles.tabCount}>{countFor(option.id)}</span>
                  </button>
                ))}
              </div>

              <label className={styles.searchField}>
                <input
                  className={styles.searchInput}
                  type="search"
                  placeholder="Search questions, answers, or customers"
                  aria-label="Search questions"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </label>
            </div>

            {fetcher.data && !fetcher.data.ok ? (
              <Banner tone="critical" description={fetcher.data.error ?? "Something went wrong."} />
            ) : null}

            <Table
              columns={columns}
              rows={questions}
              getRowKey={(question) => question.id}
              ariaLabel="Customer questions"
              empty={
                <div className={styles.empty}>
                  <p className={styles.emptyTitle}>No questions yet</p>
                  <p className={styles.emptyBody}>
                    Questions customers ask on your product pages appear here, ready for you to answer.
                  </p>
                </div>
              }
            />
          </Section>
        </div>
      </Container>

      <Modal
        open={answering !== null}
        onClose={() => setAnswering(null)}
        title="Answer question"
        primaryAction={{
          content: "Save and publish",
          onAction: () => {
            if (answering) submit({ _intent: "answer", questionId: answering.id, answer: answerDraft });
          },
          loading: isBusy,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setAnswering(null) }]}
      >
        <Modal.Section>
          {answering ? <p className={styles.modalQuestion}>{answering.body}</p> : null}
          <label className={styles.fieldLabel} htmlFor="answer-body">
            Your answer
          </label>
          <textarea
            id="answer-body"
            className={styles.answerInput}
            rows={5}
            value={answerDraft}
            onChange={(event) => setAnswerDraft(event.target.value)}
            placeholder="Answer the question as you would to a customer."
          />
          <p className={styles.fieldHint}>
            Saving publishes the question and your answer to the product page. Clearing the answer
            unpublishes it again.
          </p>
        </Modal.Section>
      </Modal>

      <Modal
        open={hidePrompt !== null}
        onClose={() => setHidePrompt(null)}
        title="Hide question"
        primaryAction={{
          content: "Hide question",
          destructive: true,
          onAction: () => {
            if (hidePrompt) submit({ _intent: "hide", questionId: hidePrompt, hideReason });
            setHidePrompt(null);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setHidePrompt(null) }]}
      >
        <Modal.Section>
          <label className={styles.fieldLabel} htmlFor="question-hide-reason">
            Reason for hiding
          </label>
          <select
            id="question-hide-reason"
            className={styles.reasonSelect}
            value={hideReason}
            onChange={(event) => setHideReason(event.target.value as ReviewHideReasonId)}
          >
            {REVIEW_HIDE_REASONS.map((reason) => (
              <option key={reason.id} value={reason.id}>
                {reason.label}
              </option>
            ))}
          </select>
          <p className={styles.fieldHint}>
            Recorded with the question for your own records. It is never shown to customers.
          </p>
        </Modal.Section>
      </Modal>

      <div className={styles.toastFrame}>
        <Frame>
          {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}
        </Frame>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
