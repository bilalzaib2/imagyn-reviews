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
  AppProvider as PolarisAppProvider,
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  EmptyState,
  Frame,
  InlineStack,
  Modal,
  Pagination,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Spinner,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { Container } from "../components/ui/Container";
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
  { label: "Draft", value: "draft" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Sending", value: "sending" },
  { label: "Sent", value: "sent" },
  { label: "Opened", value: "opened" },
  { label: "Reviewed", value: "reviewed" },
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
        name: customer.authorName,
        email: customer.authorEmail,
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

const statusTone = (status: ReviewRequestStatus): "success" | "warning" | "attention" | "info" | "new" => {
  if (status === "sent" || status === "reviewed") {
    return "success";
  }

  if (status === "opened") {
    return "new";
  }

  if (status === "scheduled" || status === "sending") {
    return "info";
  }

  if (status === "failed" || status === "cancelled") {
    return "attention";
  }

  return "warning";
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

  const rows = effectiveRequests.map((request) => [
    request.name ?? "Unnamed customer",
    request.product?.name ?? "General request",
    request.orderNumber ?? "-",
    request.email ?? "No email",
    <Badge key={`${request.id}-status`} tone={statusTone(request.status)}>{request.status}</Badge>,
    formatDateTime(request.scheduledFor),
    formatDateTime(request.sentAt),
    formatDateTime(request.createdAt),
    <div key={`${request.id}-actions`} className={styles.tableActions}>
      <Button size="micro" onClick={() => setSelectedRequestId(request.id)} disabled={isMutating}>View</Button>
      <Button size="micro" onClick={() => openEditModal(request)} disabled={isMutating}>Edit</Button>
      <Button size="micro" onClick={() => openRescheduleModal(request)} disabled={isMutating}>Reschedule</Button>
    </div>,
  ]);

  const selectedCustomerLabel = customerOptions.find((option) => option.value === formState.customer)?.label ?? "No customer selected";
  const selectedProductLabel = productOptions.find((option) => option.value === formState.productId)?.label ?? "No product selected";
  const previewSendDate = formatDateTime(optimisticScheduleDate(Number(formState.delayDays || "0")));

  return (
    <PolarisAppProvider i18n={enTranslations}>
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
              <Button onClick={openCreateModal} disabled={customerOptions.length === 0 || productOptions.length === 0 || isMutating}>
                Send Request
              </Button>
            </div>
          </header>

          <div className={styles.toolbar}>
            <div className={styles.searchField}>
              <TextField
                label="Search requests"
                labelHidden
                value={searchValue}
                onChange={setSearchValue}
                autoComplete="off"
                placeholder="Search customer, email, order number, or product"
              />
            </div>
            <div className={styles.filterField}>
              <Select
                label="Status"
                labelHidden
                options={STATUS_FILTER_OPTIONS}
                value={status}
                onChange={(value) => {
                  const next = new URLSearchParams(searchParams);
                  if (value) {
                    next.set("status", value);
                  } else {
                    next.delete("status");
                  }
                  next.delete("page");
                  setSearchParams(next);
                }}
              />
            </div>
            <div className={styles.filterField}>
              <Select
                label="Date filter"
                labelHidden
                options={DATE_FILTER_OPTIONS}
                value={dateFilter}
                onChange={(value) => {
                  const next = new URLSearchParams(searchParams);
                  if (value === "all") {
                    next.delete("dateFilter");
                  } else {
                    next.set("dateFilter", value);
                  }
                  next.delete("page");
                  setSearchParams(next);
                }}
              />
            </div>
          </div>

          {error ? <Banner tone="critical">{error}</Banner> : null}
          {actionError ? <Banner tone="critical">{actionError}</Banner> : null}

          <div className={styles.contentGrid}>
            <div className={styles.tableCard}>
              <Card>
                {isLoading ? (
                  <div className={styles.skeletonTable}>
                    <SkeletonDisplayText size="small" />
                    <SkeletonBodyText lines={8} />
                  </div>
                ) : effectiveRequests.length === 0 ? (
                  <EmptyState
                    heading="No review requests found"
                    action={{ content: "Send Request", onAction: openCreateModal }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Try broadening your filters or create a new request to start collecting reviews.</p>
                  </EmptyState>
                ) : (
                  <BlockStack gap="400">
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text", "text"]}
                      headings={[
                        "Customer",
                        "Product",
                        "Order Number",
                        "Email",
                        "Status",
                        "Scheduled Date",
                        "Sent Date",
                        "Created Date",
                        "Actions",
                      ]}
                      rows={rows}
                      increasedTableDensity
                    />
                    <div className={styles.paginationRow}>
                      <Pagination
                        hasPrevious={page > 1}
                        hasNext={page < totalPages}
                        onPrevious={() => {
                          const next = new URLSearchParams(searchParams);
                          next.set("page", String(page - 1));
                          setSearchParams(next);
                        }}
                        onNext={() => {
                          const next = new URLSearchParams(searchParams);
                          next.set("page", String(page + 1));
                          setSearchParams(next);
                        }}
                      />
                    </div>
                  </BlockStack>
                )}
              </Card>
            </div>

            <aside className={styles.detailPanel}>
              {selectedRequest ? (
                <BlockStack gap="400">
                  <div className={styles.detailHeader}>
                    <p className={styles.detailEyebrow}>Selected request</p>
                    <h2 className={styles.detailTitle}>{selectedRequest.name ?? "Unnamed customer"}</h2>
                    <Badge tone={statusTone(selectedRequest.status)}>{selectedRequest.status}</Badge>
                  </div>

                  <dl className={styles.detailList}>
                    <div className={styles.detailItem}>
                      <dt className={styles.detailLabel}>Product</dt>
                      <dd className={styles.detailValue}>{selectedRequest.product?.name ?? "General request"}</dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt className={styles.detailLabel}>Order Number</dt>
                      <dd className={styles.detailValue}>{selectedRequest.orderNumber ?? "-"}</dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt className={styles.detailLabel}>Email</dt>
                      <dd className={styles.detailValue}>{selectedRequest.email ?? "No email"}</dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt className={styles.detailLabel}>Scheduled Date</dt>
                      <dd className={styles.detailValue}>{formatDateTime(selectedRequest.scheduledFor)}</dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt className={styles.detailLabel}>Sent Date</dt>
                      <dd className={styles.detailValue}>{formatDateTime(selectedRequest.sentAt)}</dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt className={styles.detailLabel}>Created Date</dt>
                      <dd className={styles.detailValue}>{formatDateTime(selectedRequest.createdAt)}</dd>
                    </div>
                    <div className={styles.detailItem}>
                      <dt className={styles.detailLabel}>Custom Message</dt>
                      <dd className={styles.detailValue}>{selectedRequest.customMessage || "No custom message"}</dd>
                    </div>
                  </dl>

                  <div className={styles.detailActions}>
                    <Button onClick={() => openEditModal(selectedRequest)} disabled={isMutating}>Edit</Button>
                    <Button onClick={() => openRescheduleModal(selectedRequest)} disabled={isMutating}>Reschedule</Button>
                    <Button onClick={() => handleResend(selectedRequest)} disabled={isMutating}>Resend</Button>
                    <Button onClick={() => openConfirmation("cancel", selectedRequest)} disabled={isMutating}>Cancel</Button>
                    <Button onClick={() => openConfirmation("delete", selectedRequest)} disabled={isMutating}>Delete</Button>
                  </div>
                </BlockStack>
              ) : isLoading ? (
                <div className={styles.skeletonPanel}>
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={6} />
                </div>
              ) : (
                <EmptyState
                  heading="Select a request"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Choose a request from the table to review details and manage its lifecycle.</p>
                </EmptyState>
              )}
            </aside>
          </div>
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
    </PolarisAppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}