import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
    // Pre-transform the shell + top-level routes on server start instead of on
    // first request, so the first navigation to each of these doesn't pay a
    // cold on-demand transform cost.
    warmup: {
      clientFiles: [
        "./app/root.tsx",
        "./app/routes/app.tsx",
        "./app/routes/app._index.tsx",
        "./app/routes/app.products.tsx",
        "./app/routes/app.reviews.tsx",
        "./app/routes/app.requests.tsx",
        "./app/routes/app.widgets.tsx",
        "./app/routes/app.settings.tsx",
      ],
      ssrFiles: [
        "./app/entry.server.tsx",
        "./app/root.tsx",
        "./app/routes/app.tsx",
        "./app/routes/app._index.tsx",
        "./app/routes/app.products.tsx",
        "./app/routes/app.reviews.tsx",
        "./app/routes/app.requests.tsx",
        "./app/routes/app.widgets.tsx",
        "./app/routes/app.settings.tsx",
      ],
    },
  },
  plugins: [
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    // Explicitly listing everything Vite otherwise discovers lazily prevents a
    // mid-session "new dependency optimized" re-bundle + full reload, which
    // pauses all in-flight requests until it finishes.
    include: [
      "@shopify/app-bridge-react",
      "@shopify/polaris",
      "@shopify/shopify-app-react-router/react",
      "@shopify/shopify-app-react-router/server",
      "@shopify/shopify-app-react-router/adapters/node",
      "@shopify/shopify-app-session-storage-prisma",
      "@prisma/client",
      "react",
      "react-dom",
      "react-dom/client",
      "react-router",
      "react-router/dom",
    ],
  },
}) satisfies UserConfig;
