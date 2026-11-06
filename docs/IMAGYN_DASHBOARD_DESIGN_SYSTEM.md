# Imagyn Reviews — merchant dashboard design system

**Status:** in force for all new work. Partially adopted across existing screens — §8 records
exactly where, honestly, without rounding up.

**Scope:** the embedded Shopify admin app (`/app/*`). The storefront widgets have their own
separate system (`docs/STOREFRONT_DESIGN_SYSTEM.md`, `extensions/imagyn-review-widgets/`) and
nothing here applies to them. The two are deliberately not shared: a merchant's own brand
colours drive the storefront, and Imagyn's drive the admin.

**Source of truth:** `app/styles/design-system.css`. Every token below is defined there. This
document explains the reasoning; that file is what the browser reads. If they disagree, the
stylesheet is right and this document is stale.

---

## 1. The direction, in one paragraph

Premium, minimal, typography-first. A white and off-white foundation, charcoal type, and one
restrained green used for genuine emphasis. Space does the work that borders and colour do in
a generic SaaS dashboard. The references are Linear, Stripe and Apple for restraint, and
Judge.me for workflow density — a merchant moderating 200 reviews needs a tool, not a
showcase.

### What this explicitly is not

These are the failure modes to design against, not vague preferences:

- **No generic AI-dashboard cards.** A card is a container for genuinely grouped content, not
  the default wrapper for every paragraph.
- **No gradients** except where one is doing real work (a product thumbnail placeholder).
- **No oversized empty hero sections.** Vertical space above the fold belongs to the
  merchant's data.
- **Not everything a floating card.** Nested panels with a few pixels between two borders is
  the most common symptom.
- **No overcrowding.** Density where data lives (tables), air everywhere else.
- **No placeholder controls.** A toggle that cannot affect anything is worse than a missing
  one. Email Studio's star-rating line field is hidden entirely on the reward template for
  exactly this reason — that template never renders a star row.
- **No invented numbers.** No trend arrows, no period-over-period percentages, no
  "+12% this week". The services behind these screens compute no historical snapshots, so any
  comparison shown would be fabricated. `<Metric>` has no trend slot, deliberately.

---

## 2. Colour

### 2.1 Neutrals — one family, not independent greys

| Token | Value | Use |
|---|---|---|
| `--color-surface` | `#ffffff` | Cards and primary surfaces |
| `--color-background` | `#f6f6f8` | The page everything sits on |
| `--color-surface-muted` | `#f1f1f4` | Hover fills, inset panels, quiet chips |
| `--color-surface-strong` | `#e6e6ea` | Pressed and selected fills, disabled chrome |
| `--color-border` | `#e5e5e9` | Hairline dividers |
| `--color-border-strong` | `#cecdd4` | Real borders, hover borders |
| `--color-text-muted` | `#6a6a73` | Secondary text |
| `--color-text` | `#18181b` | Primary text |

Every value carries a barely-there cool cast (hue 240, under 4% saturation) rather than being
mathematically pure grey. Dead-neutral greys read flat and clinical on a screen; a trace of
blue is what makes a greyscale interface feel calm. It is far below the point anyone would
call it blue.

Deliberately not pure `#000` on pure `#fff`. Charcoal on off-white is the whole difference
between premium and harsh, and contrast is still comfortably past WCAG AA: charcoal on white
measures **17.7:1**. `--color-text-muted` is `#6a6a73` rather than a step lighter specifically
because at `#6e6e77` it measured 4.48:1 on the muted surface — marginally under AA, and that
is exactly the combination used for help text inside an inset panel.

### 2.2 The brand green

Replaced the previous chartreuse family (`#97a819` / `#6f7a13` / `#eafbb2`) on 2026-11-06.
That palette read as highlighter-yellow rather than as a brand.

| Token | Value | Job | Contrast |
|---|---|---|---|
| `--color-brand` | `#5c9754` | **Fills and non-text marks only** | 3.49:1 on white |
| `--color-brand-strong` | `#3d6b36` | **Text and icons** | 6.26:1 on white, 5.79:1 on the page, 6.1:1 on the 16% tint |
| `--color-brand-soft` | `#e8f1e6` | Pale tint as a filled background, with `--color-text` on top | — |
| `--color-brand-border` | `#c3dcbd` | A hairline on a brand-tinted surface | — |

