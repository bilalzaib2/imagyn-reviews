/**
 * Real development-store integration test for the discount lifecycle.
 *
 * Drives the app's own service functions (createShopifyDiscount / deactivate / activate /
 * getShopifyDiscountUsageCount) against the live Shopify Admin API, then verifies every
 * outcome by reading it back from Shopify rather than trusting the mutation's return value.
 * A mutation that reports ok is not evidence the discount exists, is active, or carries the
 * value we asked for — only a read-back is.
 *
 * Safety rules this script enforces itself:
 *   - refuses to run against a non-local DATABASE_URL
 *   - refuses to run against any store but the development store
 *   - every code it creates carries the E2E_PREFIX so it is identifiable as test data
 *   - deletes the discount it created in a finally block, so no live discount is left behind
 *     even if an assertion throws partway through
 *
 * Run: node --import tsx --env-file=.env scripts/e2e-shopify-discounts.ts
 */
import { createShopifyDiscount, deactivateShopifyDiscount, activateShopifyDiscount, getShopifyDiscountUsageCount } from "../app/services/shopifyDiscount.server";

const STORE = "verveonline.myshopify.com";
const E2E_PREFIX = "IMAGYN-E2E-";

const results: { ok: boolean; name: string; detail: string }[] = [];
const record = (ok: boolean, name: string, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL || "";
  const host = url.replace(/^[a-z]+:\/\/[^@]*@?/, "").split(/[/?]/)[0] || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
    console.error(`Refusing to run: DATABASE_URL points at "${host}", not a local database.`);
    process.exit(1);
  }
  console.log(`Database: local (${host})`);
}

// Read-back queries. These deliberately re-query Shopify by code rather than by the id the
// mutation handed back, so the test proves the code a shopper would actually type resolves to
// the discount we think we created.
const READ_BY_CODE = `#graphql
  query ReadDiscountByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          title
          status
          asyncUsageCount
          usageLimit
          appliesOncePerCustomer
          codes(first: 5) { nodes { code } }
          customerGets { value { ... on DiscountPercentage { percentage } } }
          minimumRequirement {
            ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
          }
        }
      }
    }
  }
`;

const DELETE_DISCOUNT = `#graphql
  mutation DeleteDiscount($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors { field message }
    }
  }
`;

// The subset of DiscountCodeBasic this test actually asserts on. Narrower than Shopify's real
// type on purpose: anything not listed here is something the test does not claim to check.
interface BasicCodeDiscount {
  title?: string;
  status?: string;
  asyncUsageCount?: number;
  usageLimit?: number | null;
  appliesOncePerCustomer?: boolean;
  codes?: { nodes: { code: string }[] };
  customerGets?: { value?: { percentage?: number } };
  minimumRequirement?: { greaterThanOrEqualToSubtotal?: { amount?: string } };
}

async function adminClient() {
  const { unauthenticated } = await import("../app/shopify.server");
  const { admin } = await unauthenticated.admin(STORE);
  return admin;
}

async function readByCode(code: string) {
  const admin = await adminClient();
  const response = await admin.graphql(READ_BY_CODE, { variables: { code } });
  const json = (await response.json()) as {
    data?: { codeDiscountNodeByCode?: { id: string; codeDiscount?: BasicCodeDiscount } | null };
  };
  return json.data?.codeDiscountNodeByCode ?? null;
}

