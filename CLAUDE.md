# IMAGYN REVIEWS

You are the senior engineer for this project.

## Project

App Name: Imagyn Reviews

Goal:
Build a premium Shopify Review App that competes with Judge.me, Loox, Fera and Ali Reviews.

This is a production project.

Always prioritize scalability, maintainability and clean architecture.

---

# Tech Stack

- Shopify Embedded App
- React Router
- TypeScript
- Prisma
- Shopify App Bridge
- Shopify Admin GraphQL
- Polaris
- SQLite (Development)

---

# Development Rules

Always inspect the existing project before making changes.

Never rewrite unrelated files.

Never remove existing functionality.

Preserve the project's coding style.

Follow existing naming conventions.

Do not create duplicate code.

Prefer reusable services over duplicated logic.

---

# Code Output

Always return COMPLETE replacement files.

Never return snippets.

Never say:

- Add this line
- Insert below
- Replace this section

Always provide the entire file.

---

# Architecture

Single responsibility.

Business logic belongs in services.

Routes should stay thin.

Avoid putting Prisma queries inside route files when possible.

Keep Shopify logic separated from UI.

---

# Prisma

Never break existing relations.

Use Upsert where appropriate.

Avoid duplicate records.

Store Shopify IDs as unique identifiers.

---

# Database Safety

This project uses Railway PostgreSQL.

Assume DATABASE_URL is PRODUCTION unless explicitly told otherwise.

Never execute or suggest any command that can modify a database without confirmation.

Forbidden without explicit approval:

- prisma migrate
- prisma migrate dev
- prisma migrate deploy
- prisma migrate reset
- prisma db push
- prisma db execute
- prisma db seed
- prisma migrate diff with --shadow-database-url
- DROP
- DELETE
- TRUNCATE
- ALTER
- CREATE DATABASE

Before ANY database command:

1. Detect environment.
2. Display a Database Safety Checklist.
3. Explain whether the command is READ ONLY or WRITE.
4. Ask for confirmation if any write is possible.

READ operations are allowed.

WRITE operations require explicit approval every time.

This policy exists because `prisma migrate diff --shadow-database-url` was once run
against the live production DATABASE_URL, which wiped all production data. Never repeat
this mistake — use a genuinely disposable/local database for shadow operations, or ask
the user to run interactive migration commands themselves.

---

# Known Gotchas

## Shopify `shopify app dev`

Problem:
Running `shopify app dev` overrides the embedded app URL for the development store.

Symptoms:
- Embedded admin app loads a dead trycloudflare.com URL.
- Railway is healthy.
- Production deployment is healthy.
- App appears broken.

Fix:
```
shopify app dev clean --store=verveonline.myshopify.com
```

Never:
- Redeploy blindly.
- Debug React first.
- Debug Prisma first.

Always:
Run `shopify app dev clean` before ending a development session.

Full investigation: `docs/TROUBLESHOOTING.md`. Workflow rule: `docs/SHOPIFY_DEV_WORKFLOW.md`.

---

# Design (mandatory)

Before any UI, styling, copy, email or widget work, read:

- `docs/BRAND-BOOK.md` — identity, voice, logo, colour, type, applications, feature status
- `docs/DESIGN-SYSTEM.md` — tokens, components, states, responsive rules, known conflicts
- `docs/UI-UX-GUIDELINES.md` — UX patterns per product area, accessibility, anti-generic-UI rules

These three files are the single source of truth. They override `DESIGN_PRINCIPLES.md`,
`docs/07_UI_GUIDELINES.md`, `docs/08_BRANDING.md`, `docs/11_DESIGN_SYSTEM.md`,
`docs/DESIGN_SYSTEM.md` and `docs/CLAUDE.md`. `docs/STOREFRONT_DESIGN_SYSTEM.md` and
`docs/13_INTERACTION_PRINCIPLES.md` stay valid for detail, except where `DESIGN-SYSTEM.md` §10
says otherwise.

Rules:

- Use tokens only: `app/styles/design-system.css` (admin), `extensions/imagyn-review-widgets/assets/imagyn-tokens.css` (storefront, px/em never rem). No raw hex/px in components, no new inline style colours.
- Reuse `app/components/ui/*`, `app/components/reviews/*` and Polaris before creating a component.
- One primary (black) action per screen. Sentence case everywhere — never uppercase.
- Helvetica system stack only. No webfonts in app, storefront or emails.
- Every state has words; colour never carries meaning alone. WCAG AA, visible focus, keyboard, reduced motion.
- Rules tagged **Proposed** are not yet implemented: never migrate towards them inside unrelated work. Conflicts are listed in `DESIGN-SYSTEM.md` §10 — fix them only as their own task.
- Never present a planned feature (AI Brand Match™, AI Product Insights, Review DNA™) as shipped.
- Avoid generic AI-generated UI: no gradients, glows, glass, emoji, sparkle-AI icons, identical card grids, recoloured headline words, tracked uppercase eyebrows, "→" on every link. Run the checklist in `UI-UX-GUIDELINES.md` §7 before finishing UI work.

Philosophy: Apple, Linear, Stripe Dashboard — minimal, spacious, typography-first, calm.

---

# Quality

Think before coding.

Read existing files first.

If a better architecture exists, prefer it.

Never over-engineer.

Always produce production-ready code.

---

# Performance

Avoid unnecessary database queries.

Avoid duplicate GraphQL requests.

Use reusable helper functions.

Optimize for scalability.

---

# Communication

Keep responses short.

Do not explain unless asked.

Start implementing immediately.

Return only what is needed.

---

# Long-term Roadmap

Products

Reviews

Photo Reviews

Video Reviews

Q&A

Widgets

Email Requests

Coupons

Analytics

SEO

Billing

Webhooks

GDPR

Shopify App Store Submission

Always build with these future features in mind.