**These are not interchangeable.** `--color-brand` clears WCAG AA's 3:1 bar for UI components
and graphical objects but **not** the 4.5:1 bar for body text. Never set it as a text colour;
that is what `--color-brand-strong` is for.

`--color-highlight`, `--color-highlight-strong` and `--color-highlight-soft` remain as aliases
resolving to the same three values, because 19 existing declarations across seven route
stylesheets reference them — which is how the brand swap reached every one of those surfaces
without editing them. **New code uses the `--color-brand*` names.**

### 2.3 The primary button is charcoal, not green

`--color-accent` is `#18181b` — the same ink as body text. Black is Imagyn's one strong,
confident brand colour; the green is an accent for emphasis, never the default action colour.
A dashboard where every primary button is brand-coloured has no way left to mark the one
thing that actually matters on a screen.

### 2.4 Functional colours carry meaning

| Token | Value | Reserved for |
|---|---|---|
| `--color-success` | `#1f7a45` | A real positive state |
| `--color-warning` | `#b06a06` | Something needing attention |
| `--color-danger` | `#c23b2b` | Destructive or failed |
| `--color-info` | `#3a5bc7` | Integration and connection states |
| `--color-ai` | `#7a5cc4` | AI-generated content, distinct from `--color-info` |

These are the only hues in the admin besides the brand green, which is precisely what makes
them read as signal against an otherwise greyscale interface. **Colour never carries meaning
alone** — the label and the number say what is true, and the tint reinforces it, so every
state still reads correctly in greyscale and to a colourblind merchant.

---

## 3. Typography

### 3.1 The faces

```
--font-sans:    "Geist Sans", Helvetica, Arial, sans-serif
--font-display: "Geist Sans", Helvetica, Arial, sans-serif
--font-mono:    "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace
```

Geist Sans is **self-hosted**, not CDN-loaded. `scripts/copy-fonts.mjs` copies two variable
`woff2` files out of the `geist` npm package into `public/fonts/` on both `prebuild` and
`predev`; that directory is generated and gitignored, the same arrangement
`public/appearance-preview/` already uses. Self-hosting rather than Google Fonts for three
reasons: this is an embedded admin app where every extra connection is felt, a third-party
font request leaks every merchant page view to that CDN, and a font that cannot fail to load
is one less thing between a merchant and their reviews.

`root.tsx` **preloads** `Geist-Variable.woff2` with `crossOrigin="anonymous"` (required even
same-origin — fonts are always fetched in CORS mode, and without it the preload is discarded
and the file fetched twice). `font-display: swap` means Helvetica renders immediately and is
replaced when Geist arrives, so a missing font file costs polish and never a blank page.

Helvetica is the deliberate fallback rather than `system-ui`: it is metrically close enough
that the swap does not visibly reflow, and it is present on every machine a merchant will
open this app on.

Email templates are the one exception and keep plain Helvetica/Georgia stacks — email clients
do not reliably load webfonts, so offering Geist there would silently fall back anyway. See
`ReviewRequestEmail.tsx`'s `FONT_STACKS`.

### 3.1a Why one typeface and not a display pairing (decided 2026-11-06)

Five candidates were considered: **Montserrat, Geist Sans, Inter, Manrope, Helvetica Neue.**
The decision is **Geist Sans alone, with a stronger weight and size hierarchy** — not a
display face layered over a text face.

| Candidate | Verdict |
|---|---|
| **Montserrat** | A geometric *display* face from urban signage. Genuinely handsome at 40px. Wrong as a body face for this product: its wide letterforms eat horizontal space in exactly the dense tables that dominate these screens, and its geometric `a`/`g`/`o` lose differentiation at the 13–14px a table cell runs at. |
| **Inter** | Purpose-built for UI, excellent at small sizes — and the default SaaS typeface. Shopify's own Polaris already uses it, so adopting it is the one choice guaranteed to give Imagyn no typographic identity at all: the app would read as untouched Shopify Admin. |
| **Geist Sans** | A neo-grotesque designed for interfaces. Taller x-height and tighter apertures than Helvetica, real tabular figures, a variable weight axis to 900. Distinctive without being decorative. Already installed and self-hosted. |
| **Manrope** | Characterful and pleasant at display sizes, weaker than Geist or Inter in the 12–14px band that most of this interface lives in. |
| **Helvetica Neue** | Not reliably present on Windows (Arial substitutes), no variable axis, no tabular figures by default. Fine as a *fallback*, which is exactly what it is. |

