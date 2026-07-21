import { useEffect, useMemo, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  ActionList,
  BlockStack,
  Card,
  Frame,
  Modal,
  Popover,
  Select,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { RequestStatusBadge } from "../components/requests/RequestStatusBadge";
import { RequestLifecycleTimeline } from "../components/requests/RequestLifecycleTimeline";
import { authenticate } from "../shopify.server";
import {
  reviewRequestService,
  type ReviewRequestDateFilter,
  type ReviewRequestRecord,
  type ReviewRequestStatus,
} from "../services/review-request.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.requests.module.css";

type CustomerOption = { name: string | null; email: string | null };
type ProductOption = { id: string; name: string; storeId: string };

type LoaderData = {
  requests: ReviewRequestRecord[];
  customers: CustomerOption[];
  products: ProductOption[];
  totalCount: number;
  page: number;
  pageSize: number;
  search: string;
  status: string;
  dateFilter: ReviewRequestDateFilter;
  error: string | null;
};

type ActionData = {
  ok: boolean;
  error?: string;
  message?: string;
  intent?: string;
};

type RequestModalMode = "create" | "edit" | "reschedule";

type RequestFormState = {
  customer: string;
  productId: string;
  orderNumber: string;
  delayDays: string;
  customMessage: string;
};

type ConfirmationState = {
  open: boolean;
  intent: "cancel" | "delete";
  requestId: string;
  title: string;
  body: string;
};

const DELAY_OPTIONS = [
  { label: "Immediately", value: "0" },
  { label: "1 day", value: "1" },
  { label: "3 days", value: "3" },
  { label: "7 days", value: "7" },
  { label: "14 days", value: "14" },
];

const DATE_FILTER_OPTIONS: Array<{ label: string; value: ReviewRequestDateFilter }> = [
  { label: "All dates", value: "all" },
  { label: "Today", value: "today" },
  { label: "Next 7 days", value: "next7" },
  { label: "Next 30 days", value: "next30" },
  { label: "Past 30 days", value: "past30" },
];

const STATUS_FILTER_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "All statuses", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Sending", value: "sending" },
  { label: "Sent", value: "sent" },
  { label: "Delivered", value: "delivered" },
  { label: "Opened", value: "opened" },
  { label: "Clicked", value: "clicked" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Cancelled", value: "cancelled" },
];

const emptyFormState: RequestFormState = {
  customer: "",
  productId: "",
  orderNumber: "",
  delayDays: "3",
  customMessage: "",
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "";
  const dateFilterParam = url.searchParams.get("dateFilter")?.trim() as ReviewRequestDateFilter | null;
  const dateFilter = dateFilterParam && DATE_FILTER_OPTIONS.some((option) => option.value === dateFilterParam)
    ? dateFilterParam
    : "all";
  const pageValue = Number(url.searchParams.get("page") || "1");
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;

  try {
    const [result, customers, products] = await Promise.all([
      reviewRequestService.listRequests({
        search: search || undefined,
        status: status ? (status as ReviewRequestStatus) : undefined,
        dateFilter,
        page,
        pageSize: 10,
      }),
      reviewRequestService.listCustomers(),
      reviewRequestService.listProducts(),
    ]);

    return {
      requests: result.requests,
      customers: customers.map((customer) => ({
        name: customer.reviewerName,
        email: customer.reviewerEmail,
      })),
      products,
      totalCount: result.totalCount,
      page: result.page,
      pageSize: result.pageSize,
      search,
      status,
      dateFilter,
      error: null,
    };
  } catch (error) {
    return {
      requests: [],
      customers: [],
      products: [],
      totalCount: 0,
      page,
      pageSize: 10,
      search,
      status,
      dateFilter,
      error: error instanceof Error ? error.message : "Unable to load review requests.",
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "create") {
      const customerValue = String(formData.get("customer") || "");
      const productId = String(formData.get("productId") || "");
      const orderNumber = String(formData.get("orderNumber") || "");
      const customMessage = String(formData.get("customMessage") || "");
      const delayDays = Number(formData.get("delayDays") || "0");
      const [name, email] = customerValue.split("||");

      if (!email || !productId || !Number.isFinite(delayDays)) {
        return { ok: false, error: "Customer, product, and delay are required.", intent };
      }

      await reviewRequestService.createRequest({
        name: name || email,
        email,
        productId,
        orderNumber,
        customMessage,
        delayDays,
      });

      return { ok: true, message: "Review request scheduled.", intent };
    }

    if (intent === "edit") {
      const requestId = String(formData.get("requestId") || "");
      const customerValue = String(formData.get("customer") || "");
      const productId = String(formData.get("productId") || "");
      const orderNumber = String(formData.get("orderNumber") || "");
      const customMessage = String(formData.get("customMessage") || "");
      const delayDays = Number(formData.get("delayDays") || "0");
      const [name, email] = customerValue.split("||");

      if (!requestId || !email || !productId || !Number.isFinite(delayDays)) {
        return { ok: false, error: "Request, customer, product, and delay are required.", intent };
      }

      await reviewRequestService.updateRequest(requestId, {
        name: name || email,
        email,
        productId,
        orderNumber,
        customMessage,
        delayDays,
      });

      return { ok: true, message: "Review request updated.", intent };
    }

    if (intent === "reschedule") {
      const requestId = String(formData.get("requestId") || "");
      const delayDays = Number(formData.get("delayDays") || "0");

      if (!requestId || !Number.isFinite(delayDays)) {
        return { ok: false, error: "Request and delay are required.", intent };
      }

      await reviewRequestService.rescheduleRequest(requestId, delayDays);
      return { ok: true, message: "Review request rescheduled.", intent };
    }

    if (intent === "resend") {
      const requestId = String(formData.get("requestId") || "");
      if (!requestId) {
        return { ok: false, error: "Request id is required.", intent };
      }

      await reviewRequestService.resendRequest(requestId);
      return { ok: true, message: "Review request queued again.", intent };
    }

    if (intent === "cancel") {
      const requestId = String(formData.get("requestId") || "");
      if (!requestId) {
        return { ok: false, error: "Request id is required.", intent };
      }

      await reviewRequestService.cancelRequest(requestId);
      return { ok: true, message: "Review request cancelled.", intent };
    }

    if (intent === "delete") {
      const requestId = String(formData.get("requestId") || "");
      if (!requestId) {
        return { ok: false, error: "Request id is required.", intent };
      }

      await reviewRequestService.deleteRequest(requestId);
      return { ok: true, message: "Review request deleted.", intent };
    }

    return { ok: false, error: "Unsupported action.", intent };
  } catch (error) {
    return {
      ok: false,
      intent,
      error: error instanceof Error ? error.message : "Unable to complete request action.",
    };
  }
};

const formatDateTime = (value: Date | null) => {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
};

const buildCustomerValue = (name: string | null, email: string | null) => `${name ?? ""}||${email ?? ""}`;

export default function RequestsPage() {
  const { requests, customers, products, totalCount, page, pageSize, search, status, dateFilter, error } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<ActionData>();
  const [searchParams, setSearchParams] = useSearchParams();

  const isLoading = navigation.state !== "idle";
  const isMutating = fetcher.state !== "idle";
  const activeIntent = fetcher.formData?.get("_intent")?.toString() ?? "";

  const [searchValue, setSearchValue] = useState(search);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(requests[0]?.id ?? null);
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestModalMode, setRequestModalMode] = useState<RequestModalMode>("create");
  const [formState, setFormState] = useState<RequestFormState>(emptyFormState);
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);

  const [optimisticDeleted, setOptimisticDeleted] = useState<Record<string, true>>({});
  const [optimisticPatch, setOptimisticPatch] = useState<Partial<Record<string, Partial<ReviewRequestRecord>>> & Record<string, Partial<ReviewRequestRecord>>>({});

  useEffect(() => {
    setSearchValue(search);
  }, [search]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      const trimmed = searchValue.trim();

      if (trimmed) {
        next.set("search", trimmed);
      } else {
        next.delete("search");
      }

      next.delete("page");
      setSearchParams(next);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [searchParams, searchValue, setSearchParams]);

  useEffect(() => {
    setActionsMenuOpen(false);
  }, [selectedRequestId]);

  useEffect(() => {
    if (!fetcher.data) {
      return;
    }

    if (!fetcher.data.ok) {
      setActionError(fetcher.data.error || "Action failed.");
      setToastState({ content: fetcher.data.error || "Action failed.", error: true });
      setOptimisticDeleted({});
      setOptimisticPatch({});
      return;
    }

    setActionError(null);
    setToastState({ content: fetcher.data.message || "Review request updated." });
    setOptimisticDeleted({});
    setOptimisticPatch({});
    setRequestModalOpen(false);
    setConfirmationState(null);
    setFormState(emptyFormState);
    revalidator.revalidate();
  }, [fetcher.data, revalidator]);

  const effectiveRequests = useMemo(() => {
    return requests
      .filter((request) => !optimisticDeleted[request.id])
      .map((request) => ({
        ...request,
        ...(optimisticPatch[request.id] || {}),
      }));
  }, [requests, optimisticDeleted, optimisticPatch]);

  useEffect(() => {
    if (effectiveRequests.length === 0) {
      setSelectedRequestId(null);
      return;
    }

    if (!selectedRequestId || !effectiveRequests.some((request) => request.id === selectedRequestId)) {
      setSelectedRequestId(effectiveRequests[0].id);
    }
  }, [effectiveRequests, selectedRequestId]);

  const selectedRequest = useMemo(
    () => effectiveRequests.find((request) => request.id === selectedRequestId) ?? null,
    [effectiveRequests, selectedRequestId],
  );

  const customerOptions = customers
    .filter((customer) => customer.email)
    .map((customer) => ({
      label: customer.name ? `${customer.name} (${customer.email})` : (customer.email as string),
      value: buildCustomerValue(customer.name, customer.email),
    }));

  const productOptions = products.map((product) => ({ label: product.name, value: product.id }));

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const submitAction = (payload: Record<string, string>) => {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => formData.append(key, value));
    fetcher.submit(formData, { method: "post" });
  };

  const optimisticScheduleDate = (delayDays: number) => {
    const next = new Date();
    next.setDate(next.getDate() + delayDays);
    return next;
  };

  const openCreateModal = () => {
    setRequestModalMode("create");
    setFormState(emptyFormState);
    setRequestModalOpen(true);
  };

  const openEditModal = (request: ReviewRequestRecord) => {
    setRequestModalMode("edit");
    setSelectedRequestId(request.id);
    setFormState({
      customer: buildCustomerValue(request.name, request.email),
      productId: request.product?.id ?? "",
      orderNumber: request.orderNumber ?? "",
      delayDays: String(request.delayDays ?? 0),
      customMessage: request.customMessage ?? "",
    });
    setRequestModalOpen(true);
  };

  const openRescheduleModal = (request: ReviewRequestRecord) => {
    setRequestModalMode("reschedule");
    setSelectedRequestId(request.id);
    setFormState({
      customer: buildCustomerValue(request.name, request.email),
      productId: request.product?.id ?? "",
      orderNumber: request.orderNumber ?? "",
      delayDays: String(request.delayDays ?? 0),
      customMessage: request.customMessage ?? "",
    });
    setRequestModalOpen(true);
  };

  const openConfirmation = (intent: "cancel" | "delete", request: ReviewRequestRecord) => {
    setConfirmationState({
      open: true,
      intent,
      requestId: request.id,
      title: intent === "cancel" ? "Cancel request" : "Delete request",
      body:
        intent === "cancel"
          ? `Cancel the request for ${request.name ?? request.email ?? "this customer"}?`
          : `Delete the request for ${request.name ?? request.email ?? "this customer"}? This cannot be undone.`,
    });
  };

  const handleResend = (request: ReviewRequestRecord) => {
    const delayDays = request.delayDays ?? 0;
    setActionError(null);
    setOptimisticPatch((prev) => ({
      ...prev,
      [request.id]: {
        status: delayDays === 0 ? "sending" : "scheduled",
        scheduledFor: optimisticScheduleDate(delayDays),
        ...(delayDays === 0 ? { sentAt: new Date() } : {}),
      },
    }));
    submitAction({ _intent: "resend", requestId: request.id });
  };

  const confirmDestructiveAction = () => {
    if (!confirmationState) {
      return;
    }

    setActionError(null);

    if (confirmationState.intent === "cancel") {
      setOptimisticPatch((prev) => ({
        ...prev,
        [confirmationState.requestId]: { status: "cancelled" },
      }));
    }

    if (confirmationState.intent === "delete") {
      setOptimisticDeleted((prev) => ({ ...prev, [confirmationState.requestId]: true }));
    }

    submitAction({ _intent: confirmationState.intent, requestId: confirmationState.requestId });
  };

  const handleModalSubmit = () => {
    if (requestModalMode === "create") {
      submitAction({
        _intent: "create",
        customer: formState.customer,
        productId: formState.productId,
        orderNumber: formState.orderNumber,
        delayDays: formState.delayDays,
        customMessage: formState.customMessage,
      });
      return;
    }

    if (!selectedRequest) {
      return;
    }

    const parsedDelay = Number(formState.delayDays || "0");
    const nextScheduled = optimisticScheduleDate(parsedDelay);

    if (requestModalMode === "edit") {
      const [name, email] = formState.customer.split("||");
      const matchedProduct = products.find((product) => product.id === formState.productId);

      setOptimisticPatch((prev) => ({
        ...prev,
        [selectedRequest.id]: {
          name: name || email || selectedRequest.name,
          email: email || selectedRequest.email,
          orderNumber: formState.orderNumber || null,
          customMessage: formState.customMessage || null,
          delayDays: parsedDelay,
          scheduledFor: nextScheduled,
          product: matchedProduct
            ? { id: matchedProduct.id, name: matchedProduct.name }
            : selectedRequest.product,
        },
      }));

      submitAction({
        _intent: "edit",
        requestId: selectedRequest.id,
        customer: formState.customer,
        productId: formState.productId,
        orderNumber: formState.orderNumber,
        delayDays: formState.delayDays,
        customMessage: formState.customMessage,
      });
      return;
    }

    setOptimisticPatch((prev) => ({
      ...prev,
      [selectedRequest.id]: {
        status: "scheduled",
        delayDays: parsedDelay,
        scheduledFor: nextScheduled,
      },
    }));
    submitAction({ _intent: "reschedule", requestId: selectedRequest.id, delayDays: formState.delayDays });
  };

  const selectedCustomerLabel = customerOptions.find((option) => option.value === formState.customer)?.label ?? "No customer selected";
  const selectedProductLabel = productOptions.find((option) => option.value === formState.productId)?.label ?? "No product selected";
  const previewSendDate = formatDateTime(optimisticScheduleDate(Number(formState.delayDays || "0")));

  return (
    <>
      <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
              <h1 className={`${shellStyles.title} ${styles.title}`}>Requests</h1>
              <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
                Premium review request scheduling with clean merchant workflows and future-ready delivery architecture.
              </p>
            </div>
            <div className={styles.headerActions}>
              <Button
                variant="primary"
                onClick={openCreateModal}
                disabled={customerOptions.length === 0 || productOptions.length === 0 || isMutating}
              >
                Send Request
              </Button>
            </div>
          </header>

          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              <input
                className={styles.searchInput}
                type="search"
                placeholder="Search customer, email, order number, or product"
                aria-label="Search requests"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
              />
            </label>

            <div className={styles.toolbarControls}>
              <label className={styles.filterGroup}>
                <span className={styles.filterLabel}>Status</span>
                <select
                  className={styles.filterSelect}
                  value={status}
                  onChange={(event) => {
                    const value = event.target.value;
                    const next = new URLSearchParams(searchParams);
                    if (value) {
                      next.set("status", value);
                    } else {
                      next.delete("status");
                    }
                    next.delete("page");
                    setSearchParams(next);
                  }}
                >
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.filterGroup}>
                <span className={styles.filterLabel}>Date</span>
                <select
                  className={styles.filterSelect}
                  value={dateFilter}
                  onChange={(event) => {
                    const value = event.target.value;
                    const next = new URLSearchParams(searchParams);
                    if (value === "all") {
                      next.delete("dateFilter");
                    } else {
                      next.set("dateFilter", value);
                    }
                    next.delete("page");
                    setSearchParams(next);
                  }}
                >
                  {DATE_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {actionError ? <p className={styles.feedbackError}>{actionError}</p> : null}
          {isLoading ? <p className={styles.feedbackMuted}>Refreshing request results...</p> : null}

          <Section
            title="Review requests"
            description={`Showing ${totalCount} request${totalCount === 1 ? "" : "s"}.`}
          >
            <div className={styles.splitLayout}>
              {isLoading ? (
                <>
                  <div className={styles.listColumn}>
                    <div className={styles.skeletonList} aria-hidden="true">
                      {Array.from({ length: 6 }, (_, index) => (
                        <div key={index} className={styles.skeletonRow} />
                      ))}
                    </div>
                  </div>
                  <aside className={styles.detailPanel} aria-hidden="true">
                    <div className={styles.skeletonTitle} />
                    <div className={styles.skeletonParagraph} />
                    <div className={styles.skeletonParagraph} />
                    <div className={styles.skeletonBlock} />
                  </aside>
                </>
              ) : error ? (
                <div className={styles.errorState} role="alert">
                  <h2 className={styles.errorStateTitle}>Unable to load requests</h2>
                  <p className={styles.errorStateText}>{error}</p>
                  <Button type="button" onClick={() => window.location.reload()}>
                    Try again
                  </Button>
                </div>
              ) : effectiveRequests.length === 0 ? (
                <>
                  <div className={styles.emptyState}>
                    <h2 className={styles.emptyStateTitle}>No review requests found</h2>
                    <p className={styles.emptyStateText}>
                      Try broadening your filters or create a new request to start collecting reviews.
                    </p>
                    <Button
                      type="button"
                      onClick={openCreateModal}
                      disabled={customerOptions.length === 0 || productOptions.length === 0}
                    >
                      Send Request
                    </Button>
                  </div>
                  <aside className={styles.detailPanel}>
                    <p className={styles.detailEyebrow}>Request details</p>
                    <h2 className={styles.detailTitle}>Select a request</h2>
                    <p className={styles.detailText}>
                      Choose a request from the list to review details and manage its lifecycle.
                    </p>
                  </aside>
                </>
              ) : (
                <>
                  <div className={styles.listColumn}>
                    <div className={styles.listScroll}>
                      <div className={styles.list}>
                        {effectiveRequests.map((request) => {
                          const isSelected = request.id === selectedRequestId;
                          const customerName = request.name ?? "Unnamed customer";
                          const productName = request.product?.name ?? "General request";

                          return (
                            <div
                              key={request.id}
                              className={`${styles.requestRow} ${isSelected ? styles.requestRowSelected : ""}`}
                              onClick={() => setSelectedRequestId(request.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedRequestId(request.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-pressed={isSelected}
                            >
                              <div className={styles.requestContent}>
                                <div className={styles.requestHeaderLine}>
                                  <h2 className={styles.requestTitle}>{customerName}</h2>
                                  <RequestStatusBadge status={request.status} />
                                </div>
                                <p className={styles.requestMeta}>
                                  {productName}
                                  {request.orderNumber ? ` · #${request.orderNumber}` : ""}
                                  {request.email ? ` · ${request.email}` : ""}
                                  {request.source === "order" ? " · Automatic" : ""}
                                </p>
                              </div>
                              <p className={styles.requestDate}>{formatDateTime(request.scheduledFor)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className={styles.pagination}>
                      <button
                        className={styles.paginationButton}
                        type="button"
                        onClick={() => {
                          const next = new URLSearchParams(searchParams);
                          next.set("page", String(page - 1));
                          setSearchParams(next);
                        }}
                        disabled={page <= 1 || isLoading || isMutating}
                      >
                        Previous
                      </button>
                      <span className={styles.paginationLabel}>
                        Page {page} of {totalPages}
                      </span>
                      <button
                        className={styles.paginationButton}
                        type="button"
                        onClick={() => {
                          const next = new URLSearchParams(searchParams);
                          next.set("page", String(page + 1));
                          setSearchParams(next);
                        }}
                        disabled={page >= totalPages || isLoading || isMutating}
                      >
                        Next
                      </button>
                    </div>
                  </div>

                  {selectedRequest ? (
                    <aside className={styles.detailPanel} aria-label="Request details">
                      <div className={styles.detailHeader}>
                        <p className={styles.detailEyebrow}>Selected request</p>
                        <div className={styles.detailStatusRow}>
                          <RequestStatusBadge status={selectedRequest.status} />
                          <span className={styles.detailSourceTag}>
                            {selectedRequest.source === "order" ? "Automatic" : "Manual"}
                          </span>
                        </div>
                        <h2 className={styles.detailTitle}>{selectedRequest.name ?? "Unnamed customer"}</h2>
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Customer</p>
                        <p className={styles.detailValue}>{selectedRequest.name ?? "Unnamed customer"}</p>
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Product</p>
                        <p className={styles.detailValue}>{selectedRequest.product?.name ?? "General request"}</p>
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Order</p>
                        <p className={styles.detailValue}>{selectedRequest.orderNumber ?? "-"}</p>
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Email</p>
                        <p className={styles.detailValue}>{selectedRequest.email ?? "No email"}</p>
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Schedule</p>
                        <div className={styles.detailScheduleGrid}>
                          <div className={styles.detailScheduleItem}>
                            <span className={styles.detailScheduleLabel}>Scheduled</span>
                            <span className={styles.detailValue}>{formatDateTime(selectedRequest.scheduledFor)}</span>
                          </div>
                          <div className={styles.detailScheduleItem}>
                            <span className={styles.detailScheduleLabel}>Sent</span>
                            <span className={styles.detailValue}>{formatDateTime(selectedRequest.sentAt)}</span>
                          </div>
                          <div className={styles.detailScheduleItem}>
                            <span className={styles.detailScheduleLabel}>Created</span>
                            <span className={styles.detailValue}>{formatDateTime(selectedRequest.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Lifecycle</p>
                        <RequestLifecycleTimeline status={selectedRequest.status} />
                        {selectedRequest.status === "failed" ? (
                          <p className={styles.detailValue}>
                            Failed after {selectedRequest.sendAttempts} attempt
                            {selectedRequest.sendAttempts === 1 ? "" : "s"}.
                          </p>
                        ) : null}
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailSection}>
                        <p className={styles.detailLabel}>Custom Message</p>
                        <p className={styles.detailValue}>{selectedRequest.customMessage || "No custom message"}</p>
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailActions}>
                        <Popover
                          active={actionsMenuOpen}
                          onClose={() => setActionsMenuOpen(false)}
                          activator={
                            <Button
                              type="button"
                              variant="secondary"
                              className={styles.actionsMenuButton}
                              onClick={() => setActionsMenuOpen((open) => !open)}
                              disabled={isMutating}
                              aria-label="Request actions"
                              aria-haspopup="menu"
                              aria-expanded={actionsMenuOpen}
                            >
                              <span aria-hidden="true">&#8226;&#8226;&#8226;</span>
                              <span>Actions</span>
                            </Button>
                          }
                        >
                          <ActionList
                            sections={[
                              {
                                items: [
                                  {
                                    content: "Edit",
                                    onAction: () => {
                                      setActionsMenuOpen(false);
                                      openEditModal(selectedRequest);
                                    },
                                  },
                                  {
                                    content: "Reschedule",
                                    onAction: () => {
                                      setActionsMenuOpen(false);
                                      openRescheduleModal(selectedRequest);
                                    },
                                  },
                                  {
                                    content: "Resend",
                                    onAction: () => {
                                      setActionsMenuOpen(false);
                                      handleResend(selectedRequest);
                                    },
                                  },
                                ],
                              },
                              {
                                items: [
                                  {
                                    content: "Cancel request",
                                    destructive: true,
                                    onAction: () => {
                                      setActionsMenuOpen(false);
                                      openConfirmation("cancel", selectedRequest);
                                    },
                                  },
                                  {
                                    content: "Delete",
                                    destructive: true,
                                    onAction: () => {
                                      setActionsMenuOpen(false);
                                      openConfirmation("delete", selectedRequest);
                                    },
                                  },
                                ],
                              },
                            ]}
                          />
                        </Popover>
                      </div>
                    </aside>
                  ) : null}
                </>
              )}
            </div>
          </Section>
        </div>
      </Container>

      <Modal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        title={requestModalMode === "create" ? "Send Review Request" : requestModalMode === "edit" ? "Edit Review Request" : "Reschedule Review Request"}
        primaryAction={{
          content:
            requestModalMode === "create"
              ? isMutating && activeIntent === "create"
                ? "Scheduling..."
                : "Schedule Request"
              : requestModalMode === "edit"
                ? isMutating && activeIntent === "edit"
                  ? "Saving..."
                  : "Save Changes"
                : isMutating && activeIntent === "reschedule"
                  ? "Rescheduling..."
                  : "Reschedule",
          onAction: handleModalSubmit,
          disabled:
            isMutating ||
            (requestModalMode !== "reschedule" && (!formState.customer || !formState.productId)) ||
            !formState.delayDays,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setRequestModalOpen(false),
            disabled: isMutating,
          },
        ]}
      >
        <Modal.Section>
          <div className={styles.modalFields}>
            {requestModalMode !== "reschedule" ? (
              <>
                <Select
                  label="Customer"
                  options={[{ label: "Select a customer", value: "" }, ...customerOptions]}
                  value={formState.customer}
                  onChange={(value) => setFormState((prev) => ({ ...prev, customer: value }))}
                />
                <Select
                  label="Product"
                  options={[{ label: "Select a product", value: "" }, ...productOptions]}
                  value={formState.productId}
                  onChange={(value) => setFormState((prev) => ({ ...prev, productId: value }))}
                />
                <TextField
                  label="Order Number"
                  autoComplete="off"
                  value={formState.orderNumber}
                  onChange={(value) => setFormState((prev) => ({ ...prev, orderNumber: value }))}
                  placeholder="Optional"
                />
              </>
            ) : null}

            <Select
              label="Email delay"
              options={DELAY_OPTIONS}
              value={formState.delayDays}
              onChange={(value) => setFormState((prev) => ({ ...prev, delayDays: value }))}
            />

            {requestModalMode !== "reschedule" ? (
              <TextField
                label="Custom message"
                value={formState.customMessage}
                onChange={(value) => setFormState((prev) => ({ ...prev, customMessage: value }))}
                autoComplete="off"
                multiline={4}
                placeholder="Optional note to include in the future email template"
              />
            ) : null}

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Recipient preview</Text>
                <Text as="p" variant="bodyMd">To: {selectedCustomerLabel}</Text>
                <Text as="p" variant="bodyMd">Product: {selectedProductLabel}</Text>
                <Text as="p" variant="bodyMd">Scheduled: {previewSendDate}</Text>
                {formState.orderNumber ? <Text as="p" variant="bodyMd">Order: {formState.orderNumber}</Text> : null}
              </BlockStack>
            </Card>
          </div>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(confirmationState?.open)}
        onClose={() => setConfirmationState(null)}
        title={confirmationState?.title ?? "Confirm action"}
        primaryAction={{
          destructive: true,
          content: confirmationState?.intent === "delete" ? "Delete" : "Cancel request",
          onAction: confirmDestructiveAction,
          disabled: isMutating,
        }}
        secondaryActions={[
          {
            content: "Keep",
            onAction: () => setConfirmationState(null),
            disabled: isMutating,
          },
        ]}
      >
        <Modal.Section>
          <p>{confirmationState?.body}</p>
        </Modal.Section>
      </Modal>

      <Frame>
        {toastState ? (
          <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} />
        ) : null}
      </Frame>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}