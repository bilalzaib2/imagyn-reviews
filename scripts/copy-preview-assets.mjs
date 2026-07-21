// Copies the handful of real theme-extension CSS/JS files the Appearance admin page's
// live preview needs into public/appearance-preview/, so app/routes/app.appearance.preview.tsx
// can render the *actual* storefront component CSS (pixel-accurate) instead of a
// hand-rolled mock. extensions/imagyn-review-widgets/assets/ remains the one source of
// truth — this directory is generated, not authored, and is gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const SOURCE_DIR = join(root, "extensions/imagyn-review-widgets/assets");
const TARGET_DIR = join(root, "public/appearance-preview");

const FILES = [
  "imagyn-tokens.css",
  "imagyn-typography.css",
  "imagyn-component-badge.css",
  "imagyn-component-summary.css",
  "imagyn-component-review-card.css",
  "imagyn-component-button.css",
  "imagyn-appearance.js",
];

mkdirSync(TARGET_DIR, { recursive: true });

for (const file of FILES) {
  copyFileSync(join(SOURCE_DIR, file), join(TARGET_DIR, file));
}

console.log(`Copied ${FILES.length} appearance preview assets to public/appearance-preview/`);
