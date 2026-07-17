# Imagyn Reviews Development Guide

## Philosophy

Build for quality, not speed.

Every feature should be:
- Simple
- Maintainable
- Scalable
- Reusable

Avoid quick hacks.

## Architecture

Follow a component-first architecture.

Never duplicate UI.

Create reusable components whenever possible.

## Folder Organization

components/
    ui/
    layout/
    dashboard/
    reviews/
    shared/

services/

hooks/

utils/

types/

styles/

## Naming

Components:
PascalCase

Example:

ReviewCard.tsx

Functions:
camelCase

Example:

calculateRating()

Constants:
UPPER_SNAKE_CASE

Example:

MAX_REVIEWS

## Styling

Use design tokens.

Avoid hardcoded colors.

Avoid magic spacing values.

Use CSS variables whenever possible.

## Components

Every component should have one responsibility.

Small components are preferred over giant files.

## Performance

Prefer server-side data loading.

Avoid unnecessary re-renders.

Keep JavaScript bundles small.

## Accessibility

Keyboard accessible.

Semantic HTML.

Visible focus states.

Proper labels.

## Rule

Whenever adding a new feature ask:

Can this become reusable?