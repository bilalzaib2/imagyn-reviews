# Imagyn Reviews — Design System

> **Status:** Single source of truth for tokens, typography, spacing, colour, components, states
> and responsive rules. Read with [`BRAND-BOOK.md`](./BRAND-BOOK.md) (identity) and
> [`UI-UX-GUIDELINES.md`](./UI-UX-GUIDELINES.md) (behaviour). Approved 2026-11-02.
>
> **Established** = in code today, so follow it. **Proposed** = approved direction the code
> does not match yet. Never migrate towards a Proposed value inside unrelated work; see §10.

## 1. Where the system lives

There are three rendering surfaces. Each has **one token file**, and every value comes from it.

| Surface | Token file | Units | Notes |
|---|---|---|---|
| Admin (embedded app) | `app/styles/design-system.css` | rem for type/space/radius, px for borders | Polaris 13 is themed through `--p-color-bg` and `--p-font-family-sans` in the same file. Light only (`color-scheme: light`). |
| Storefront widgets | `extensions/imagyn-review-widgets/assets/imagyn-tokens.css` | **px and em only, never rem** (Dawn sets `html{font-size:62.5%}`) | Assets are served flat, so components use the `imagyn-component-*.css` naming. Base type is in `imagyn-typography.css`, helpers in `imagyn-utilities.css`. |
| Emails | `app/services/notifications/emails/*.tsx` palettes and `email.shared.ts` | px, inline styles (React Email) | Light and dark palettes, merchant fonts from `FONT_STACKS`. |

Merchant customization of the storefront (Brand Studio) is a typed token layer on top:
`AppearanceTokens` in `app/services/appearance.shared.ts`, applied at runtime by
`imagyn-appearance.js`, with presets in `appearance.presets.ts`.

### Precedence among documents

1. This file, `BRAND-BOOK.md` and `UI-UX-GUIDELINES.md`.
2. `docs/STOREFRONT_DESIGN_SYSTEM.md`: the detailed storefront spec. Still valid, except for the
   points listed in §10.
3. `docs/13_INTERACTION_PRINCIPLES.md`: detailed behaviour (selection, panels, forms).
4. Superseded and kept for history only: `DESIGN_PRINCIPLES.md`, `docs/07_UI_GUIDELINES.md`,
   `docs/08_BRANDING.md`, `docs/11_DESIGN_SYSTEM.md`, `docs/DESIGN_SYSTEM.md`, `docs/CLAUDE.md`.

### Hard rules for code

- **No raw values in component CSS.** Use `var(--token)`. Adding a token goes in the surface's
  token file with a comment saying why.
- **No inline style colours.** Route files currently hold 25 hex literals and 64 `style={{}}`
  props. Don't add more; replace them when you touch that code for another reason.
- **Reuse before creating** (§6). A new component needs a reason that no existing one covers.
- **Never edit Polaris internals.** Theme Polaris only through the `--p-*` overrides in
  `design-system.css`.

---

## 2. Colour tokens

### 2.1 Admin (Established)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--color-background` | `#f6f6f8` | Page | |
| `--color-surface` | `#ffffff` | Cards, panels, inputs | |
| `--color-surface-muted` | `#f1f1f4` | Hover fills, inset panels, quiet chips | |
| `--color-surface-strong` | `#e6e6ea` | Pressed and selected fills, disabled chrome | |
| `--color-text` | `#18181b` | Primary text | 17.7:1 on white |
| `--color-text-muted` | `#6a6a73` | Secondary text | 5.3 / 4.9 / 4.7:1 on surface / background / muted |
| `--color-border` | `#e5e5e9` | Hairlines (decorative only) | |
| `--color-border-strong` | `#cecdd4` | Visible borders | |
| `--color-accent` | `#18181b` | Primary buttons, focus ring, selection | |
| `--color-accent-soft` | `#ededf0` | Selected-row fill | |
| `--color-highlight` | `#97a819` | The one accent: earned emphasis, key metric, active plan | Fills only; fails as text on white |
| `--color-highlight-strong` | `#6f7a13` | Accent as text or icon | |
| `--color-highlight-soft` | `#eafbb2` | Accent tint behind `--color-text` | |
| `--color-success` | `#1f7a45` | Success status | |
| `--color-warning` | `#b06a06` | Warning status | |
| `--color-danger` | `#c23b2b` | Errors, destructive actions | |
| `--color-info` | `#3a5bc7` | Integrations and connections (see C-03) | |
| `--color-ai` | `#7a5cc4` | AI-generated content (see C-03) | |

