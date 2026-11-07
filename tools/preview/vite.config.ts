import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Design-review harness.
//
// The embedded app cannot be opened locally: every route calls authenticate.admin(), and the
// only deployed build is production, which must not be redeployed to look at a layout. So this
// mounts the REAL route components, with the REAL stylesheets and design tokens, against
// fixture data — which is enough to inspect layout, typography, density, responsive behaviour
// and empty/loading states in a browser.
//
// What it does NOT prove: anything touching a loader, an action, App Bridge or Shopify. Those
// stay verified by tests and by the real admin.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // No @vitejs/plugin-react: Vite compiles TSX with esbuild already, and the plugin only
  // adds Fast Refresh. Not worth a new dependency for a review harness.
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      // Route modules import *.server files at top level for their loaders. The component
      // never calls them, so each resolves to a stub here rather than dragging Prisma into a
      // browser bundle.
      //
      // The stub has to export the SAME NAMES as the real module: a bundler resolves named
      // imports statically, so `export default` alone fails the build with "is not exported
      // by". So the real file is read and its export names are mirrored as no-ops.
      name: "stub-server-modules",
      enforce: "pre",
      async resolveId(source, importer) {
        if (!/\.server$/.test(source) && !/\.server\.tsx?$/.test(source)) return null;
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        if (!resolved) return null;
        return "\0stub:" + resolved.id;
      },
      load(id) {
        if (!id.startsWith("\0stub:")) return null;

        const real = id.slice("\0stub:".length);
        let source = "";
        try {
          source = readFileSync(real, "utf8");
        } catch {
          // Nothing to mirror; a bare default still covers default-only importers.
        }

        const names = new Set<string>();
        for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g)) {
          names.add(match[1]);
        }
        // `export { a, b as c }` — the exported (right-hand) name is what importers use.
        for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
          for (const part of match[1].split(",")) {
            const name = part.trim().split(/\s+as\s+/).pop()?.trim();
            if (name && /^\w+$/.test(name) && name !== "default") names.add(name);
          }
        }

        const body = [...names].map((name) => `export const ${name} = noop;`).join("\n");
        return `const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
export default noop;
${body}`;
      },
    },
  ],
  server: { port: 5199, strictPort: true },
});
