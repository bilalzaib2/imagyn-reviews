import { data, Form, isRouteErrorResponse, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { emailSuppressionService, verifyUnsubscribeToken } from "../services/emailSuppression.server";
import { Button } from "../components/ui/Button";
import styles from "../styles/review-link.module.css";

type UnsubscribeErrorReason = "invalid_link";

// Public, unauthenticated on purpose — no authenticate.admin() call. Reached only via the
// unsubscribe link in an automated review-request/reminder email (see
// emailSuppression.server.ts's buildUnsubscribeUrl), never linked to from the admin or
// storefront. GET only ever reads/validates — it never suppresses anything itself, specifically
// because corporate mail-security scanners auto-visit (GET) every link in an inbound email
// before a human opens it, which would falsely trigger an unsubscribe if GET alone mutated
// state. Only the POST action (below) suppresses, mirroring r.$token.tsx's own
// GET-validates/POST-mutates split.
function readParams(url: URL): { storeId: string; email: string; token: string } | null {
  const storeId = url.searchParams.get("store");
  const email = url.searchParams.get("email");
  const token = url.searchParams.get("token");

  if (!storeId || !email || !token) {
    return null;
  }

  return { storeId, email, token };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const params = readParams(url);

  if (!params || !verifyUnsubscribeToken(params.storeId, params.email, params.token)) {
    throw data({ reason: "invalid_link" as UnsubscribeErrorReason }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { id: params.storeId }, select: { id: true, name: true } });

  if (!store) {
    throw data({ reason: "invalid_link" as UnsubscribeErrorReason }, { status: 400 });
  }

  const alreadySuppressed = await emailSuppressionService.isSuppressed(store.id, params.email);

  return {
    storeName: store.name,
    email: params.email,
    alreadySuppressed,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const params = readParams(url);

  if (!params || !verifyUnsubscribeToken(params.storeId, params.email, params.token)) {
    return data({ ok: false as const, error: "This unsubscribe link isn't valid." }, { status: 400 });
  }

  // Idempotent — emailSuppressionService.suppress upserts, so a second submission (e.g. a
  // double-click, or the same link visited again later) never errors and never creates a
  // duplicate row.
  await emailSuppressionService.suppress(params.storeId, params.email);

  return { ok: true as const };
};

export default function UnsubscribePage() {
  const { storeName, email, alreadySuppressed } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  if (actionData?.ok || alreadySuppressed) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.status}>
            <div className={styles.statusIcon} aria-hidden="true">
              ✓
            </div>
            <h1 className={styles.title}>You&apos;re unsubscribed</h1>
            <p className={styles.message}>
              {email} will no longer receive automated review request or reminder emails from {storeName}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>{storeName}</p>
        <h1 className={styles.title}>Stop these emails?</h1>
        <p className={styles.message}>
          Unsubscribe {email} from future automated review request and reminder emails from {storeName}.
        </p>

        {actionData && !actionData.ok ? <div className={styles.error}>{actionData.error}</div> : null}

        <Form method="post">
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Unsubscribing…" : "Unsubscribe"}
          </Button>
        </Form>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.status}>
            <div className={styles.statusIcon} aria-hidden="true">
              !
            </div>
            <h1 className={styles.title}>Link not valid</h1>
            <p className={styles.message}>This unsubscribe link isn&apos;t valid. If you&apos;re trying to stop these emails, reply to the original email instead.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.status}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.message}>Please try again in a moment.</p>
        </div>
      </div>
    </div>
  );
}