async function main() {
  assertLocalDatabase();

  const code = `${E2E_PREFIX}${Date.now()}`;
  const title = `Imagyn E2E discount ${code}`;
  let discountId: string | null = null;

  try {
    // 1. Create, through the app's own service, exactly as Coupons does.
    const created = await createShopifyDiscount(STORE, {
      title,
      code,
      valueType: "percentage",
      value: 10,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      minimumSubtotal: 5,
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    record(created.ok, "createShopifyDiscount returns ok", created.ok ? created.discountId : created.error);
    if (!created.ok) return;
    discountId = created.discountId;

    // 2. Read it back from Shopify by the code a shopper would type.
    const node = await readByCode(code);
    record(node !== null, "Shopify resolves the code to a real discount", node ? `id=${node.id}` : "codeDiscountNodeByCode returned null");
    if (!node) return;

    const d = node.codeDiscount;
    record(node.id === discountId, "read-back id matches the id the mutation returned", `${node.id}`);
    record(d?.status === "ACTIVE", "Shopify reports the new discount as ACTIVE", `status=${d?.status}`);
    record(d?.title === title, "title round-trips", `title=${d?.title}`);
    record(
      Boolean(d?.codes?.nodes?.some((n) => n.code === code)),
      "the discount carries the code we asked for",
      `codes=${d?.codes?.nodes?.map((n) => n.code).join(",")}`,
    );

    // Shopify stores percentage as a 0–1 fraction; the service divides by 100 on the way in.
    const pct = d?.customerGets?.value?.percentage;
    record(pct === 0.1, "10% was stored as Shopify's 0.1 fraction, not 10", `percentage=${pct}`);
    record(d?.usageLimit === 1, "usageLimit round-trips", `usageLimit=${d?.usageLimit}`);
    record(d?.appliesOncePerCustomer === true, "appliesOncePerCustomer round-trips", `${d?.appliesOncePerCustomer}`);
    record(
      Number(d?.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount) === 5,
      "minimum subtotal round-trips",
      `minimum=${d?.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount}`,
    );

    // 3. Usage count on a brand-new, unredeemed code.
    const usage = await getShopifyDiscountUsageCount(STORE, code);
    record(usage === 0, "getShopifyDiscountUsageCount reads 0 for an unredeemed code", `usage=${usage}`);

    // 4. Revocation — deactivate, then confirm Shopify itself reports it inactive.
    const deactivated = await deactivateShopifyDiscount(STORE, discountId);
    record(deactivated.ok, "deactivateShopifyDiscount returns ok", deactivated.ok ? "" : deactivated.error);

    const afterDeactivate = await readByCode(code);
    const statusAfterDeactivate = afterDeactivate?.codeDiscount?.status;
    record(
      statusAfterDeactivate === "EXPIRED" || statusAfterDeactivate === "SCHEDULED",
      "Shopify no longer reports the revoked discount as ACTIVE",
      `status=${statusAfterDeactivate}`,
    );

    // 5. Reactivation — the merchant-facing "resume" path.
    const activated = await activateShopifyDiscount(STORE, discountId);
    record(activated.ok, "activateShopifyDiscount returns ok", activated.ok ? "" : activated.error);

    const afterActivate = await readByCode(code);
    record(
      afterActivate?.codeDiscount?.status === "ACTIVE",
      "Shopify reports the resumed discount as ACTIVE again",
      `status=${afterActivate?.codeDiscount?.status}`,
    );

    // 6. An unknown code must read as null, not as 0 — the distinction referrals.server.ts
    //    relies on to tell "never created" from "created but unused".
    const unknown = await getShopifyDiscountUsageCount(STORE, `${E2E_PREFIX}DOES-NOT-EXIST`);
    record(unknown === null, "an unknown code reads as null, not 0", `result=${unknown}`);
  } finally {
    // Always clean up. An unused percentage code on a dev store is harmless, but leaving test
    // data behind is how a store ends up with discounts nobody can account for.
    if (discountId) {
      try {
        const admin = await adminClient();
        const response = await admin.graphql(DELETE_DISCOUNT, { variables: { id: discountId } });
        const json = (await response.json()) as {
          data?: { discountCodeDelete?: { deletedCodeDiscountId?: string; userErrors: { message: string }[] } };
        };
        const deleted = json.data?.discountCodeDelete;
        const ok = Boolean(deleted?.deletedCodeDiscountId) && (deleted?.userErrors?.length ?? 0) === 0;
        record(ok, "test discount deleted from Shopify (cleanup)", ok ? deleted!.deletedCodeDiscountId! : JSON.stringify(deleted?.userErrors));

        const gone = await readByCode(code);
        record(gone === null, "the deleted code no longer resolves on Shopify", gone ? `still present: ${gone.id}` : "null");
      } catch (error) {
        record(false, "test discount deleted from Shopify (cleanup)", String(error));
      }
    }

    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} checks passed.`);
    if (passed !== results.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
