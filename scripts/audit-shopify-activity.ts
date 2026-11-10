/**
 * Read-only security audit of the development store's app-visible state.
 *
 * Written for the 2026-11-11 "unusual API activity" investigation. Changes nothing, creates
 * nothing, deletes nothing — every call is a query. The point is to answer "is there anything
 * on this store that we did not put there?" from the app's own credential.
 *
 * Run: node --import tsx --env-file=.env scripts/audit-shopify-activity.ts
 */
const STORE = "verveonline.myshopify.com";

const AUDIT = `#graphql
  query Audit {
    shop { name myshopifyDomain createdAt plan { partnerDevelopment shopifyPlus displayName } }
    currentAppInstallation {
      id
      accessScopes { handle }
      app { id title handle developerName }
    }
    codeDiscountNodes(first: 25, sortKey: CREATED_AT, reverse: true) {
      nodes { id codeDiscount { ... on DiscountCodeBasic { title status asyncUsageCount codes(first: 1) { nodes { code } } } } }
    }
    files(first: 25, sortKey: CREATED_AT, reverse: true) { nodes { id createdAt fileStatus } }
    webhookSubscriptions(first: 25) { nodes { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } }
  }
`;

interface AuditResponse {
  data?: {
    shop?: { name: string; myshopifyDomain: string; createdAt: string; plan?: { partnerDevelopment: boolean; shopifyPlus: boolean; displayName: string } };
    currentAppInstallation?: {
      id: string;
      accessScopes: { handle: string }[];
      app: { id: string; title: string; handle: string; developerName?: string | null };
    };
    codeDiscountNodes?: { nodes: { id: string; codeDiscount?: { title?: string; status?: string; createdBy?: { title?: string } | null; asyncUsageCount?: number; codes?: { nodes: { code: string }[] } } }[] };
    files?: { nodes: { id: string; createdAt: string; fileStatus: string }[] };
    webhookSubscriptions?: { nodes: { id: string; topic: string; endpoint?: { callbackUrl?: string } }[] };
  };
}

async function main() {
  const { unauthenticated } = await import("../app/shopify.server");
  const { admin } = await unauthenticated.admin(STORE);

  const response = await admin.graphql(AUDIT);
  const json = (await response.json()) as AuditResponse;
  const d = json.data;

  console.log("SHOP");
  console.log(`  ${d?.shop?.name} (${d?.shop?.myshopifyDomain})  created ${d?.shop?.createdAt}`);
  console.log(`  plan: ${d?.shop?.plan?.displayName}  partnerDevelopment=${d?.shop?.plan?.partnerDevelopment}  plus=${d?.shop?.plan?.shopifyPlus}`);

  const install = d?.currentAppInstallation;
  console.log("\nAPP INSTALLATION (the identity our token acts as)");
  console.log(`  app: ${install?.app?.title}  handle=${install?.app?.handle}  developer=${install?.app?.developerName ?? "n/a"}`);
  console.log(`  granted scopes (${install?.accessScopes?.length}): ${install?.accessScopes?.map((s) => s.handle).sort().join(", ")}`);

  const discounts = d?.codeDiscountNodes?.nodes ?? [];
  console.log(`\nDISCOUNT CODES (${discounts.length})`);
  for (const node of discounts) {
    const c = node.codeDiscount;
    console.log(`  ${c?.codes?.nodes?.[0]?.code ?? "?"}  status=${c?.status}  uses=${c?.asyncUsageCount}  title="${c?.title}"`);
  }

  const files = d?.files?.nodes ?? [];
  console.log(`\nFILES (${files.length} most recent)`);
  const byDay = new Map<string, number>();
  for (const f of files) byDay.set(f.createdAt.slice(0, 10), (byDay.get(f.createdAt.slice(0, 10)) ?? 0) + 1);
  for (const [day, count] of [...byDay].sort().reverse()) console.log(`  ${day}: ${count}`);

  const hooks = d?.webhookSubscriptions?.nodes ?? [];
  console.log(`\nWEBHOOK SUBSCRIPTIONS (${hooks.length})`);
  for (const h of hooks) console.log(`  ${h.topic} -> ${h.endpoint?.callbackUrl ?? "(non-http endpoint)"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Keeps this file a module so its top-level consts do not collide with the other scripts.
export {};
