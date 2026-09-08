// Shared real Shopify discount-code creation — extracted from rewards.server.ts so
// coupons.server.ts and rewards.server.ts call the exact same Admin GraphQL mutation
// instead of two copies of the same business logic drifting apart.

interface DiscountCodeBasicCreateResponse {
  data?: {
    discountCodeBasicCreate?: {
      codeDiscountNode?: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    };
  };
}

const DISCOUNT_CODE_BASIC_CREATE = `#graphql
  mutation DiscountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

interface DiscountCodeDeactivateResponse {
  data?: {
    discountCodeDeactivate?: {
      codeDiscountNode?: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  };
}

const DISCOUNT_CODE_DEACTIVATE = `#graphql
  mutation DiscountCodeDeactivate($id: ID!) {
    discountCodeDeactivate(id: $id) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface DiscountUsageCountResponse {
  data?: {
    codeDiscountNodeByCode?: {
      id: string;
      codeDiscount?: {
        asyncUsageCount?: number;
      };
    } | null;
  };
}

const DISCOUNT_USAGE_COUNT_QUERY = `#graphql
  query DiscountUsageCount($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          asyncUsageCount
        }
      }
    }
  }
`;

export interface DiscountValue {
  valueType: "percentage" | "fixed_amount";
  value: number;
}

export interface CreateDiscountInput extends DiscountValue {
  title: string;
  code: string;
  usageLimit?: number;
  appliesOncePerCustomer?: boolean;
  minimumSubtotal?: number;
  endsAt?: Date | null;
}

async function getAdminClient(storeDomain: string) {
  // Imported lazily (not at module scope) — same reason rewards.server.ts's original
  // version did: merely importing this file (transitively, from services that only test
  // unrelated logic) should never eagerly evaluate shopify.server.ts's top-level
  // PrismaSessionStorage construction.
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(storeDomain);
  return admin;
}

export async function createShopifyDiscount(
  storeDomain: string,
  input: CreateDiscountInput,
): Promise<{ ok: true; discountId: string } | { ok: false; error: string }> {
  const admin = await getAdminClient(storeDomain);

  const customerGets =
    input.valueType === "percentage"
      ? { value: { percentage: input.value / 100 }, items: { all: true } }
      : { value: { discountAmount: { amount: input.value, appliesOnEachItem: false } }, items: { all: true } };

  const basicCodeDiscount = {
    title: input.title,
    code: input.code,
    startsAt: new Date().toISOString(),
    ...(input.endsAt ? { endsAt: input.endsAt.toISOString() } : {}),
    customerSelection: { all: true },
    customerGets,
    ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
    ...(input.appliesOncePerCustomer !== undefined ? { appliesOncePerCustomer: input.appliesOncePerCustomer } : {}),
    ...(input.minimumSubtotal !== undefined
      ? { minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: input.minimumSubtotal } } }
      : {}),
  };

  const response = await admin.graphql(DISCOUNT_CODE_BASIC_CREATE, { variables: { basicCodeDiscount } });
  const json = (await response.json()) as DiscountCodeBasicCreateResponse;
  const result = json.data?.discountCodeBasicCreate;

  if (!result || result.userErrors.length > 0) {
    const message = result?.userErrors.map((error) => error.message).join(" ") || "Unable to create the discount.";
    return { ok: false, error: message };
  }

  if (!result.codeDiscountNode?.id) {
    return { ok: false, error: "Shopify did not return a discount id." };
  }

  return { ok: true, discountId: result.codeDiscountNode.id };
}

// Deactivates a still-unused discount code — used by coupons.server.ts to let a merchant
// revoke an issued-but-unredeemed coupon. Deactivating (not deleting) preserves the
// discount's own real usage history in Shopify.
export async function deactivateShopifyDiscount(
  storeDomain: string,
  discountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await getAdminClient(storeDomain);

  const response = await admin.graphql(DISCOUNT_CODE_DEACTIVATE, { variables: { id: discountId } });
  const json = (await response.json()) as DiscountCodeDeactivateResponse;
  const result = json.data?.discountCodeDeactivate;

  if (!result || result.userErrors.length > 0) {
    const message = result?.userErrors.map((error) => error.message).join(" ") || "Unable to deactivate the discount.";
    return { ok: false, error: message };
  }

  return { ok: true };
}

// Real usage count, read directly from Shopify — the mechanism referrals.server.ts uses to
// detect a referral conversion without a new webhook subscription (see ReferralProgram's
// schema comment for why). Returns null if Shopify has no record of the code at all (e.g.
// it was never actually created, or was deleted).
export async function getShopifyDiscountUsageCount(storeDomain: string, code: string): Promise<number | null> {
  const admin = await getAdminClient(storeDomain);

  const response = await admin.graphql(DISCOUNT_USAGE_COUNT_QUERY, { variables: { code } });
  const json = (await response.json()) as DiscountUsageCountResponse;
  const node = json.data?.codeDiscountNodeByCode;

  if (!node) {
    return null;
  }

  return node.codeDiscount?.asyncUsageCount ?? 0;
}
