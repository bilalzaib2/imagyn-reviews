import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { getOrCreateStore } from "./services/store.server";
import { syncBillingFromShopify } from "./services/billing/billing.server";

const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "http://127.0.0.1:3000";
const apiKey = process.env.SHOPIFY_API_KEY || "development-api-key";
const apiSecretKey = process.env.SHOPIFY_API_SECRET || "development-secret";

const shopify = shopifyApp({
  apiKey,
  apiSecretKey,
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  // No `billing` config: this app is on Shopify Managed Pricing, where Shopify hosts plan
  // selection and owns charge creation entirely (see services/billing/billing.server.ts's
  // getPricingPlansUrl). The Billing API's create/cancel mutations are rejected outright for
  // Managed Pricing apps, so there's nothing here for the SDK's billing config to describe —
  // plan names/prices/trial length still live once in services/billing/plans.ts, just for this
  // app's own display copy and feature-gating, not for driving a Shopify billing config.
  hooks: {
    // Only app.billing.tsx's loader ever re-syncs plan/planStatus from Shopify otherwise. A
    // reinstalling merchant's Store row still carries whatever plan they had before
    // uninstalling (Shopify auto-cancels the subscription on uninstall, but nothing local
    // reflects that), so without this, a reinstalled merchant could keep looking like they're
    // on a paid plan — and never get re-prompted to subscribe — until they happen to visit
    // /app/billing. Runs on every OAuth completion (fresh install and reinstall alike), so the
    // very first request after auth already has a correct plan/planStatus.
    afterAuth: async ({ session, admin }) => {
      const store = await getOrCreateStore(session.shop);
      await syncBillingFromShopify(admin, store);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