**Why no second face.** Three reasons, in order of weight:

1. **The references do not use one.** Linear and Stripe — both named in the brief — each run a
   single face and get their editorial quality from confident weight and size contrast, not
   from a display/text pairing.
2. **Geist already goes to 900.** "Bold, clean, editorial headings" is available from the
   variable axis that is already loading. A second webfont buys nothing the first one cannot
   do, and costs another file, another swap window inside the iframe, and a second preload.
3. **Mixing genres reads as accidental.** A geometric display face over a neo-grotesque text
   face is a real pairing, but a hard one; done without a type designer's eye it looks like
   two fonts that failed to load consistently rather than a deliberate pairing.

What changed instead: the page title went from 600 to **700** at **-0.035em**, and section
headings are a real 18px/600 heading rather than metadata. That is where the "confident"
quality was missing — not in the choice of face.

**If you want Montserrat anyway**, the defensible version is display-only: Montserrat for
`.title` and the hero metric number, Geist everywhere else, both self-hosted. That is one
token change (`--font-display`) plus a second `@font-face` and a second preload — it is
deliberately *possible*, since `--font-display` already exists as a separate token from
`--font-sans` and nothing reads one where it means the other.

### 3.1b The uppercase pass (2026-11-06)

This codebase had grown **49** `text-transform: uppercase` rules. Most were the same pattern:
12px, `letter-spacing: 0.1–0.16em`, muted grey — a tiny uppercase label above a card or beside
a value. Repeated at that density it stops being emphasis and becomes noise, and it is
actively hard to read.

**20 selectors were retypeset** to real, readable labels across 18 stylesheets:

- **Section labels** (`settingsGroupLabel`, `groupLabel`, `sidebarGroupLabel`,
  `inspectorGroupLabel`, `aiSummaryGroupLabel`, `modalSectionLabel`, `introEyebrow`) →
  14px / 600 / normal tracking / **full-strength ink**. These are headings now.
- **Field and meta labels** (`detailLabel`, `detailMetaLabel`, `detailEyebrow`, `statLabel`,
  `fieldLabel`, `filterLabel`, `previewLabel`, `aiSummaryLabel`, `aiSummaryPreviewLabel`,
  `attentionLabel`, `proEyebrow`, `eyebrow`, `trialNote`) → 14px / 500 / normal tracking /
  muted. Still secondary, now legible.

**Uppercase is kept in exactly two places,** because in both it has a clear purpose:

1. **Badges and tags** — `statusBadge`, `autoApprovedBadge`, `lockedTag`, `currentTag`,
   `installBadge` and the rest. One or two words, in a pill, where caps aid scanning.
2. **Table column headers** — `.table thead th` and the three local table variants.
   Conventional, compact, and they label a column rather than introduce a section.

### 3.1c Where green is allowed

The brief asks for intelligent green, not green everywhere. The rule in force:

- **One gradient, in one place.** `Metric`'s `hero` variant — the two numbers that define a
  store's reputation on the Dashboard. 5% → 1.5% of `--color-brand` over white on a 165° axis,
  so the tint gathers where the number sits and clears by the label. Charcoal on its darkest
  point still measures 16.9:1. It reads as emphasis *because* nothing else competes; a
  gradient on every card is wallpaper.
- **A tone always wins over it.** A hero tile in a genuine `attention` or `danger` state drops
  the gradient entirely — a fact must never be overpainted by a brand treatment.
- **Active navigation.** The `WorkspaceTabs` active underline is a 2px `--color-brand` rule.
  A rule, not a label, so the fills-only contrast value is the correct one there.
