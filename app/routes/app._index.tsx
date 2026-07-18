import type { LoaderFunctionArgs } from "react-router";
import { Page, Card, Text } from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { timed } from "../utils/perf.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const loaderStart = performance.now();
  await timed("app._index authenticate.admin", () => authenticate.admin(request));
  console.log(`[perf] app._index loader total: ${(performance.now() - loaderStart).toFixed(1)}ms`);
  return null;
};

export default function Index() {
  return (
    <Page>
      <Card>
        <Text as="h1" variant="headingLg">
          IMAGYN Reviews is working 🎉
        </Text>
      </Card>
    </Page>
  );
}
