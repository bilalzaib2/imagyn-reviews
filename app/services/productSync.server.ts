// Orchestrates a full-catalog product sync as a background job — separate from
// product.server.ts's syncAllProducts (the pure pagination/upsert logic) because this file
// owns things that logic doesn't need to know about: re-deriving its own Shopify admin
// session, and reading/writing the Store row's sync-state columns.
import { unauthenticated } from "../shopify.server";
import { syncAllProducts } from "./product.server";
import {
  finishProductSync,
  getProductSyncState,
  startProductSync,
  updateProductSyncProgress,
  type ProductSyncState,
} from "./store.server";

// A "running" sync older than this is treated as stale rather than actually in progress — the
// only way a store's status can get stuck on "running" forever is the Node process dying
// mid-sync (a deploy, a crash) before it could write "failed". Long enough that a very large
// catalog under normal Shopify throttling still finishes well within this window; short enough
// that a merchant isn't blocked from retrying for more than a session.
export const STALE_SYNC_THRESHOLD_MS = 45 * 60 * 1000;

export function isProductSyncInProgress(state: ProductSyncState): boolean {
  if (state.status !== "running") {
    return false;
  }
  if (!state.startedAt) {
    return false;
  }
  return Date.now() - state.startedAt.getTime() < STALE_SYNC_THRESHOLD_MS;
}

// The actual background job. Never awaited by its caller (app.products.tsx's action starts
// this and returns immediately) — this keeps running on the same long-lived Node process
// (react-router-serve, not a serverless function) for as long as the full catalog takes.
// Re-derives its own AdminApiContext via the store's persisted offline session
// (unauthenticated.admin) instead of reusing the triggering request's admin context, so it
// isn't tied to that HTTP request's lifecycle — the same pattern billing.server.ts's
// syncBillingFromShopify and the webhook handlers already use for background/out-of-request
// Admin API access.
export async function runProductSync(shop: string, storeId: string): Promise<void> {
  try {
    const { admin } = await unauthenticated.admin(shop);

    await syncAllProducts(admin, storeId, async (progress) => {
      await updateProductSyncProgress(storeId, progress);
    });

    await finishProductSync(storeId, { status: "completed", error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error during product sync.";
    console.error(`[productSync] Sync failed for store ${storeId}:`, error);

    try {
      await finishProductSync(storeId, { status: "failed", error: message });
    } catch (writeError) {
      // The sync itself failed AND we couldn't even record that it failed (e.g. a DB blip) —
      // logging is all that's left; the store is left showing "running" until the staleness
      // window above lets a merchant retry.
      console.error(`[productSync] Failed to record failure state for store ${storeId}:`, writeError);
    }
  }
}

// Shared by both trigger points — app.products.tsx's manual "Sync products" action and
// triggerInitialProductSyncIfNeeded below — so there's exactly one place that marks a sync
// "running" and fires the (deliberately unawaited) background job.
async function startAndRunProductSync(shop: string, storeId: string): Promise<void> {
  await startProductSync(storeId);

  runProductSync(shop, storeId).catch((error) => {
    console.error(`[productSync] Unhandled error starting product sync for ${shop}:`, error);
  });
}

// Called from shopify.server.ts's afterAuth, which fires on every OAuth completion (fresh
// install AND reinstall/re-auth alike — see that file's own comment on this). Gated on
// productSyncStatus still being "idle" — i.e. this store has never had a sync started at
// all — so this only ever acts once per store's lifetime: a store that already completed a
// sync, is currently running one, or previously failed one is left untouched here, matching
// "don't block/interrupt the merchant unnecessarily." A merchant can always fall back to the
// existing manual "Sync products" action (app.products.tsx) to retry or re-sync later,
// regardless of this gate.
export async function triggerInitialProductSyncIfNeeded(shop: string, storeId: string): Promise<void> {
  try {
    const state = await getProductSyncState(storeId);
    if (state.status !== "idle") {
      return;
    }

    await startAndRunProductSync(shop, storeId);
  } catch (error) {
    // Must never break authentication — installing/opening the app has to keep working even
    // if this best-effort kickoff fails outright (e.g. a DB blip reading sync state).
    console.error(`[productSync] Unable to start initial product sync for ${shop}:`, error);
  }
}