- **Selected and earned states** — the brand-soft tint behind a `Current` tag, a `brand` badge
  for a Featured review, the selected-row rail in a table.
- **Nowhere else.** Not on primary buttons (those are charcoal, §2.3), not as a default card
  treatment, not behind section headings.

### 3.2 The ladder

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12px | Meta, table column headers, badge labels |
| `--text-sm` | 14px | Secondary text, help text, table cells |
| `--text-base` | 16px | Body copy |
| `--text-lg` | 18px | Section titles |
| `--text-xl` | 20px | Card titles |
| `--text-2xl` | 24px | Page titles on a dense screen |
| `--text-3xl` | 32px | Page titles |
| `--text-4xl` | 40px | One headline number on a screen. Never prose. |

Every step is used and nothing between them is. A page that seems to need a size not on this
list almost always needs a different **weight** or **colour** instead.

### 3.3 Weight, tracking, leading

Four weights only: `--weight-regular` 400, `--weight-medium` 500, `--weight-semibold` 600,
`--weight-bold` 700. Geist ships a variable axis, so these are exact rather than synthesised.
500 exists because a 14px table header at 600 shouts, and 400-vs-500 is the whole difference
between a row of data and a row of headings.

Tracking is applied **by size, never by taste**: `--tracking-tight` (-0.02em) and
`--tracking-tighter` (-0.03em) for large type, `--tracking-caps` (0.06em) for all-caps
eyebrows and column headers. Large type at default tracking looks loose; small type at
negative tracking looks cramped.

Leading: `--leading-tight` 1.2, `--leading-snug` 1.35, `--leading-normal` 1.5,
`--leading-relaxed` 1.65.

---

## 4. Space, shape and motion

Spacing is a 4px scale, `--space-1` (4px) through `--space-16` (64px). Radius is
`--radius-sm` 8px, `--radius-md` 12px, `--radius-lg` 16px, `--radius-xl` 20px,
`--radius-full`. Cards use `--radius-lg`; controls use `--radius-md`.

Three shadow depths (`--shadow-sm/md/lg`), all tinted with the charcoal ink so a card's shadow
belongs to the same greyscale family as its border instead of casting a warm halo.

**One motion timing for everything:** `--transition-base: 150ms ease-out`. A single value is
what makes every button, row and card feel like one product. Every transition must be wrapped
in a `@media (prefers-reduced-motion: reduce)` opt-out.

**One focus treatment**, defined once in `design-system.css` for every interactive element:
`outline: 2px solid var(--color-accent)` with `2px` offset, on `:focus-visible` only so a
mouse click never shows a ring.

---

## 5. Component inventory

### 5.1 Built and shared — `app/components/ui/`

| Component | What it is |
|---|---|
| `Container` | The page's max-width wrapper (`--container-width` 1120px) |
| `PageHeader` | Eyebrow + title + description + actions. The header eight routes used to repeat verbatim |
| `SettingsBreadcrumb` | Breadcrumb for the six pages reached from the Settings sidebar |
| `Section` | Title + description + actions over content. The standard vertical unit |
| `Card` | A bordered surface. Tones: `default`, `subtle`, `quiet` |
| `Button` / `LinkButton` | Variants `primary` (charcoal), `secondary`, `ghost` |
| `StatusBadge` | Tones `success`, `warning`, `neutral`, `pro` |
| `Banner` | Page-level state messages |
| `EmptyState` | No-data state with an action |
| `ActionCard` | A navigable card on the Settings index |
| `ProgressBar`, `ColorField`, `PillarStatusIcon`, `UpgradePrompt`, `ContextualSaveBar`, `FloatingHelp`, `AppReviewPrompt` | Single-purpose, already shared |
| **`Table`** | **New (2026-11-06).** The house data table — see §5.2 |
| **`Metric` / `MetricRow`** | **New (2026-11-06).** The house stat tile — see §5.3 |
| **`TemplateGallery`** | **New (2026-11-06).** Email Studio's template library, in `app/components/email/` |

### 5.2 `Table`

Extracted **verbatim** from the convention `app.reviews.module.css` and
`app.requests.module.css` already shared — sticky header, 12px uppercase column labels,
hairline rows, calm hover fill, scrollable wrapper. Adopting it is therefore a consolidation,
not a restyle.

