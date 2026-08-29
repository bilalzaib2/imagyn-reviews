import { useEffect, useMemo, useRef, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useRouteError,
} from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  ActionList,
  Autocomplete,
  Banner,
  BlockStack,
  Card,
  Frame,
  Icon,
  Modal,
  Popover,
  Select,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import { PersonIcon, SearchIcon } from "@shopify/polaris-icons";

import { Button } from "../components/ui/Button";
import { LinkButton } from "../components/ui/LinkButton";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { RequestStatusBadge } from "../components/requests/RequestStatusBadge";
import { RequestLifecycleTimeline } from "../components/requests/RequestLifecycleTimeline";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import {
  reviewRequestService,
  type ReviewRequestDateFilter,
  type ReviewRequestRecord,
  type ReviewRequestSortBy,
  type ReviewRequestSortDir,
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
  sortBy: ReviewRequestSortBy;
  sortDir: ReviewRequestSortDir;
  error: string | null;
  // Drives the Pro-upgrade callout below the header — a genuinely gated capability
  // (see permissions.ts), not a UI-only claim: Free stores never get the Day 3/Day 7
  // automatic reminder sweep, so a request sitting without a reminder isn't a bug on
  // their plan, and this is the one page a merchant would actually notice that.
  canUseEmailReminders: boolean;
};