### 2.2 Storefront (Established)

| Token | Value | Use |
|---|---|---|
| `--imagyn-color-text` | `currentColor` | Inherits the theme's text colour |
| `--imagyn-color-text-muted-opacity` | `0.6` | Muted text, applied as opacity |
| `--imagyn-color-star` / `-star-empty` | `#f5a623` / `rgba(0,0,0,.15)` | Stars. Overridden per store by `AppearanceTokens.colors.starColor` / `starEmptyColor`. |
| `--imagyn-color-border` | `rgba(0,0,0,.08)` | Hairlines only |
| `--imagyn-color-fill-subtle` | `color-mix(currentColor 10%)` | Tracks, chips, skeletons. Never reuse the border token as a fill. |
| `--imagyn-color-surface` | `#ffffff` | Cards and modals that must lift off the page |
| `--imagyn-color-success` / `-danger` | `#1a7f4b` / `#c0392b` | Verified and positive vote / validation errors |
| `--imagyn-color-focus` | `#0a0a0a` | Focus ring |

Star legibility is checked filled-against-empty, not against the card
(`checkStarLegibility` in `appearance.shared.ts`). Keep that rule.

### 2.3 Brand palette (Proposed target)

The approved brand book defines the target palette. It applies **now** to new marketing assets
and the design system artifact. It reaches the admin and storefront only through the migrations
listed in §10.

```
ink #0a0a0a · ink-muted #6b6b6b · paper #f1f1f1 · card #fafafa · white #ffffff · line #e0e0e0
brand green #5C9754 (fills only) · brand green deep #487541 (white text on it 5.4:1; green text)
green soft #e7efe4 · forest #0e1710 · forest surface #16221a · sage #9db797
warning #9c5f00 on #fbf1dc · danger #b3261e on #fbe9e7
star default: ink filled over #c4c4c4 empty (merchant-editable)
```

**Mapping when the admin migration happens** (do not apply before then):
- `--color-highlight` → `#5C9754`
- `--color-highlight-strong` → `#487541`
- `--color-highlight-soft` → `#e7efe4`
- the neutral family moves from cool grey to neutral paper/ink
- `--color-info` and `--color-ai` are pending decision C-03

---

## 3. Typography

**Family (Established, locked):**
- Admin: `--font-sans: Helvetica, Arial, sans-serif`.
- Storefront: `--imagyn-font-family`, which uses the theme's `--font-body-family` first (see C-06),
  then Helvetica, Arial and system fonts.
- No webfonts on any of these surfaces.
- **Proposed:** add `"Helvetica Neue"` at the front of the admin and email stacks.
- Geist Sans is allowed on the marketing site only.

### Admin scale (Established, `design-system.css`)

| Token | Size | Typical use |
|---|---|---|
| `--text-xs` | 12px | Metadata, badges, table meta |
| `--text-sm` | 14px | Secondary text, table cells, help text |
| `--text-base` | 16px | Body |
| `--text-lg` | 18px | Card titles |
| `--text-xl` | 20px | Section headers |
| `--text-2xl` | 24px | Sub-page titles |
| `--text-3xl` | 32px | Page titles and headline metrics |

Weights 400 and 600. Body line-height 1.5; headings around 1.2.

### Storefront scale (Established, `imagyn-tokens.css`, px)