```tsx
const columns: TableColumn<Product>[] = [
  { key: "name", header: "Product", width: "38%", render: (p) => <a href={...}>{p.name}</a> },
  { key: "count", header: "Reviews", width: "12%", align: "end", numeric: true, render: (p) => p.count },
];

<Table rows={products} columns={columns} getRowKey={(p) => p.id} ariaLabel="Synced products" />
```

Rules:

- **`ariaLabel` is required.** An unlabelled data table is a wall of cells to a screen reader.
- **Declare a width for every column or none.** The layout is `table-layout: fixed`, which is
  only worth having with a complete plan. Fixed rather than min-width-plus-scroll because the
  alternative loses the right-hand columns off-screen as soon as a page puts the table beside
  a detail panel — which is the layout Reviews and Requests both use.
- **Numeric columns set `numeric` and `align: "end"`**, which gives them tabular figures so
  digits line up down the column.
- **Do not nest it in a `Card`.** It provides its own bordered surface; nesting draws two
  borders a few pixels apart with the card's padding between them.
- It deliberately has **no sorting, selection, pagination or row expansion**. Each exists on
  exactly one screen today, against that screen's own URL state. Pagination in particular
  belongs to the route, which owns the cursor.

### 5.3 `Metric` / `MetricRow`

Extracted from `app._index.module.css`'s `.kpiCard`/`.kpiHero` pair — the most considered of
the four stat-tile implementations that had grown in four stylesheets. Values unchanged, so a
screen adopting it looks identical to the dashboard it came from.

```tsx
<Metric size="hero" value="4.8" sub={<StarRating value={4.8} size={16} />} label="Average rating" />
<MetricRow>
  <Metric tone={verifiedTone} value="82%" label="Verified share" />
  <Metric value={12} label="Auto-published today" />
</MetricRow>
```

Rules:

- **`tone` is a fact, not a decoration.** Set it only from a real threshold a merchant could
  apply themselves. There is no `primary` or `brand` tone — a tile is never tinted to draw the
  eye.
- **`size="hero"` is for the one or two headline figures on a screen.** A screen where every
  tile is a hero has no hero.
- **`sub` is one line of real context** ("12 published"), never a fabricated trend.
- Tone tints the surface and recolours the value. Never a coloured border rail.

### 5.4 Not built, and why

- **Modal / Popover / ActionList** — used on exactly one screen (`app.reviews`), via Polaris.
  Extracting a house version today would be an abstraction over one caller.
- **FilterBar** — only `app.reviews` has filters, and they are bound to that screen's search
  params.
- **Tabs** — several screens have a tab-like control, but they are genuinely different things:
  a template switcher that navigates, a settings workspace sidebar, a preview mode toggle. One
  component over all three would be a wrapper with three mutually exclusive modes.

The rule: **extract on the second caller, not the first.** `Table` and `Metric` were extracted
because they had three and four independent implementations respectively.

---

## 6. Navigation

Primary navigation is Shopify Admin's own sidebar, via App Bridge's `NavMenu` in
`app/routes/app.tsx`. It is deliberately **four items** — Dashboard, Reviews, Analytics,
Settings — the day-to-day merchant workflows only. Products, Requests, Email Studio, Widgets,
Brand Studio, Medals and Billing are all real and unchanged at their existing URLs, reached
from the Settings workspace's own secondary navigation (`app.settings.tsx`) or, for Requests,
a tab on the Reviews page.

That is a product decision, not an oversight. Seven more permanent sidebar entries would make
the four that matter harder to find.

**Navigation in an embedded app must be a real `<a href>`.** App Bridge owns navigation: it
intercepts the native click and dispatches `shopify:navigate`, which `AppProvider` turns into
the actual `navigate()` call. A react-router `<Link>` `preventDefault`s that click and runs its
own transition, which in this context **never updates the URL at all**. `app.tsx`'s
`handleNavClick` is the one sanctioned exception — it handles the Admin sidebar's own anchors
and still falls through to native behaviour for modified clicks.

---

