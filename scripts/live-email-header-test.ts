/*
 * Live header verification for BOTH merchant-facing email flows.
 *
 * Sends through the real Resend integration and prints the provider's message id plus the exact
 * To / From / Reply-To submitted for each, so the two Judge.me parity rules can be checked
 * against real delivered mail rather than inferred from code:
 *
 *   FLOW 1 — customer review request
 *     To:       the customer
 *     From:     the Imagyn platform sender, display name = the store
 *     Reply-To: the merchant's Shopify customer-facing contact email
 *     => a CUSTOMER replying reaches the MERCHANT.
 *
 *   FLOW 2 — merchant new-review notification
 *     To:       the merchant's notification inbox
 *     From:     the Imagyn platform sender
 *     Reply-To: the REVIEWER's own validated address
 *     => a MERCHANT replying reaches the CUSTOMER.
 *
 * SAFETY
 *  - Refuses to run unless DATABASE_URL points at localhost.
 *  - Every `to:` is the single authorised inbox. There is no flag to widen it.
 *  - Flow 2's Reply-To uses a plus-alias of that same mailbox, so the header is distinguishable
 *    from the To in the received mail and a real reply still lands in the authorised inbox.
 *    Nothing is ever delivered TO a Reply-To address; it is a routing hint for the client.
 *  - Creates its own store/product/review/request rows under an unmistakable prefix and deletes
 *    every one of them in a finally block.
 *
 * USAGE
 *   npx tsx scripts/live-email-header-test.ts --i-understand-this-sends-real-email
 */
import { randomUUID } from "node:crypto";

const AUTHORISED_INBOX = "bilal.zaib@outlook.com";
/** Same mailbox, distinguishable in the received headers. */
const AUTHORISED_REVIEWER_ALIAS = "bilal.zaib+reviewer@outlook.com";
const ROW_PREFIX = "imagyn-live-header-test";

const argv = new Set(process.argv.slice(2));

function fail(message: string): never {
  console.error(`\n  ABORTED: ${message}\n`);
  process.exit(1);
}

function loadEnvFile(): void {
  const loader = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;
  if (typeof loader !== "function") return;
  try {
    loader(".env");
  } catch {
    /* reported by the checks below */
  }
}

async function main(): Promise<void> {
  console.log("\nLive email header verification\n");
  loadEnvFile();

  if (!argv.has("--i-understand-this-sends-real-email")) {
    fail("This sends real email. Re-run with --i-understand-this-sends-real-email.");
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail("DATABASE_URL is not set.");
  let host: string;
  try {
    host = new URL(dbUrl).hostname;
  } catch {
    fail("DATABASE_URL could not be parsed.");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    fail(`DATABASE_URL points at "${host}", which is not local.`);
  }
  if (!process.env.RESEND_API_KEY) fail("RESEND_API_KEY is not set.");
  if (!process.env.RESEND_FROM_EMAIL) fail("RESEND_FROM_EMAIL is not set.");

  console.log(`  database:  ${host} (local)`);
  console.log(`  recipient: ${AUTHORISED_INBOX} (only)`);
  console.log(`  flow 2 reply-to: ${AUTHORISED_REVIEWER_ALIAS} (same mailbox)\n`);

  const { default: prisma } = await import("../app/db.server");
  const { dispatchRequestEmail, reviewRequestService } = await import("../app/services/review-request.server");
  const { sendNewReviewNotification } = await import("../app/services/reviewNotifications.server");
  const { resolveSenderIdentity } = await import("../app/services/emailSenderIdentity.server");
  const { getStorePermissions } = await import("../app/services/permissions");

  const runId = randomUUID().slice(0, 8);
  const slug = `${ROW_PREFIX}-${runId}`;
  let storeId: string | null = null;

  try {
    // Pro plan: the branded-sender entitlement is Pro-only, and this run should exercise the
    // same identity a paying merchant gets. contactEmail is what Flow 1's Reply-To resolves to.
    const store = await prisma.store.create({
      data: {
        // A realistic merchant name, deliberately. The From display name and the
        // merchant-scoped From local part are both derived from this, so a fixture called
        // "Live Test <hex>" produced mail that looked like spam to both a filter and a human.
        name: "Coastal Threads",
        slug,
        domain: `${slug}.myshopify.com`,
        plan: "growth",
        planStatus: "active",
        contactEmail: AUTHORISED_INBOX,
        newReviewNotifyEnabled: true,
        newReviewNotifyEmail: AUTHORISED_INBOX,
      },
    });
    storeId = store.id;

    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        shopifyProductId: `gid://shopify/Product/live-${runId}`,
        name: "Coastal Linen Jacket",
        handle: `${slug}-product`,
      },
    });

    // What Flow 1's headers will resolve to, printed before sending so the expectation is on
    // record independently of what the provider log then shows.
    const permissions = await getStorePermissions(store.id);
    const identity = resolveSenderIdentity(store, permissions, null);
    console.log("  FLOW 1 expected headers");
    console.log(`    From display name: ${identity.displayName}`);
    console.log(`    From address:      ${identity.fromAddress}`);
    console.log(`    Reply-To:          ${identity.replyTo} (source: ${identity.replyToSource})`);
    console.log("");

    // ---- FLOW 1: customer review request --------------------------------------------
    const created = await reviewRequestService.createRequest(store.id, {
      productId: product.id,
      email: AUTHORISED_INBOX,
      name: "Bilal",
      orderNumber: `#LIVE-${runId}`,
      delayDays: 1,
    });

    const scheduled = await reviewRequestService.getRequest(created.request.id);
    console.log("  FLOW 1 sending (customer review request)...");
    const sent = await dispatchRequestEmail(scheduled!);
    console.log(`    status after send: ${sent.status}, sentAt: ${sent.sentAt?.toISOString() ?? "null"}\n`);

    // ---- FLOW 2: merchant new-review notification -----------------------------------
    // A real Review row, with the reviewer's address set to the authorised alias so the
    // Reply-To is visibly distinct from the To in the received mail.
    const review = await prisma.review.create({
      data: {
        storeId: store.id,
        productId: product.id,
        productTitle: product.name,
        rating: 5,
        title: "Exactly what I hoped for",
        content:
          "Ordered on a Thursday and it arrived Saturday. The linen is heavier than I expected, " +
          "in a good way, and the fit is true to the size guide.",
        reviewerName: "Bilal Zaib",
        reviewerEmail: AUTHORISED_REVIEWER_ALIAS,
        verifiedPurchase: true,
        status: "APPROVED",
        isPublished: true,
        moderationStatus: "auto_approved",
      },
    });

    console.log("  FLOW 2 sending (merchant new-review notification)...");
    await sendNewReviewNotification({
      storeId: store.id,
      reviewId: review.id,
      source: "review_request",
    });

    console.log("\n  Both sends complete. The [resend] lines above carry each message id and its");
    console.log("  exact submitted headers.\n");
    console.log(`  In ${AUTHORISED_INBOX}, confirm:`);
    console.log("    1. Review request  — Reply-To is the MERCHANT contact address.");
    console.log("    2. New-review mail — Reply-To is the REVIEWER alias (+reviewer).");
    console.log("    3. Both render correctly, and every link resolves.");
  } finally {
    if (storeId) {
      await prisma.store.delete({ where: { id: storeId } }).catch((error: unknown) => {
        console.error(`  cleanup failed for store ${storeId} — remove it by hand:`, error);
      });
      console.log(`\n  cleanup: removed test store ${slug}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
