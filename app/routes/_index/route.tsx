import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { Button } from "../../components/ui/Button";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
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
      <div className={styles.grid}>
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
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label}>
                <span className={styles.labelText}>Shop domain</span>
                <input className={styles.input} type="text" name="shop" placeholder="my-shop-domain.myshopify.com" />
              </label>
              <Button type="submit" variant="primary" fullWidth>
                Log in
              </Button>
            </Form>
          )}

          <ul className={styles.list}>
            {FEATURES.map((feature) => (
              <li key={feature.title} className={styles.listItem}>
                <strong className={styles.listItemTitle}>{feature.title}</strong>
                <span className={styles.listItemText}>{feature.description}</span>
              </li>
            ))}
          </ul>

          <p className={styles.footer}>Built for modern Shopify brands.</p>
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
      </div>
    </div>
  );
}
