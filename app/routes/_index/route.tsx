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

const FEATURES = [
  {
    title: "Collect Authentic Reviews",
    description: "Automatically request reviews from verified customers.",
  },
  {
    title: "Moderate with Confidence",
    description: "Review, approve and respond from one clean dashboard.",
  },
  {
    title: "Beautiful Widgets",
    description: "Match every pixel of your storefront with customizable widgets.",
  },
];

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.left}>
          <img className={styles.logo} src="/assets/imagyn-app-logo.svg" alt="Imagyn Reviews" />

          <div className={styles.copy}>
            <h1 className={styles.heading}>Welcome to Imagyn Reviews</h1>
            <p className={styles.subheading}>Build trust with every customer review.</p>
            <p className={styles.description}>
              Collect, manage and showcase authentic customer reviews with beautifully crafted
              widgets, AI-powered insights and a premium moderation experience.
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

      <section className={styles.features}>
        <div className={styles.featureGrid}>
          {FEATURES.map((feature) => (
            <div key={feature.title} className={styles.featureCard}>
              <h3 className={styles.featureTitle}>{feature.title}</h3>
              <p className={styles.featureText}>{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>Built for modern Shopify brands.</footer>
    </div>
  );
}
