import type { LoaderFunctionArgs } from "react-router";
import { listReviewedProducts } from "../services/publicDiscovery.server";
import { assertGet, publicJson, readInt, readString } from "./api.public.v1";

// GET /api/public/v1/products — products that genuinely carry approved reviews, ranked by
// review depth. Products with no approved reviews are never listed here; they still exist in
// the merchant's catalogue, they just aren't presented to shoppers as reviewed.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const guard = assertGet(request);
  if (guard) return guard;

  const url = new URL(request.url);
  const products = await listReviewedProducts({
    limit: readInt(url, "limit"),
    category: readString(url, "category"),
    store: readString(url, "store"),
  });

  return publicJson({ ok: true, products, total: products.length });
};
