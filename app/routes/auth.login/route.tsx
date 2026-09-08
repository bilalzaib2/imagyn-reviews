import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { Button } from "../../components/ui/Button";

import styles from "../_index/styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

// Reachable whenever the shop-domain form on the sign-in page (_index/route.tsx) submits
// with a validation error — same visual language as that page (shares its CSS module)
// instead of the unstyled Polaris web-component defaults this route used to render, so a
// merchant never lands on what reads as a bare developer scaffold mid-sign-in.
export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <div className={styles.page}>
      <div className={styles.hero} style={{ gridTemplateColumns: "minmax(0, 1fr)", justifyItems: "center" }}>
        <div className={styles.left}>
          <img className={styles.logo} src="/assets/imagyn-app-logo.svg?v=2" alt="Imagyn Reviews" />

          <div className={styles.copy}>
            <h1 className={styles.heading}>Sign in to Imagyn Reviews</h1>
            {errors.shop ? <p className={styles.description}>{errors.shop}</p> : null}
          </div>

          <div className={styles.loginCard}>
            <Form className={styles.form} method="post">
              <label className={styles.label}>
                <span className={styles.labelText}>Shop domain</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder="my-shop-domain.myshopify.com"
                  value={shop}
                  onChange={(event) => setShop(event.currentTarget.value)}
                  autoComplete="on"
                />
              </label>
              <Button type="submit" variant="primary" fullWidth>
                Log in
              </Button>
            </Form>
          </div>
        </div>
      </div>
    </div>
  );
}
