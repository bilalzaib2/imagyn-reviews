import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { Button } from "../../components/ui/Button";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify Admin's embedded navigation doesn't always include `shop` — a plain `host`
  // (or `embedded=1`, on internal Admin-to-Admin transitions) is just as reliable a signal
  // that this request originated inside Shopify Admin. These are the same three params the
  // SDK itself treats as authoritative for embedded context (see
  // ensureAppIsEmbeddedIfRequired / validateShopAndHostParams in
  // @shopify/shopify-app-react-router). Checking only `shop` here let some embedded,
  // already-authenticated loads fall through to the standalone login form instead of
  // handing off to `/app`, which is the SDK's own — and far more robust — session
  // resolution (it can recover a missing `shop` via the App Bridge bounce page).
  if (
    url.searchParams.get("shop") ||
    url.searchParams.get("host") ||
    url.searchParams.get("embedded") === "1"
  ) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.left}>
          {/* ?v=2 cache-busts this specific path — public/assets/ is served with a
              year-long immutable Cache-Control (correct for content-hashed build output,
              wrong for a static filename whose content can change), so a same-path asset
              swap alone won't reach a browser that already cached the old file. Bump the
              version on any future content change to this file. */}
          <img className={styles.logo} src="/assets/imagyn-app-logo.svg?v=2" alt="Imagyn Reviews" />

          <div className={styles.copy}>
            <h1 className={styles.heading}>Sign in to Imagyn Reviews</h1>
            <p className={styles.description}>
              The premium review platform for Shopify brands who care about trust.
            </p>
          </div>

          {showForm && (
            <div className={styles.loginCard}>
              <Form className={styles.form} method="post" action="/auth/login">
                <label className={styles.label}>
                  <span className={styles.labelText}>Shop domain</span>
                  <input className={styles.input} type="text" name="shop" placeholder="my-shop-domain.myshopify.com" />
                </label>
                <Button type="submit" variant="primary" fullWidth>
                  Log in
                </Button>
              </Form>
            </div>
          )}
        </div>

        <div className={styles.right}>
          <div className={styles.previewFrame}>
            <img
              className={styles.previewImage}
              src="/assets/landing-dashboard-preview.png"
              alt="Imagyn Reviews dashboard showing trust overview, rating distribution and AI-powered insights"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