## 7. Patterns

**Page skeleton.** `Container` → `shellStyles.page` → `PageHeader` or `SettingsBreadcrumb` →
`Section`s. Nothing between the header and the first section.

**Loading.** Skeletons shaped like the content they replace, inside a `Card`. Never a spinner
for a page load. `app.tsx` renders a thin top progress bar during navigation.

**Empty vs error.** They are different and must not share a component. An empty state is a
normal outcome with an action that fixes it; an error state says what failed and offers a
retry. `app.tsx`'s `ErrorBoundary` renders an honest fallback — no fake data, no hidden
failure.

**Tables beside a detail panel.** `table-layout: fixed`, `density="compact"`, selected row
marked with an inset 3px rail in `--color-brand` on the leading cell. This is the single
sanctioned exception to "no coloured rails": exactly one row can be selected at a time, and
marking it is a genuine momentary state rather than a default treatment.

**Plan gating.** A Pro-only feature is shown, labelled, and explains what upgrading unlocks —
never hidden. Where the capability is partial, the UI says precisely which half is gated:
Email Studio's reminder templates read *"Editable now · Sending needs Pro"*, because editing
is free on every plan and only the automatic 3-day/7-day sweep is paid. Entitlement is read
from `app/services/permissions.ts` as booleans, never by comparing plan names.

---

## 8. Adoption status — the honest version

Audited 2026-11-06 across all 31 `/app/*` routes.

**Fully on the house system (no Polaris UI):** `app._index`, `app.analytics`,
`app.appearance`, `app.billing`, `app.medals`, `app.requests`, `app.widgets`,
`app.settings._index`, and all eight `app.settings.*` leaves.

**House system plus Polaris toast infrastructure only** (`Frame` + `Toast`, which has no house
equivalent and needs none): `app.products`, `app.email-studio` (also `Select`).

**Still substantially Polaris-rendered — the remaining migration:**

| Route | Polaris components | Note |
|---|---|---|
| `app.products_.$id` | `Card`, `BlockStack`, `Text`, `Badge` | Internally consistent today. Converting only its `Badge` would make the page half-and-half, so it is left whole for a single focused pass. |
| `app.reviews` | `Modal`, `Popover`, `ActionList`, `TextField`, `Banner` | The interaction primitives §5.4 explains are not worth extracting yet. Its `Banner` and `TextField` are the genuinely replaceable parts. |

**Two badge languages still exist.** `StatusBadge` on house pages, Polaris `Badge` on
`app.products_.$id` and inside `components/reviews/ReviewStatusBadge.tsx`. The split is by
page rather than within a page, so no single screen looks inconsistent today — but it is a
real inconsistency and `ReviewStatusBadge` is the right place to close it, since converting
that one component moves every screen that renders a review status at once.

**Route stylesheets still carry their own table CSS.** `app.reviews.module.css` and
`app.requests.module.css` keep their copies, because each adds per-screen column widths, a
checkbox column and a selected-row treatment the `Table` primitive does not have. Migrating
them means teaching `Table` about selection, which is §5.4's "extract on the second caller"
rule pointing the other way — there are now two callers, so this is the next real candidate.

**Total CSS:** ~8,800 lines across 33 files before this pass; 82 lines of now-dead KPI CSS
were deleted from `app._index.module.css` when `Metric` absorbed it. The three other stat-tile
implementations (`app.analytics`, `app.settings.seo`, `app.management`) are unmigrated.

---

## 9. Checklist for a new screen

1. Tokens only. No hex literal, no px font size, no one-off radius.
2. `Container` → `PageHeader` → `Section`s. No new page chrome.
3. Reuse from §5.1 before writing CSS. If you write a second copy of something in §5.1, stop.
4. Data in a `Table` with a complete width plan and an `ariaLabel`.
5. Headline numbers in `Metric`. No trend you cannot compute from real data.
6. Both an empty state and an error state, and they are not the same component.
7. Every transition has a `prefers-reduced-motion` opt-out.
8. Check `--color-brand` is not being used as a text colour.
9. No control that cannot affect anything.
10. Verify: `npm test && npm run typecheck && npm run lint && npm run build`.
