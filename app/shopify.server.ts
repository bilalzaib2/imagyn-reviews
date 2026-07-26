import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { PLANS } from "./services/billing/plans";

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
  // Plan names/prices/trial length are defined once in services/billing/plans.ts — this just
  // maps those onto Shopify's recurring-charge config shape. Starter is free and has no
  // Shopify subscription at all, so it isn't represented here.
  billing: {
    Growth: {
      trialDays: PLANS.growth.trialDays,
      lineItems: [
        { amount: PLANS.growth.price, currencyCode: PLANS.growth.currencyCode, interval: BillingInterval.Every30Days },
      ],
    },
    Pro: {
      trialDays: PLANS.pro.trialDays,
      lineItems: [
        { amount: PLANS.pro.price, currencyCode: PLANS.pro.currencyCode, interval: BillingInterval.Every30Days },
      ],
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
