import { Form, useLoaderData, useNavigation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  getShopifyProducts,
  syncProducts,
} from "../services/product.server";

import styles from "../styles/app.products.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const products = await getShopifyProducts(admin);

  return { products };
};

export const action = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  await syncProducts(admin, session.shop);

  return {
    success: true,
  };
};

export default function ProductsPage() {
  const { products } = useLoaderData<typeof loader>();

  const navigation = useNavigation();

  const syncing = navigation.state === "submitting";

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Products</h1>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Form method="post">
            <button
              type="submit"
              disabled={syncing}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background: "#111",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {syncing ? "Syncing..." : "Sync Products"}
            </button>
          </Form>

          <input
            className={styles.search}
            placeholder="Search products..."
          />
        </div>
      </div>

      <div className={styles.table}>
        <div className={`${styles.row} ${styles.headerRow}`}>
          <div>Image</div>
          <div>Product</div>
          <div>Reviews</div>
          <div>Rating</div>
          <div>Status</div>
        </div>

        {products.map((product: any) => (
          <div className={styles.row} key={product.id}>
            <div>
              <img
                className={styles.image}
                src={product.featuredImage?.url ?? ""}
                alt={product.title}
              />
            </div>

            <div>
              <div className={styles.name}>{product.title}</div>
              <div className={styles.vendor}>{product.vendor}</div>
            </div>

            <div>0</div>

            <div>—</div>

            <div className={styles.status}>{product.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}