import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "@shopify/polaris/build/esm/styles.css";
import "./styles/design-system.css";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* Explicit icon links, not just the implicit /favicon.ico probe — browsers cache
            favicons per-origin far more aggressively than normal page assets, independent of
            HTTP cache headers, so a same-path swap alone can keep showing the old icon. The
            "?v=2" query strings force every icon to be treated as a new resource. */}
        <link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml" />
        <link rel="alternate icon" href="/favicon.ico?v=2" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3" />
        {/* Preloaded, not merely linked. Geist Sans is the font every word of the admin is
            set in, and it is discovered by the browser only after design-system.css has been
            fetched and parsed — which is exactly late enough to produce a visible swap from
            Helvetica on a cold load. `crossOrigin` is required even for a same-origin font:
            fonts are always fetched in CORS mode, and without it the preload is discarded and
            the file fetched a second time. */}
        <link
          rel="preload"
          href="/fonts/Geist-Variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