12 (xs) · 13 (sm) · 15 (base) · 17 (md) · 20 (lg) · 26 (xl) · 34 (2xl, the section heading only).
Weights 400 / 500 / 600, never 700. Line-height 1 for single-line elements and 1.5 for multi-line.
Letter-spacing 0.01em and 0.02em.

### Marketing scale (Established on reviews.imagyn.co)

| Style | Size / line-height | Weight | Tracking |
|---|---|---|---|
| display | 44 / 44.88 | 600 | -1.98px |
| title | 28 / 30.8 | 600 | -0.98px |
| title-sm | 24 / 27.6 | 600 | -0.72px |
| heading | 18 / 28 | 600 | |
| lead | 18 / 29.25 | 400 | |
| body | 16 / 25.6 | 400 | |
| button | 14.5 / 23.2 | 600 | |

### Rules

- Use sentence case only. Don't add `text-transform: uppercase` (see C-07 for the existing ones).
- Use `font-variant-numeric: tabular-nums` on metrics, counts, prices and dates in tables.
- Headlines are one colour.
- Don't use a monospace face for labels.

## 4. Spacing, radius, borders, elevation

### Spacing

- **Admin:**
  - `--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 ·
    `-12` 48 · `-16` 64
  - Card padding is `--space-6`.
  - Section separation is `--space-8` to `--space-12`.
- **Storefront:**
  - `--imagyn-space-3xs` to `-xl` (0.2em to 2.5em) inside a component.
  - `--imagyn-space-px-xs` to `-xl` (8 to 40px) between components.

### Radius

| Surface | Tokens (Established) |
|---|---|
| Admin | `--radius-sm` 8 · `--radius-md` 12 (buttons) · `--radius-lg` 16 (cards) · `--radius-xl` 20 · `--radius-full` |
| Storefront | `--imagyn-radius-sm` 4 · `-md` 8 · `-lg` 12 · `-full` 999px, overridden by Brand Studio `corners.radius` |
| Brand book (Proposed) | 6 · 10 (buttons, inputs) · 12 (review cards) · 16 (cards) · 28 (marketing panels) · pill |

Rule: radius follows hierarchy (smaller controls, larger containers). Badges, chips and avatars
are pills.

### Borders

- Admin: `1px solid var(--color-border)` for hairlines and `--color-border-strong` for control
  edges.
- Storefront: hairline `rgba(0,0,0,.08)` only, and no border by default.
- Never stack a heavy border and a shadow on the same element.

### Elevation

- **Admin:**
  - `--shadow-sm` `0 1px 2px` at .04 for cards
  - `--shadow-md` `0 4px 16px` at .05 for popovers
  - `--shadow-lg` `0 8px 24px` at .06 for modals
- **Storefront:** `--imagyn-shadow-sm` and `-md`, with blur never above 8px.
- **Marketing:** the large layered shadow (up to 80px blur) is only for the one hero product mock
  in a section.
- There is no dark theme in the admin or storefront. Emails have a dark palette; the brand's
  Forest dark theme is marketing-only (Proposed).

## 5. Interactive states

| State | Admin (Established) | Storefront (Established) |
|---|---|---|
| Hover | Fill shifts one neutral step (`surface` → `surface-muted`); buttons lift `translateY(-1px)` | Opacity or fill change, `--imagyn-duration-fast` |
| Active | `translateY(0)`, 60ms | Same token as hover |
| Focus | `outline: 2px solid var(--color-accent); outline-offset: 2px`, set once globally for `:focus-visible` | `--imagyn-color-focus`, visible on light and dark sections |
| Selected | `--color-accent-soft` fill and a persistent indicator; never hover-only | `aria-pressed` and a filled chip |
| Disabled | `opacity: .5`, `cursor: not-allowed`, no transform or shadow | Same principle |
| Loading | Skeleton matching the content shape; button shows a busy label ("Saving…") and stays disabled | Skeletons (`imagyn-component-skeleton.css`); spinner only on the Write Review submit |
| Error | Field-level message in `--color-danger` with text, plus a Polaris Toast `error` for failed actions | Inline danger text; never colour only |

**Motion tokens:**
- Admin: `--transition-base` 150ms ease-out.
- Storefront: `--imagyn-duration-fast` 120 / `-base` 200 / `-slow` 320, with
  `--imagyn-easing: cubic-bezier(0.22, 1, 0.36, 1)`.
- Every animated rule needs a `prefers-reduced-motion: reduce` variant.
- Don't add new durations; the stray 220 / 300 / 480ms values are debt.

## 6. Components

Always reuse these. Props listed are the real signatures.

### 6.1 Admin, custom (`app/components/ui/`)

| Component | API | Rules |
|---|---|---|
| `Button` | `variant: "primary" \| "secondary" \| "ghost"` (default `secondary`), `fullWidth` | One `primary` per screen (black). `ghost` for tertiary. Labels are verb-first. |
| `LinkButton` | Same variants, renders a router link | Use it for navigation that looks like a button. |
| `Card` | `tone: "default" \| "subtle" \| "quiet"` | `default` white with border, shadow-sm and radius-lg; `subtle` muted fill; `quiet` no chrome. |
| `Section` | `title, description, actions` | Groups settings and content blocks inside a page. |
| `PageHeader` | `eyebrow, title, description, actions` | `eyebrow` must be sentence case and only names the product area (C-07). |
| `Banner` | `tone: "default" \| "warning" \| "success"`, actions, `onDismiss` | Page-level notices only. |
| `EmptyState` | `title, description, action{label,href}` | Never pad with fake rows. Give one real next action. |
| `StatusBadge` | `tone: "success" \| "warning" \| "neutral" \| "pro"` | The label is the state name; tone only reinforces it. Don't mix with Polaris `Badge` on one screen. |
| `ProgressBar` | `percent, label` | Always labelled. |
| `ActionCard` | `title, description, action, badge` | Dashboard and settings entry points. |
| `UpgradePrompt` | `feature, description, benefit, requiredPlanName, billingHref` | The only way to show a plan gate. |
| `ContextualSaveBar` | | Draft, then Save or Discard (Brand Studio, Email Studio, settings). |
| `ColorField` | | Colour inputs with a hex field. |
| `SettingsBreadcrumb` | | Only inside `app.settings.*`. |
| `PillarStatusIcon` | | Trust certification pillar state. |
| `FloatingHelp` | | Support entry, mounted once in `app.tsx`. |

### 6.2 Admin, review domain

- `reviews/StarRating`:
  - ink stars (`--color-text`)
  - interactive when `onChange` is passed
  - `label` is required for accessibility
- Badges: `VerifiedBadge` (only for real order matches), `ImportedBadge`, `FeaturedBadge`,
  `RewardBadge`, `ReviewStatusBadge`, `RequestStatusBadge` (Polaris).
- `RequestLifecycleTimeline`, `ReviewForm`, `medals/Medallion`.

### 6.3 Admin, Polaris

In use: `Frame` + `Toast` (13 files, the standard action feedback), `TextField`, `Select`,
`Checkbox`, `Badge`, `Banner`, `Modal`, `Popover` + `ActionList`, `RangeSlider`. Use Polaris for
platform-native inputs, toasts, modals and popovers. Don't rebuild them.

### 6.4 Component guidance for families without a dedicated custom component

| Family | Use |
|---|---|
| Buttons, icon buttons | `Button`. An icon button is `ghost` plus a visible or `aria-label` name and a 32px minimum target (44px on touch). |
| Inputs, selects, textareas | Polaris `TextField` / `Select` with a visible label, help text below, and the error at the field. |
| Navigation, sidebar | App Bridge `NavMenu` (`app.tsx`: Dashboard, Reviews, Analytics, Settings). Settings sub-navigation is `SettingsBreadcrumb` plus the settings index. Don't add a custom sidebar. |
| Cards, panels | `Card` / `Section`. Detail panels follow `13_INTERACTION_PRINCIPLES.md`. |
| Tables, data lists | Route-level tables in `app.reviews` / `app.requests` styles: sticky header, tabular numbers, row selection opens detail, hover reveals row actions. |
| Modals, drawers | Polaris `Modal`, only for decisions or irreversible confirmations. Storefront uses `imagyn-component-modal.css` / `-drawer.css`, full-screen on mobile. |
| Tooltips, popovers | Polaris `Popover`. Tooltips hold supplementary text only, never required information. |
| Toasts, notifications | Polaris `Toast`. Copy is the past tense of the action ("Review published"). Errors use `error` and say how to fix it. |
| Loading, skeletons | A shape-matched skeleton; no spinner for page loads. |
| Charts, analytics | `app.analytics.tsx` patterns: a headline total, then minimal bars with no axis clutter and start/end labels only. Bars in ink or accent, proportional to real values. No pie charts or 3D. |
| Storefront widgets | `imagyn-component-*` files and the blocks in `extensions/imagyn-review-widgets/blocks/`. Rules are in `STOREFRONT_DESIGN_SYSTEM.md` §16. |
| Email Studio | Email components in `emails/*.tsx`, previewed through the same renderer as the send (`emailTemplate.server.ts`). Logo resolution is in `emailBranding.shared.ts`. |

### 6.5 Brand book reference components (Proposed)

The design system artifact contains reference builds of Button (primary / brand / secondary /
quiet), TextLink, StarRating, RatingBadge, RatingSummary, Badge, Chip, ReviewCard, TrustBadge,
DotLoader, StatCard and SegmentedControl. They show the target look. When building or
redesigning one of these in the app, use the existing component above and move it toward the
reference. Don't copy the reference code in as a second implementation.

## 7. Brand Studio token model (storefront customization)

`AppearanceTokens` categories:
- `typography` (scale 0.9 to 1.15, letterSpacing, fontFamily)
- `spacing` (density)
- `corners` (radius)
- `borders` (width)
- `buttons` (`solid` / `outline` / `ghost`)
- `reviewCards` (separator `spacing` / `border` / `boxed`)
- `cards` (shadowIntensity)
- `colors` (starColor, starEmptyColor and others)

Presets (Minimal, Modern, Editorial, Luxury) set structure only and never `colors`, so a
merchant's accent survives a preset switch. Keep that invariant. Any new token must be:
- added to `AppearanceTokens`
- given a default in `getDefaultAppearanceTokens()`
- applied in `imagyn-appearance.js`
- previewable in `/appearance-preview`

## 8. Responsive rules

**Proposed standard breakpoints** (consolidating the 15 values in the code today):

| Name | Max-width | Use |
|---|---|---|
| `sm` | 480px | Small phones: single column, full-width buttons |
| `md` | 640px | Phones and narrow admin frames: stack two-column layouts (Established in `shared.module.css`) |
| `lg` | 900px | Tablets and narrow desktop: collapse side panels to full view |
| `xl` | 1120px | Admin container (`--container-width`) |

- Use these four for new CSS.
- Leave existing ad-hoc breakpoints (400, 520, 599, 600, 749, 860, 960, 980, 1280px; rem
  queries in widgets) until a responsive pass.
- Storefront rules come from `STOREFRONT_DESIGN_SYSTEM.md` §14: mobile first, 44×44px targets,
  sheet modals, swipe galleries, no layout shift from badges.

## 9. Accessibility floor (all surfaces)

- Text contrast 4.5:1, or 3:1 at 24px and up (19px bold). Borders, focus rings and meaningful
  icons 3:1.
- Every interactive element is keyboard operable with a visible `:focus-visible` ring. Never
  `outline: none` without a replacement.
- Stars always have a text equivalent ("Rated 4.6 out of 5"); glyphs are `aria-hidden`.
- Never use colour alone to carry meaning.
- Reduced motion is honoured everywhere.

## 10. Conflicts between the brand book and the implementation

Decide or migrate deliberately, one item per task. **Do not fix these opportunistically.**

| ID | Area | Brand book | Implementation | Files | Recommendation |
|---|---|---|---|---|---|
| C-01 | Neutrals | paper `#f1f1f1`, ink `#0a0a0a`, muted `#6b6b6b` | cool grey `#f6f6f8`, `#18181b`, `#6a6a73` | `app/styles/design-system.css` | Low visual difference. Migrate with C-02 in one admin colour pass, or accept the admin's cool family as an admin variant. |
| C-02 | Accent | `#5C9754` / `#487541` | chartreuse `#97a819` / `#6f7a13` / `#eafbb2` (23 uses) | `design-system.css`, admin CSS modules | Token swap in one place. Check every `--color-highlight` use for contrast after the swap. |
| C-03 | Info and AI hues | none defined; no blue-purple | `--color-info` `#3a5bc7` (9 uses), `--color-ai` `#7a5cc4` (18 uses) | admin CSS modules | Decide: keep blue for info and fold AI into a neutral treatment with an "AI" text label (matching the storefront AI Summary rule), or keep both and document them. |
| C-04 | Star default | ink filled, grey empty | amber `#f5a623` | `imagyn-tokens.css`, `appearance.shared.ts` defaults | Changing the default affects stores that never set a colour. Apply only to new installs or with a notice. Merchant override stays. |
| C-05 | Focus colour (doc) | ink | code `#0a0a0a`; doc says `#2563eb` | `docs/STOREFRONT_DESIGN_SYSTEM.md` §7 | Update the doc; the code is right. |
| C-06 | Storefront font | Helvetica, consistent across stores | `var(--font-body-family, Helvetica…)` follows the theme | `imagyn-tokens.css` vs `STOREFRONT_DESIGN_SYSTEM.md` §3 | Product decision. The code's "look native" choice is defensible; update whichever is wrong. |
| C-07 | Uppercase | none, anywhere | 54 CSS rules in 23 files, plus 5 email labels | admin CSS modules, `_index/system-preview.module.css`, 3 storefront component CSS files, 4 email components | Replace with sentence case at 600 weight in a single pass. Also drop `--imagyn-letter-spacing-normal`'s "uppercase labels" use. |
| C-08 | Radius | 6 / 10 / 12 / 16 / 28 | admin 8 / 12 / 16 / 20, storefront 4 / 8 / 12 | token files | Keep the storefront as is (merchant-controlled). Consider admin buttons at 10px. Low priority. |
| C-09 | Email contrast | 4.5:1 | `faint` `#a0a0a0` on `#ffffff` = 2.6:1 for 12px footer text (dark `#8b8b93` on `#0e0e10` passes at 5.7:1) | `ReviewRequestEmail.tsx` palettes | Darken light `faint` to `#737373` (4.7:1). This is an accessibility fix, so do it soon. |
| C-10 | Logo colour | green dots `#487541` | black and white only | `public/assets/*`, App Store icon | Decide whether the app icon goes green. Until then, monochrome is correct in the app. |
| C-11 | Promo visuals | one-colour headlines, green accent | App Store images use a blue word accent | `marketing/App Store Listing/*.png` | Regenerate on the next listing refresh. |
| C-12 | Docs drift | | `PROJECT_STATE.md` says Brand Match shipped; `DECISIONS.md` 2026-08-25 says removed | docs | Correct `PROJECT_STATE.md`. |
| C-13 | Breakpoints | 4-step set (§8) | 15 ad-hoc values | CSS | Consolidate in a responsive pass. |
| C-14 | Font stack | Helvetica Neue first | Helvetica, Arial | `design-system.css`, email `FONT_STACKS` | Safe, invisible on most systems. Can ship any time. |
