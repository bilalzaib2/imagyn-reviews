import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Frame, Select, TextField, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Section } from "../components/ui/Section";
import { EmptyState } from "../components/ui/EmptyState";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import {
  createProductGroup,
  deleteProductGroup,
  listProductGroups,
  listUngroupedProducts,
  renameProductGroup,
  setProductGroup,
  type ProductGroupRecord,
  type UngroupedProduct,
} from "../services/productGroup.server";
import styles from "../styles/app.management.module.css";

// Settings > Products > Product Groups. Real feature, not a stub: grouping products (typically
// the same item set up as several separate Shopify products, one per color/size) makes reviews
// left on any one of them show together on every product page in the group — see
// productGroup.server.ts's getGroupedProductIds and api.reviews.tsx's own use of it. Grouping
// is always a merchant's explicit choice; nothing here is inferred from Shopify data.
type LoaderData = {
  groups: ProductGroupRecord[];
  ungroupedProducts: UngroupedProduct[];
};

type ActionData = {
  ok: boolean;
  error?: string;
  message?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const [groups, ungroupedProducts] = await Promise.all([
    listProductGroups(store.id),
    listUngroupedProducts(store.id),
  ]);

  return { groups, ungroupedProducts };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "create") {
      const name = String(formData.get("name") || "").trim();
      if (!name) {
        return { ok: false, error: "Give this group a name." };
      }
      await createProductGroup(store.id, name);
      return { ok: true, message: `Group "${name}" created.` };
    }

    if (intent === "rename") {
      const groupId = String(formData.get("groupId") || "");
      const name = String(formData.get("name") || "").trim();
      await renameProductGroup(store.id, groupId, name);
      return { ok: true, message: "Group renamed." };
    }

    if (intent === "delete") {
      const groupId = String(formData.get("groupId") || "");
      await deleteProductGroup(store.id, groupId);
      return { ok: true, message: "Group deleted. Its products are no longer grouped, but were not otherwise changed." };
    }

    if (intent === "addProduct") {
      const groupId = String(formData.get("groupId") || "");
      const productId = String(formData.get("productId") || "");
      if (!productId) {
        return { ok: false, error: "Choose a product to add." };
      }
      await setProductGroup(store.id, productId, groupId);
      return { ok: true, message: "Product added to group." };
    }

    if (intent === "removeProduct") {
      const productId = String(formData.get("productId") || "");
      await setProductGroup(store.id, productId, null);
      return { ok: true, message: "Product removed from group." };
    }

    return { ok: false, error: "Unsupported action." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to complete that action." };
  }
};

function AddProductForm({ groupId, ungroupedProducts, isBusy }: { groupId: string; ungroupedProducts: UngroupedProduct[]; isBusy: boolean }) {
  const fetcher = useFetcher();
  const [productId, setProductId] = useState("");

  if (ungroupedProducts.length === 0) {
    return null;
  }

  return (
    <fetcher.Form method="post" className={styles.inlineActions}>
      <input type="hidden" name="intent" value="addProduct" />
      <input type="hidden" name="groupId" value={groupId} />
      <Select
        label="Add product"
        labelHidden
        options={[{ label: "Choose a product…", value: "" }, ...ungroupedProducts.map((p) => ({ label: p.name, value: p.id }))]}
        value={productId}
        onChange={setProductId}
        name="productId"
        disabled={isBusy}
      />
      <Button type="submit" variant="secondary" disabled={isBusy || !productId}>
        Add
      </Button>
    </fetcher.Form>
  );
}

function GroupCard({ group, ungroupedProducts, isBusy }: { group: ProductGroupRecord; ungroupedProducts: UngroupedProduct[]; isBusy: boolean }) {
  const renameFetcher = useFetcher();
  const removeFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const [name, setName] = useState(group.name);
  const [isEditingName, setIsEditingName] = useState(false);

  return (
    <div className={`${styles.card}${group.products.length > 0 ? ` ${styles.cardAccent}` : ""}`}>
      <div className={styles.cardHeader}>
        {isEditingName ? (
          <renameFetcher.Form
            method="post"
            className={styles.inlineActions}
            onSubmit={() => setIsEditingName(false)}
          >
            <input type="hidden" name="intent" value="rename" />
            <input type="hidden" name="groupId" value={group.id} />
            <TextField label="Group name" labelHidden value={name} onChange={setName} name="name" autoComplete="off" />
            <Button type="submit" variant="secondary" disabled={isBusy || !name.trim()}>
              Save
            </Button>
          </renameFetcher.Form>
        ) : (
          <>
            <span className={styles.settingsGroupLabel}>{group.name}</span>
            <div className={styles.inlineActions}>
              <Button type="button" variant="ghost" onClick={() => setIsEditingName(true)} disabled={isBusy}>
                Rename
              </Button>
              <deleteFetcher.Form method="post">
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="groupId" value={group.id} />
                <Button type="submit" variant="ghost" disabled={isBusy}>
                  Delete group
                </Button>
              </deleteFetcher.Form>
            </div>
          </>
        )}
      </div>

      {group.products.length === 0 ? (
        <p className={styles.mutedText}>No products in this group yet.</p>
      ) : (
        <ul className={styles.memberList}>
          {group.products.map((product) => (
            <li key={product.id} className={styles.memberRow}>
              <span>{product.name}</span>
              <removeFetcher.Form method="post">
                <input type="hidden" name="intent" value="removeProduct" />
                <input type="hidden" name="productId" value={product.id} />
                <Button type="submit" variant="ghost" disabled={isBusy}>
                  Remove
                </Button>
              </removeFetcher.Form>
            </li>
          ))}
        </ul>
      )}

      <AddProductForm groupId={group.id} ungroupedProducts={ungroupedProducts} isBusy={isBusy} />
    </div>
  );
}

export default function ProductGroupsPage() {
  const { groups, ungroupedProducts } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<ActionData>();
  const [groupName, setGroupName] = useState("");
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!createFetcher.data) return;
    setToast({ content: createFetcher.data.message || createFetcher.data.error || "Done.", error: !createFetcher.data.ok });
    if (createFetcher.data.ok) {
      setGroupName("");
    }
  }, [createFetcher.data]);

  const isBusy = createFetcher.state !== "idle";

  return (
    <>
      <Section
        title="Product Groups"
        description="Group products that are really the same item — separate color or size variants set up as separate Shopify products, for example — so a review left on one shows on all of them."
      >
        <createFetcher.Form method="post" className={styles.inlineActions}>
          <input type="hidden" name="intent" value="create" />
          <TextField label="New group name" labelHidden placeholder="e.g. Classic Tee" value={groupName} onChange={setGroupName} name="name" autoComplete="off" />
          <Button type="submit" variant="primary" disabled={isBusy || !groupName.trim()}>
            Create group
          </Button>
        </createFetcher.Form>
      </Section>

      <Section title="Your groups" description={`${groups.length} group${groups.length === 1 ? "" : "s"}.`}>
        {groups.length === 0 ? (
          <EmptyState
            title="No product groups yet"
            description="Create a group above, then add the products that should share reviews."
          />
        ) : (
          <div className={styles.cardList}>
            {groups.map((group) => (
              <GroupCard key={group.id} group={group} ungroupedProducts={ungroupedProducts} isBusy={isBusy} />
            ))}
          </div>
        )}
      </Section>

      <div className={styles.toastFrame}>
        <Frame>{toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}</Frame>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