type ActionData = {
  ok: boolean;
  error?: string;
  message?: string;
  intent?: string;
  // Set only on the create action's duplicate-context check (see the "create" intent handler
  // below) — distinguishes "here's something worth confirming" from a hard failure, so the UI
  // keeps the modal open with an inline banner instead of toasting an error and closing it.
  warning?: boolean;
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

const SORT_OPTIONS: Array<{ label: string; value: `${ReviewRequestSortBy}:${ReviewRequestSortDir}` }> = [
  { label: "Newest first", value: "createdAt:desc" },
  { label: "Oldest first", value: "createdAt:asc" },
  { label: "Schedule date (soonest)", value: "scheduledFor:asc" },
  { label: "Schedule date (latest)", value: "scheduledFor:desc" },
  { label: "Customer name (A–Z)", value: "name:asc" },
  { label: "Status", value: "status:asc" },
];

const emptyFormState: RequestFormState = {
  customer: "",
  productId: "",
  orderNumber: "",
  delayDays: "3",
  customMessage: "",
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "";
  const dateFilterParam = url.searchParams.get("dateFilter")?.trim() as ReviewRequestDateFilter | null;
  const dateFilter = dateFilterParam && DATE_FILTER_OPTIONS.some((option) => option.value === dateFilterParam)
    ? dateFilterParam
    : "all";
  const pageValue = Number(url.searchParams.get("page") || "1");
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
  const sortParam = url.searchParams.get("sort") || "createdAt:desc";
  const [sortByRaw, sortDirRaw] = sortParam.split(":");
  const sortBy = SORT_OPTIONS.some((option) => option.value.startsWith(`${sortByRaw}:`))
    ? (sortByRaw as ReviewRequestSortBy)
    : "createdAt";
  const sortDir: ReviewRequestSortDir = sortDirRaw === "asc" ? "asc" : "desc";

  try {
    const [result, customers, products, permissions] = await Promise.all([
      reviewRequestService.listRequests(store.id, {
        search: search || undefined,
        status: status ? (status as ReviewRequestStatus) : undefined,
        dateFilter,
        page,
        pageSize: 10,
        sortBy,
        sortDir,
      }),
      reviewRequestService.listCustomers(store.id),
      reviewRequestService.listProducts(store.id),
      getStorePermissions(store.id),
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
      sortBy,
      sortDir,
      error: null,
      canUseEmailReminders: permissions.canUseEmailReminders,
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
      sortBy,
      sortDir,
      error: error instanceof Error ? error.message : "Unable to load review requests.",
      canUseEmailReminders: false,
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "create") {
      const customerValue = String(formData.get("customer") || "");
      const productId = String(formData.get("productId") || "");
      const orderNumber = String(formData.get("orderNumber") || "");
      const customMessage = String(formData.get("customMessage") || "");
      const delayDays = Number(formData.get("delayDays") || "0");
      const confirmDuplicate = String(formData.get("confirmDuplicate") || "") === "true";
      const [name, email] = customerValue.split("||");

      if (!email || !productId || !Number.isFinite(delayDays)) {
        return { ok: false, error: "Customer, product, and delay are required.", intent };
      }

      // A one-time check, not a hard constraint — the merchant can always proceed by
      // resubmitting with confirmDuplicate set (see the modal's "Send Anyway" action). This
      // only runs on the first submit of a given (customer, product) pair; changing either
      // field in the UI clears the confirmation so a genuinely different pair gets its own
      // fresh check.
      if (!confirmDuplicate) {
        const context = await reviewRequestService.getExistingRequestContext(store.id, { email, productId });
        const reasons: string[] = [];
        if (context.hasExistingReview) {
          reasons.push("this customer has already left a review for this product");
        }
        if (context.hasPendingRequest) {
          reasons.push("a request for this customer and product is already pending or scheduled");
        }
        if (context.hasSentRequest) {
          reasons.push("a request for this customer and product was already sent and hasn't been completed yet");
        }

        if (reasons.length > 0) {
          return {
            ok: false,
            warning: true,
            error: `${reasons.join("; ")}. Send this request anyway?`,
            intent,
          };
        }
      }

      await reviewRequestService.createRequest(store.id, {
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

      await reviewRequestService.updateRequest(store.id, requestId, {
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

      await reviewRequestService.rescheduleRequest(store.id, requestId, delayDays);
      return { ok: true, message: "Review request rescheduled.", intent };
    }

    if (intent === "resend") {
      const requestId = String(formData.get("requestId") || "");
      if (!requestId) {
        return { ok: false, error: "Request id is required.", intent };
      }

      await reviewRequestService.resendRequest(store.id, requestId);
      return { ok: true, message: "Review request queued again.", intent };
    }

    if (intent === "cancel") {
      const requestId = String(formData.get("requestId") || "");
      if (!requestId) {
        return { ok: false, error: "Request id is required.", intent };
      }

      await reviewRequestService.cancelRequest(store.id, requestId);
      return { ok: true, message: "Review request cancelled.", intent };
    }

    if (intent === "delete") {
      const requestId = String(formData.get("requestId") || "");
      if (!requestId) {
        return { ok: false, error: "Request id is required.", intent };
      }

      await reviewRequestService.deleteRequest(store.id, requestId);
      return { ok: true, message: "Review request deleted.", intent };
    }

    if (intent === "bulkCancel") {
      const requestIds = formData
        .getAll("requestIds")
        .map((entry) => String(entry))
        .filter(Boolean);

      if (requestIds.length === 0) {
        return { ok: false, error: "No requests selected.", intent };
      }

      // Loops the existing single-item cancelRequest — deliberately not a batched updateMany,
      // so every row still goes through its real guard (idempotent no-op if already cancelled,
      // rejected if already completed) instead of a bulk write bypassing them. One failure
      // (e.g. a completed request in the selection) doesn't abort the rest of the batch.
      let cancelled = 0;
      let skipped = 0;
      for (const requestId of requestIds) {
        try {
          await reviewRequestService.cancelRequest(store.id, requestId);
          cancelled += 1;
        } catch {
          skipped += 1;
        }
      }

      if (cancelled === 0) {
        return { ok: false, error: "None of the selected requests could be cancelled.", intent };
      }

      return {
        ok: true,
        message:
          skipped > 0
            ? `Cancelled ${cancelled} request${cancelled === 1 ? "" : "s"} (${skipped} already completed, skipped).`
            : `Cancelled ${cancelled} request${cancelled === 1 ? "" : "s"}.`,
        intent,
      };
    }

    if (intent === "bulkSend") {
      const requestIds = formData
        .getAll("requestIds")
        .map((entry) => String(entry))
        .filter(Boolean);

      if (requestIds.length === 0) {
        return { ok: false, error: "No requests selected.", intent };
      }

      // Same loop-the-single-item-guard pattern as bulkCancel — resendRequest(sendNow: true)
      // still rejects an already-completed request, so a completed row in the selection is
      // skipped, not force-sent.
      let sent = 0;
      let skipped = 0;
      for (const requestId of requestIds) {
        try {
          await reviewRequestService.resendRequest(store.id, requestId, { sendNow: true });
          sent += 1;
        } catch {
          skipped += 1;
        }
      }

      if (sent === 0) {
        return { ok: false, error: "None of the selected requests could be sent.", intent };
      }

      return {
        ok: true,
        message:
          skipped > 0
            ? `Sent ${sent} request${sent === 1 ? "" : "s"} (${skipped} already completed, skipped).`
            : `Sent ${sent} request${sent === 1 ? "" : "s"}.`,
        intent,
      };
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

type RequestAction = "edit" | "reschedule" | "resend" | "cancel" | "delete";

// Mirrors review-request.server.ts's own guards exactly (resendRequest/cancelRequest reject
// an already-completed request; cancelRequest is a no-op on an already-cancelled one) — the
// backend is still the real enforcement, this just keeps the UI from ever offering an action
// it already knows will be rejected or is meaningless. See "..." menus below (row-level and
// detail panel), the only two callers.
function getAvailableActions(status: ReviewRequestStatus): RequestAction[] {
  if (status === "completed") {
    // Already has its review — nothing to edit, reschedule, resend, or cancel.
    return ["delete"];
  }
  if (status === "cancelled") {
    // "cancel" itself is redundant here; everything else (including reviving via resend) is
    // still a legitimate action.
    return ["edit", "reschedule", "resend", "delete"];
  }
  return ["edit", "reschedule", "resend", "cancel", "delete"];
}

// bulkSend (app.requests.tsx's action) is resendRequest(sendNow: true) under the hood — the
// exact same guard as a single-row "Resend", which getAvailableActions already encodes via its
// "resend" entry. Deriving eligibility from that (instead of a second hardcoded status list)
// is what keeps the bulk toolbar from ever drifting out of sync with the real backend rule.
const isEligibleForSend = (status: ReviewRequestStatus) => getAvailableActions(status).includes("resend");

// Top-level (not nested in RequestsPage) on purpose — an inline function component gets a new
// identity every parent render, which would remount this on every keystroke elsewhere in the
// page and drop whatever the merchant was typing into the search field. `key` (passed by the
// caller, one per modal-open cycle) resets its local state fresh each time the modal opens,
// standing in for whatever Polaris's Modal does or doesn't unmount on close.
function CustomerPicker({
  customers,
  value,
  onChange,
  disabled,
}: {
  customers: CustomerOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [manualEntry, setManualEntry] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");

  const [name, email] = value.split("||");
  const hasSelection = Boolean(email);

  // Existing reviewers only — Imagyn doesn't have read_customers/read_orders scope yet, so this
  // can't browse the merchant's full Shopify customer list. Same data source and limitation as
  // the native <select> this replaces; only the search/selection UX changes here.
  const matches = useMemo(() => {
    const withEmail = customers.filter((customer) => customer.email);
    const trimmed = query.trim().toLowerCase();
    const filtered = trimmed
      ? withEmail.filter(
          (customer) =>
            customer.name?.toLowerCase().includes(trimmed) || customer.email?.toLowerCase().includes(trimmed),
        )
      : withEmail;
    return filtered.slice(0, 20);
  }, [customers, query]);

  const options = matches.map((customer) => ({
    value: buildCustomerValue(customer.name, customer.email),
    label: customer.name ? `${customer.name} — ${customer.email}` : (customer.email as string),
  }));

  if (hasSelection) {
    return (
      <div className={styles.customerSelected}>
        <Icon source={PersonIcon} tone="subdued" />
        <div className={styles.customerSelectedText}>
          <p className={styles.customerName}>{name || email}</p>
          {name ? <p className={styles.customerEmail}>{email}</p> : null}
        </div>
        <Button type="button" variant="ghost" onClick={() => onChange("")} disabled={disabled}>
          Change
        </Button>
      </div>
    );
  }

  if (manualEntry) {
    return (
      <div className={styles.modalFields}>
        <TextField label="Customer name" autoComplete="off" value={manualName} onChange={setManualName} disabled={disabled} />
        <TextField
          label="Customer email"
          type="email"
          autoComplete="off"
          value={manualEmail}
          onChange={setManualEmail}
          disabled={disabled}
        />
        <div className={styles.customerManualActions}>
          <Button
            type="button"
            variant="primary"
            onClick={() => onChange(buildCustomerValue(manualName, manualEmail))}
            disabled={disabled || !manualEmail}
          >
            Use this customer
          </Button>
          <Button type="button" variant="ghost" onClick={() => setManualEntry(false)} disabled={disabled}>
            Back to search
          </Button>
        </div>
      </div>
    );
  }

  const textField = (
    <Autocomplete.TextField
      onChange={setQuery}
      label="Customer"
      labelHidden
      value={query}
      placeholder="Search customer by name or email"
      autoComplete="off"
      prefix={<Icon source={SearchIcon} tone="subdued" />}
      disabled={disabled}
    />
  );

  return (
    <div>
      {/* Above the field, not below — the Autocomplete's popover (matches, or "No matching
          customers") always opens downward from the text field, so anything placed below it
          gets covered and unclickable for as long as the popover is open. A button inside the
          popover's own emptyState doesn't work either (confirmed live: Polaris's popover swallows
          the click before React's handler runs), so this link has to live somewhere the popover
          never reaches. */}
      <button type="button" className={styles.customerManualLink} onClick={() => setManualEntry(true)} disabled={disabled}>
        + Enter a new customer
      </button>
      <Autocomplete
        options={options}
        selected={[]}
        onSelect={(selected) => selected[0] && onChange(selected[0])}
        textField={textField}
        emptyState={<p className={styles.customerEmptyState}>No matching customers.</p>}
      />
    </div>
  );
}

export default function RequestsPage() {
  const initialData = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<ActionData>();

  // Pagination and filtering are driven through this fetcher instead of `useSearchParams`.
  // Shopify Admin's embedded-app shell owns the outer iframe URL via the NavMenu registration
  // and will silently revert raw History API changes (what useSearchParams uses under the
  // hood) back to its own last-known URL a few hundred ms after they land — reproduced and
  // confirmed via production logging. A fetcher re-runs the same loader over a plain request
  // without touching window.history, so there's nothing for the admin shell to fight with.
  const dataFetcher = useFetcher<typeof loader>();
  const data = dataFetcher.data ?? initialData;
  const {
    requests,
    customers,
    products,
    totalCount,
    page,
    pageSize,
    search,
    status,
    dateFilter,
    sortBy,
    sortDir,
    error,
    canUseEmailReminders,
  } = data;

  const isLoading = navigation.state !== "idle" || dataFetcher.state !== "idle";
  const isMutating = fetcher.state !== "idle";
  const activeIntent = fetcher.formData?.get("_intent")?.toString() ?? "";

  const buildRequestsUrl = (overrides: {
    search?: string;
    status?: string;
    dateFilter?: ReviewRequestDateFilter;
    page?: number;
    sort?: string;
  }) => {
    const nextSearch = overrides.search !== undefined ? overrides.search : search;
    const nextStatus = overrides.status !== undefined ? overrides.status : status;
    const nextDateFilter = overrides.dateFilter !== undefined ? overrides.dateFilter : dateFilter;
    const nextPage = overrides.page !== undefined ? overrides.page : page;
    const nextSort = overrides.sort !== undefined ? overrides.sort : `${sortBy}:${sortDir}`;

    const params = new URLSearchParams();
    if (nextSearch) params.set("search", nextSearch);
    if (nextStatus) params.set("status", nextStatus);
    if (nextDateFilter && nextDateFilter !== "all") params.set("dateFilter", nextDateFilter);
    if (nextPage > 1) params.set("page", String(nextPage));
    if (nextSort && nextSort !== "createdAt:desc") params.set("sort", nextSort);

    const queryString = params.toString();
    return queryString ? `/app/requests?${queryString}` : "/app/requests";
  };

  const [searchValue, setSearchValue] = useState(search);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(requests[0]?.id ?? null);
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestModalMode, setRequestModalMode] = useState<RequestModalMode>("create");
  const [formState, setFormState] = useState<RequestFormState>(emptyFormState);
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  // Set from the create action's duplicate-context check (see the "create" intent handler in
  // the action above) — non-null keeps the modal open with an inline banner instead of
  // toasting an error, and switches the primary action to an explicit "Send Anyway" resubmit.
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  // Flips true on the first submit attempt while required fields are missing — inline field
  // errors only render after that, so an untouched fresh modal never opens already "in error".
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  // Bulk selection (checkboxes) — separate from selectedRequestId, which drives the detail
  // panel. A row can be both "selected" for bulk action and "selected" as the open detail at
  // the same time; the two concepts don't interact.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Which row's own "..." popover is open, if any — separate from actionsMenuOpen (the detail
  // panel's popover), since a row-level and the detail-panel menu can never both be relevant to
  // the same click.
  const [rowActionsOpenId, setRowActionsOpenId] = useState<string | null>(null);
  // Bumped on every modal open — used as CustomerPicker's key so its internal search/manual-
  // entry state always starts fresh, regardless of whether Polaris keeps the Modal's children
  // mounted across an open/close cycle.
  const [modalInstanceKey, setModalInstanceKey] = useState(0);

  const [optimisticDeleted, setOptimisticDeleted] = useState<Record<string, true>>({});
  const [optimisticPatch, setOptimisticPatch] = useState<Partial<Record<string, Partial<ReviewRequestRecord>>> & Record<string, Partial<ReviewRequestRecord>>>({});

  useEffect(() => {
    setSearchValue(search);
  }, [search]);

  const isFirstSearchEffect = useRef(true);

  useEffect(() => {
    if (isFirstSearchEffect.current) {
      isFirstSearchEffect.current = false;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      dataFetcher.load(buildRequestsUrl({ search: searchValue.trim(), page: 1 }));
    }, 250);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  useEffect(() => {
    setActionsMenuOpen(false);
  }, [selectedRequestId]);

  useEffect(() => {
    if (!fetcher.data) {
      return;
    }

    if (!fetcher.data.ok && fetcher.data.warning) {
      // Keep the modal open, no toast — this is a "confirm before proceeding" nudge, not a
      // failure. handleModalSubmit resubmits with confirmDuplicate once the merchant clicks
      // "Send Anyway".
      setDuplicateWarning(fetcher.data.error || "This may be a duplicate request.");
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
    setDuplicateWarning(null);
    setToastState({ content: fetcher.data.message || "Review request updated." });
    setOptimisticDeleted({});
    setOptimisticPatch({});
    setRequestModalOpen(false);
    setConfirmationState(null);
    setFormState(emptyFormState);
    revalidator.revalidate();
    dataFetcher.load(buildRequestsUrl({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Drives the bulk toolbar's "Send Now" button — see isEligibleForSend's comment for why this
  // is derived from getAvailableActions rather than a second hardcoded status list. When every
  // selected row is eligible, this is the shape the future one-button "All Done" workflow would
  // reuse directly: an all-selected-eligible bulk action rendered as the toolbar's primary CTA.
  const selectedSendEligibleCount = useMemo(
    () => effectiveRequests.filter((request) => selectedIds.includes(request.id) && isEligibleForSend(request.status)).length,
    [effectiveRequests, selectedIds],
  );
  const allSelectedSendEligible = selectedIds.length > 0 && selectedSendEligibleCount === selectedIds.length;

  const productOptions = products.map((product) => ({ label: product.name, value: product.id }));

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const submitAction = (payload: Record<string, string | string[]>) => {
    const formData = new FormData();
    Object.entries(payload).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => formData.append(key, item));
      } else {
        formData.append(key, value);
      }
    });
    fetcher.submit(formData, { method: "post" });
  };

  const toggleSelection = (requestId: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, requestId] : prev.filter((id) => id !== requestId)));
  };

  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedIds(checked ? effectiveRequests.map((request) => request.id) : []);
  };

  const optimisticScheduleDate = (delayDays: number) => {
    const next = new Date();
    next.setDate(next.getDate() + delayDays);
    return next;
  };

  const openCreateModal = () => {
    setRequestModalMode("create");
    setFormState(emptyFormState);
    setDuplicateWarning(null);
    setAttemptedSubmit(false);
    setModalInstanceKey((key) => key + 1);
    setRequestModalOpen(true);
  };

  // A pending warning is specific to the (customer, product) pair it was raised for —
  // changing either one means the next submit needs its own fresh check, not a stale
  // confirmation from a different pair.
  const updateFormState = (patch: Partial<RequestFormState>) => {
    setFormState((prev) => ({ ...prev, ...patch }));
    if (duplicateWarning && ("customer" in patch || "productId" in patch)) {
      setDuplicateWarning(null);
    }
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
    setAttemptedSubmit(false);
    setModalInstanceKey((key) => key + 1);
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
    setAttemptedSubmit(false);
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

  // Shared by the row-level "..." popover and the detail panel's own — same available-actions
  // set (getAvailableActions), same handlers, so the two never drift out of sync. `onDone`
  // closes whichever popover (row-level or detail) actually triggered this.
  const buildActionListSections = (request: ReviewRequestRecord, onDone: () => void) => {
    const available = getAvailableActions(request.status);
    // Not a backend-gated action (there's nothing to "allow" — it just opens the detail
    // panel), so it's unconditional and lives in its own section ahead of the guarded ones.
    const viewItems = [
      {
        content: "View details",
        onAction: () => {
          onDone();
          setSelectedRequestId(request.id);
        },
      },
    ];
    const primaryItems = [
      available.includes("edit") && {
        content: "Edit",
        onAction: () => {
          onDone();
          openEditModal(request);
        },
      },
      available.includes("reschedule") && {
        content: "Reschedule",
        onAction: () => {
          onDone();
          openRescheduleModal(request);
        },
      },
      available.includes("resend") && {
        content: "Resend",
        onAction: () => {
          onDone();
          handleResend(request);
        },
      },
    ].filter(Boolean) as Array<{ content: string; onAction: () => void }>;

    const destructiveItems = [
      available.includes("cancel") && {
        content: "Cancel request",
        destructive: true,
        onAction: () => {
          onDone();
          openConfirmation("cancel", request);
        },
      },
      available.includes("delete") && {
        content: "Delete",
        destructive: true,
        onAction: () => {
          onDone();
          openConfirmation("delete", request);
        },
      },
    ].filter(Boolean) as Array<{ content: string; destructive: boolean; onAction: () => void }>;

    return [
      { items: viewItems },
      ...(primaryItems.length > 0 ? [{ items: primaryItems }] : []),
      ...(destructiveItems.length > 0 ? [{ items: destructiveItems }] : []),
    ];
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
    if (requestModalMode !== "reschedule") {
      const [, emailToValidate] = formState.customer.split("||");
      if (!emailToValidate || !formState.productId) {
        setAttemptedSubmit(true);
        return;
      }
    }

    if (requestModalMode === "create") {
      submitAction({
        _intent: "create",
        customer: formState.customer,
        productId: formState.productId,
        orderNumber: formState.orderNumber,
        delayDays: formState.delayDays,
        customMessage: formState.customMessage,
        // Set once a warning has already been shown for this exact (customer, product) pair —
        // this resubmit is the merchant explicitly choosing "Send Anyway".
        confirmDuplicate: duplicateWarning ? "true" : "false",
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
            ? {
                id: matchedProduct.id,
                name: matchedProduct.name,
                featuredImage: selectedRequest.product?.featuredImage ?? null,
              }
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

  const [customerNameValue, customerEmailValue] = formState.customer.split("||");
  const selectedCustomerLabel = customerEmailValue
    ? customerNameValue
      ? `${customerNameValue} (${customerEmailValue})`
      : customerEmailValue
    : "No customer selected";
  const selectedProductLabel = productOptions.find((option) => option.value === formState.productId)?.label ?? "No product selected";
  const previewSendDate = formatDateTime(optimisticScheduleDate(Number(formState.delayDays || "0")));

  return (
    <>
      <Container as="main">
      <div className={shellStyles.page}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
              <h1 className={shellStyles.title}>Requests</h1>
              <p className={shellStyles.subtitle}>
                Premium review request scheduling with clean merchant workflows and future-ready delivery architecture.
              </p>
            </div>
            <div className={styles.headerActions}>
              <Button
                variant="primary"
                onClick={openCreateModal}
                disabled={productOptions.length === 0 || isMutating}
              >
                Send Request
              </Button>
            </div>
          </header>

          {!canUseEmailReminders ? (
            <div className={styles.upgradeBanner}>
              <div className={styles.upgradeBannerText}>
                <p className={styles.upgradeBannerTitle}>Automatic reminders are a Pro feature</p>
                <p className={styles.upgradeBannerSubtitle}>
                  Requests on this plan send once and stop — upgrade to automatically follow up on Day 3 and Day 7
                  for anyone who hasn&apos;t reviewed yet.
                </p>
              </div>
              <LinkButton to="/app/billing" variant="secondary">
                Upgrade to Pro
              </LinkButton>
            </div>
          ) : null}

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
                    dataFetcher.load(buildRequestsUrl({ status: event.target.value, page: 1 }));
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
                    dataFetcher.load(
                      buildRequestsUrl({ dateFilter: event.target.value as ReviewRequestDateFilter, page: 1 }),
                    );
                  }}
                >
                  {DATE_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.filterGroup}>
                <span className={styles.filterLabel}>Sort</span>
                <select
                  className={styles.filterSelect}
                  value={`${sortBy}:${sortDir}`}
                  onChange={(event) => {
                    dataFetcher.load(buildRequestsUrl({ sort: event.target.value, page: 1 }));
                  }}
                >
                  {SORT_OPTIONS.map((option) => (
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

          <Section title="Review requests">
            <div className={styles.resultsBar}>
              {selectedIds.length > 0 ? (
                <div className={styles.bulkBar}>
                  <span className={styles.bulkCount}>{selectedIds.length} selected</span>
                  {selectedSendEligibleCount > 0 ? (
                    <Button
                      type="button"
                      variant={allSelectedSendEligible ? "primary" : "secondary"}
                      onClick={() => {
                        const eligibleIds = effectiveRequests
                          .filter((request) => selectedIds.includes(request.id) && isEligibleForSend(request.status))
                          .map((request) => request.id);
                        submitAction({ _intent: "bulkSend", requestIds: eligibleIds });
                        setSelectedIds([]);
                      }}
                      disabled={isMutating}
                    >
                      {allSelectedSendEligible
                        ? `Send Now (${selectedSendEligibleCount})`
                        : `Send Now (${selectedSendEligibleCount} eligible)`}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={() => {
                      submitAction({ _intent: "bulkCancel", requestIds: selectedIds });
                      setSelectedIds([]);
                    }}
                    disabled={isMutating}
                  >
                    Cancel selected
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setSelectedIds([])} disabled={isMutating}>
                    Clear
                  </Button>
                </div>
              ) : (
                <p className={styles.resultsCount}>
                  {totalCount === 0 ? "No requests yet." : `Showing ${totalCount} request${totalCount === 1 ? "" : "s"}.`}
                </p>
              )}
            </div>

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
                      variant="primary"
                      onClick={openCreateModal}
                      disabled={productOptions.length === 0}
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
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.thCheckbox}>
                              <input
                                type="checkbox"
                                aria-label="Select all requests on this page"
                                checked={effectiveRequests.length > 0 && effectiveRequests.every((request) => selectedIds.includes(request.id))}
                                onChange={(event) => toggleSelectAllOnPage(event.target.checked)}
                                disabled={isLoading || isMutating || effectiveRequests.length === 0}
                              />
                            </th>
                            <th>Customer</th>
                            <th>Product</th>
                            <th className={styles.colOrder}>Order</th>
                            <th className={styles.colDate}>Scheduled</th>
                            <th>Status</th>
                            <th className={styles.thActions} aria-label="Actions" />
                          </tr>
                        </thead>
                        <tbody>
                          {effectiveRequests.map((request) => {
                            const isSelected = request.id === selectedRequestId;
                            const isChecked = selectedIds.includes(request.id);
                            const customerName = request.name ?? "Unnamed customer";
                            const productName = request.product?.name ?? "General request";
                            const rowActionsOpen = rowActionsOpenId === request.id;

                            return (
                              <tr
                                key={request.id}
                                className={`${styles.tr} ${isSelected ? styles.trSelected : ""}`}
                                onClick={() => setSelectedRequestId(request.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setSelectedRequestId(request.id);
                                  }
                                }}
                                tabIndex={0}
                                aria-selected={isSelected}
                              >
                                <td className={styles.tdCheckbox} onClick={(event) => event.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    aria-label={`Select request for ${customerName}`}
                                    onChange={(event) => toggleSelection(request.id, event.target.checked)}
                                  />
                                </td>
                                <td className={styles.tdCustomer}>
                                  <p className={styles.customerName}>{customerName}</p>
                                  {request.email ? <p className={styles.customerEmail}>{request.email}</p> : null}
                                </td>
                                <td className={styles.tdProduct}>
                                  {productName}
                                  {request.source === "order" ? <span className={styles.tdMuted}> · Automatic</span> : null}
                                </td>
                                <td className={`${styles.tdOrder} ${styles.colOrder}`}>
                                  {request.orderNumber ? `#${request.orderNumber}` : "—"}
                                </td>
                                <td className={`${styles.tdDate} ${styles.colDate}`}>{formatDateTime(request.scheduledFor)}</td>
                                <td className={styles.tdStatus}>
                                  <RequestStatusBadge status={request.status} />
                                </td>
                                <td className={styles.tdActions} onClick={(event) => event.stopPropagation()}>
                                  <Popover
                                    active={rowActionsOpen}
                                    onClose={() => setRowActionsOpenId(null)}
                                    activator={
                                      <button
                                        type="button"
                                        className={styles.rowActionsButton}
                                        onClick={() => setRowActionsOpenId(rowActionsOpen ? null : request.id)}
                                        disabled={isMutating}
                                        aria-label={`Actions for request from ${customerName}`}
                                        aria-haspopup="menu"
                                        aria-expanded={rowActionsOpen}
                                      >
                                        &#8226;&#8226;&#8226;
                                      </button>
                                    }
                                  >
                                    <ActionList
                                      sections={buildActionListSections(request, () => setRowActionsOpenId(null))}
                                    />
                                  </Popover>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className={styles.pagination}>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          dataFetcher.load(buildRequestsUrl({ page: page - 1 }));
                        }}
                        disabled={page <= 1 || isLoading || isMutating}
                      >
                        Previous
                      </Button>
                      <span className={styles.paginationLabel}>
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          dataFetcher.load(buildRequestsUrl({ page: page + 1 }));
                        }}
                        disabled={page >= totalPages || isLoading || isMutating}
                      >
                        Next
                      </Button>
                    </div>
                  </div>

                  {selectedRequest ? (
                    <aside className={styles.detailPanel} aria-label="Request details">
                      <div className={styles.detailHeader}>
                        <p className={styles.detailEyebrow}>
                          Selected request
                          <span className={styles.detailSourceTag}>
                            {" "}
                            &middot; {selectedRequest.source === "order" ? "Automatic" : "Manual"}
                          </span>
                        </p>
                        <div className={styles.detailStatusRow}>
                          <RequestStatusBadge status={selectedRequest.status} />
                        </div>
                        <h2 className={styles.detailTitle}>{selectedRequest.name ?? "Unnamed customer"}</h2>
                      </div>

                      <div className={styles.detailDivider} />

                      <div className={styles.detailBody}>
                        <div className={styles.detailMeta}>
                          <div className={styles.detailMetaRow}>
                            <span className={styles.detailMetaLabel}>Product</span>
                            <span className={styles.detailMetaValue}>
                              {selectedRequest.product?.name ?? "General request"}
                            </span>
                          </div>
                          {selectedRequest.orderNumber ? (
                            <div className={styles.detailMetaRow}>
                              <span className={styles.detailMetaLabel}>Order</span>
                              <span className={styles.detailMetaValue}>{selectedRequest.orderNumber}</span>
                            </div>
                          ) : null}
                          {selectedRequest.email ? (
                            <div className={styles.detailMetaRow}>
                              <span className={styles.detailMetaLabel}>Email</span>
                              <span className={styles.detailMetaValue}>{selectedRequest.email}</span>
                            </div>
                          ) : null}
                        </div>

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
                              {/* Same column backs both signals (see review-request.server.ts's
                                  markRequestOpened/markRequestClicked) — this store has no
                                  separate clickedAt, so the label says both rather than
                                  implying only one happened. */}
                              <span className={styles.detailScheduleLabel}>Opened / Clicked</span>
                              <span className={styles.detailValue}>{formatDateTime(selectedRequest.openedAt)}</span>
                            </div>
                            <div className={styles.detailScheduleItem}>
                              <span className={styles.detailScheduleLabel}>Completed</span>
                              <span className={styles.detailValue}>{formatDateTime(selectedRequest.reviewedAt)}</span>
                            </div>
                            <div className={styles.detailScheduleItem}>
                              <span className={styles.detailScheduleLabel}>Created</span>
                              <span className={styles.detailValue}>{formatDateTime(selectedRequest.createdAt)}</span>
                            </div>
                            {/* reminder1SentAt/reminderFinalSentAt (see review-request.server.ts) —
                                null until that specific reminder actually sends, independent of
                                whether a review was ever submitted, so "-" here can mean either
                                "not due yet" or "reminders are off for this store," not just
                                "hasn't happened." */}
                            <div className={styles.detailScheduleItem}>
                              <span className={styles.detailScheduleLabel}>Reminder #1</span>
                              <span className={styles.detailValue}>{formatDateTime(selectedRequest.reminder1SentAt)}</span>
                            </div>
                            <div className={styles.detailScheduleItem}>
                              <span className={styles.detailScheduleLabel}>Final Reminder</span>
                              <span className={styles.detailValue}>{formatDateTime(selectedRequest.reminderFinalSentAt)}</span>
                            </div>
                          </div>
                        </div>

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

                        {selectedRequest.customMessage ? (
                          <div className={styles.detailSection}>
                            <p className={styles.detailLabel}>Custom Message</p>
                            <p className={styles.detailValue}>{selectedRequest.customMessage}</p>
                          </div>
                        ) : null}
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
                            sections={buildActionListSections(selectedRequest, () => setActionsMenuOpen(false))}
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
                : duplicateWarning
                  ? "Send Anyway"
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
            (requestModalMode !== "reschedule" && (!customerEmailValue || !formState.productId)) ||
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
            {duplicateWarning ? (
              <Banner tone="warning" title="This might be a duplicate">
                <p>{duplicateWarning}</p>
              </Banner>
            ) : null}

            {requestModalMode !== "reschedule" ? (
              <>
                <p className={styles.modalSectionLabel}>Customer</p>
                <CustomerPicker
                  key={modalInstanceKey}
                  customers={customers}
                  value={formState.customer}
                  onChange={(value) => updateFormState({ customer: value })}
                  disabled={isMutating}
                />
                {attemptedSubmit && !customerEmailValue ? (
                  <p className={styles.fieldError}>Select or enter a customer to continue.</p>
                ) : null}

                {/* Progressive disclosure (create only) — edit keeps every field visible since
                    the merchant is revising a request that already has all of this filled in. */}
                {requestModalMode === "edit" || customerEmailValue ? (
                  <>
                    <p className={styles.modalSectionLabel}>Product &amp; order</p>
                    <Select
                      label="Product"
                      options={[{ label: "Select a product", value: "" }, ...productOptions]}
                      value={formState.productId}
                      onChange={(value) => updateFormState({ productId: value })}
                      error={attemptedSubmit && !formState.productId ? "Select a product." : undefined}
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
              </>
            ) : null}

            {requestModalMode === "edit" || requestModalMode === "reschedule" || (customerEmailValue && formState.productId) ? (
              <>
                <p className={styles.modalSectionLabel}>Schedule</p>
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
              </>
            ) : null}
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

      {/* Frame exists solely to satisfy Toast's required-ancestor context — see
          .toastFrame in app.requests.module.css for why it needs a layout override. */}
      <div className={styles.toastFrame}>
        <Frame>
          {toastState ? (
            <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} />
          ) : null}
        </Frame>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}