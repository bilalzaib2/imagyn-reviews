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
    //
    // That reload is not merely a pause inside Shopify's embedded iframe — it strands the
    // dashboard as completely unstyled HTML, permanently, until a manual refresh. The chain,
    // captured live on verveonline on 2026-11-11:
    //
    //   1:15:44  [vite] Re-optimizing dependencies because lockfile has changed
    //   1:17:51  [vite] ✨ optimized dependencies changed. reloading     <- dashboard loading
    //
    // In dev, React Router does not emit stylesheet <link> tags at all. It inlines everything
    // into a single <style data-react-router-critical-css> in the SSR document, and then
    // HydratedRouter deletes that tag on mount — unconditionally, with no check that anything
    // replaced it (react-router/dist/development/dom-export.mjs: `setCriticalCss(void 0)` in a
    // mount effect, then `document.querySelectorAll('[data-react-router-critical-css]')
    // .forEach((element) => element.remove())`). The real styles are expected to arrive
    // separately, as <style data-vite-dev-id> tags injected by the client module graph.
    //
    // A dependency re-optimization invalidates the ?v=<hash> module URLs that graph is built
    // from, and Vite recovers by calling location.reload(). Top-level that recovery works —
    // measured over the tunnel, the public route came back with 5 injected style tags and
    // 2388 rules. Inside the embedded iframe it does not, so the page keeps the state it was
    // left in: critical CSS already deleted, replacement styles never injected. Hydration
    // still completes and loader data still renders, which is why it looks like a CSS bug
    // rather than a dependency bug.
    //
    // So the eight entries below are not tidiness. Each one was discovered lazily while the
    // dashboard's own route tree loaded (diffed from node_modules/.vite/deps/_metadata.json,
    // whose mtime was 1:17:51 — the reload itself). Pre-bundling them at startup removes the
    // only observed trigger.
    //
    // resend, @react-email/* and sanitize-html are server-only — they reach the client
    // optimizer because its scanner crawls the route modules that import the email services,
    // and @react-email/render resolves to its browser build. They are listed rather than
    // excluded deliberately: optimizeDeps is dev-only and never affects the production bundle,
    // whereas excluding a CJS package (sanitize-html ships CJS) breaks its dev interop.
    include: [
      "@shopify/app-bridge-react",
      "@shopify/polaris",
      "@shopify/polaris-icons",
      "@shopify/shopify-app-react-router/react",
      "@shopify/shopify-app-react-router/server",
      "@shopify/shopify-app-react-router/adapters/node",
      "@shopify/shopify-app-session-storage-prisma",
      "@prisma/client",
      "@react-email/components",
      "@react-email/render",
      "papaparse",
      "react",
      "react-dom",
      "react-dom/client",
      "react-router",
      "react-router/dom",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "resend",
      "sanitize-html",
    ],
  },
}) satisfies UserConfig;
