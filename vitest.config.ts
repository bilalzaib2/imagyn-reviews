import { defineConfig } from "vitest/config";

// Node environment, not jsdom — almost everything under test here is server-side logic
// (Shopify Admin GraphQL pagination, Prisma upserts), and the few component tests that exist
// render to static markup with react-dom/server, which needs no DOM.
//
// .tsx is included so a shared UI primitive can be tested at all: components/ui/Table.tsx is
// used by several merchant screens, and the guarantees worth pinning (an empty-state slot
// instead of an empty table, a complete column-width plan, a real aria-label) are only
// observable in rendered markup. A test that needs real browser behaviour — focus, layout,
// pointer events — does not belong here and would need its own jsdom project.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
  },
});
