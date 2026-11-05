// Copies the Geist Sans variable font files out of the `geist` npm package and into
// public/fonts/, where design-system.css's @font-face rules expect them.
//
// Same arrangement as copy-preview-assets.mjs: public/fonts/ is GENERATED, not authored, and
// is gitignored — node_modules/geist stays the one source of truth, and the repository does
// not carry 140KB of binary font data that npm already resolves for us.
//
// Self-hosting rather than a CDN link is deliberate: this is an embedded Shopify admin app,
// so every additional connection is felt on a page a merchant opens dozens of times a day,
// and a third-party font request would leak every one of those page views to that CDN.
//
// Runs on both `prebuild` and `predev`, because a font missing in development is a font
// nobody notices is missing until a merchant sees it. The @font-face rules use
// `font-display: swap` with Helvetica next in the stack, so even a failed copy degrades to
// the documented fallback rather than to invisible text.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const SOURCE_DIR = join(root, "node_modules/geist/dist/fonts/geist-sans");
const TARGET_DIR = join(root, "public/fonts");

// One variable file per style covers the full 100–900 weight axis in a single request, which
// is the whole reason to prefer the variable cut over five static weights.
const FILES = [
  { from: "Geist-Variable.woff2", to: "Geist-Variable.woff2" },
  // Renamed on the way over: the published filename contains square brackets, which are legal
  // in a URL path but have to be percent-encoded there, and a bracketed filename inside a CSS
  // url() is a reliable source of confusion for no benefit.
  { from: "Geist-Italic[wght].woff2", to: "Geist-Italic.woff2" },
];

if (!existsSync(SOURCE_DIR)) {
  // Not fatal. A build must not fail because an optional typographic asset is absent — the
  // font stack falls back to Helvetica, which is the documented second choice.
  console.warn(`Skipped font copy: ${SOURCE_DIR} not found. Run "npm install" to restore it.`);
  process.exit(0);
}

mkdirSync(TARGET_DIR, { recursive: true });

for (const file of FILES) {
  copyFileSync(join(SOURCE_DIR, file.from), join(TARGET_DIR, file.to));
}

console.log(`Copied ${FILES.length} Geist Sans font files to public/fonts/`);
