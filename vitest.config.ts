import { defineConfig } from "vitest/config";

// Node environment, not jsdom — everything under test here is server-side logic
// (Shopify Admin GraphQL pagination, Prisma upserts), never DOM/React.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
