import type { LoaderFunctionArgs } from "react-router";
import { listPublicStores } from "../services/publicDiscovery.server";
import { assertGet, publicJson, readInt } from "./api.public.v1";

// GET /api/public/v1/stores — stores with real approved review activity, busiest first.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const guard = assertGet(request);
  if (guard) return guard;

  const url = new URL(request.url);
  const stores = await listPublicStores(readInt(url, "limit") ?? 24);

  return publicJson({ ok: true, stores, total: stores.length });
};
