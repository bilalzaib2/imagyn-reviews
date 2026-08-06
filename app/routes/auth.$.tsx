
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticateAdminDeduped(request);

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
