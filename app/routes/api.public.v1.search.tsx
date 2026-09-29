import type { LoaderFunctionArgs } from "react-router";
import { searchPublic } from "../services/publicDiscovery.server";
import { assertGet, publicJson, readInt, readString } from "./api.public.v1";

// GET /api/public/v1/search?q= — one query across products, stores and review text.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const guard = assertGet(request);
  if (guard) return guard;

  const url = new URL(request.url);
  const q = readString(url, "q") ?? "";
  const results = await searchPublic(q, readInt(url, "limit") ?? 8);

  return publicJson({ ok: true, query: q, ...results });
};
