import { flatRoutes } from "@react-router/fs-routes";

// ignoredRouteFiles: without this, @react-router/fs-routes treats EVERY .ts/.tsx file under
// app/routes/ as a routable module — including a *.test.ts file sitting next to the route it
// tests, which broke the production build (esbuild tried to bundle the test file as a route
// chunk). This is also the reason this codebase's existing tests all live under app/services/
// or app/components/ rather than beside the route they cover — this ignore pattern removes
// that constraint going forward for genuine route-level tests (see app.requests.test.ts).
export default flatRoutes({ ignoredRouteFiles: ["**/*.test.{ts,tsx}"] });
