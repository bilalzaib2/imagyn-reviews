# Imagyn Design System

## Vision
Imagyn apps should feel like Apple, Linear, Notion, and Stripe—not traditional Shopify apps. The goal is to create software that feels calm, intelligent, and premium: clear in structure, expressive in typography, and effortless to use.

This design system should support experiences that are polished by restraint. The interface should feel composed rather than decorated, and every visual decision should serve clarity, trust, and speed.

## Core Principles

### 1. Content First
UI should disappear behind the content. The experience should make the work feel primary and the interface feel secondary.

### 2. Calm Interfaces
No unnecessary borders. No unnecessary colors. No unnecessary buttons. Visual noise should be removed unless it improves clarity or orientation.

### 3. Whitespace is a Feature
Whitespace is not empty space; it is structure. It helps focus attention, creates rhythm, and increases perceived quality. Generous spacing should be used deliberately to create calm and confidence.

### 4. Typography Creates Hierarchy
Type should do the heavy lifting. Good typography creates clear information architecture, communicates priority, and improves readability without requiring visual embellishment.

### 5. Motion is Functional
Animation should feel subtle, purposeful, and fast. Transitions should support understanding, not distract from it.

### 6. One Primary Action Per Screen
Each screen should have one clear primary action. Secondary actions should be visually and conceptually subordinate.

### 7. Progressive Disclosure
Reveal complexity gradually. Present the core path first, then expose deeper controls only when needed.

### 8. Consistency Over Creativity
Consistency creates trust. The system should favor predictable patterns over novelty, even when a more expressive approach might be tempting.

## Spacing Rules
Spacing should be systematic and restrained. The interface should feel composed, never cramped or overly ornamental.

- Use a consistent spacing scale based on 4px increments.
- Favor generous spacing around sections and between related groups of content.
- Use spacing to define hierarchy, not to decorate the layout.
- Avoid arbitrary padding values when a tokenized spacing system can be used.
- Allow breathing room around dense content so that the interface remains calm and legible.

Recommended usage:
- Small compact elements: 8px to 12px
- Standard component spacing: 16px to 24px
- Section separation: 24px to 40px
- Major page structure: 40px to 64px

## Typography Scale
Typography should be quiet, confident, and highly legible. The system should support both dense information and thoughtful reading experiences.

- Display text should be restrained and minimal, with careful tracking and weight.
- Body text should prioritize readability over personality.
- Headings should establish hierarchy without overpowering the content.
- Use a small number of type sizes consistently across the product.

Suggested hierarchy:
- Page title: 28–36px, medium or semibold
- Section header: 18–22px, semibold
- Subheading: 16px, medium
- Body text: 14–16px, regular
- Metadata and secondary text: 12–14px, regular

## Border Radius
Rounded corners should be present, but subtle. The system should feel soft and modern without becoming playful.

- Small controls: 6px to 8px
- Standard containers: 10px to 12px
- Large panels or surfaces: 12px to 16px
- Avoid excessive rounding that weakens clarity or makes UI feel less precise

## Shadows
Shadows should be subtle and functional. They should help with depth and separation, not create visual drama.

- Use shadows sparingly.
- Prefer low-contrast elevation for surfaces that need separation from the page background.
- Avoid heavy shadows that make the UI feel dated or noisy.
- Depth should come from layout, spacing, and structure first.

## Color Philosophy
Color should be used with discipline. The system should feel neutral, trustworthy, and premium rather than loud or heavily branded.

- Base surfaces should be light, clean, and understated.
- Text should have strong contrast and remain highly readable.
- Accent color should be used sparingly for focus, emphasis, and state indication.
- Avoid using color as a substitute for hierarchy or structure.
- The system should support a calm palette that feels refined and modern.

Color should primarily support:
- legibility
- hierarchy
- state communication
- subtle emphasis

## Empty States
Empty states should be calm, helpful, and unobtrusive. They should reduce friction without feeling overly promotional.

- Use clear, concise copy.
- Provide a simple explanation of what is missing and what the user can do next.
- Avoid decorative illustrations unless they genuinely improve understanding.
- Keep the layout spacious and visually quiet.

## Loading States
Loading states should feel immediate and low-friction. The interface should communicate progress without creating anxiety.

- Prefer skeletons or lightweight placeholders for content that is loading.
- Avoid unnecessary spinners for short operations.
- Show state changes clearly and briefly.
- Keep motion subtle and purposeful.

## Forms
Forms should be efficient, calm, and predictable. They should help users complete tasks without feeling interrupted.

- Use clear labels and simple grouping.
- Keep layouts visually quiet and structured.
- Minimize visual clutter around fields.
- Group related controls logically and provide enough spacing to reduce mistakes.
- Use inline validation that is helpful and unobtrusive.
- Avoid excessive decorative elements around form fields.

## Tables
Tables should prioritize scanning and comparison. They should feel precise and dependable.

- Use clear column structure and consistent alignment.
- Keep row density moderate and readable.
- Use subtle dividers or spacing to indicate structure without visual heaviness.
- Make interactive states obvious but restrained.
- Avoid unnecessary visual ornamentation that reduces scanability.

## Lists
Lists should feel clean and easy to scan. They should support quick comprehension rather than visual complexity.

- Use consistent spacing and alignment across rows.
- Highlight selected or active items with understated treatment.
- Keep the hierarchy clear through typography and spacing.
- Avoid overloading rows with multiple competing visual cues.

## Detail Panels
Detail panels should feel like a focused workspace rather than a distraction. They are intended to support deep reading of one item while preserving context.

- Keep the panel visually calm and structured.
- Present the most important information first.
- Use generous spacing and clear type hierarchy.
- Avoid unnecessary controls or clutter.
- The panel should feel like an extension of the main experience, not a separate product inside the product.

## Animations
Motion should be restrained, fast, and purposeful. It should make interaction feel responsive without drawing attention to itself.

- Use short transitions for state changes and panel reveals.
- Favor ease-out motion curves for a refined feel.
- Avoid exaggerated animation or bounce.
- Motion should clarify change, not decorate it.

## Navigation
Navigation should feel lightweight and predictable. It should help users orient themselves without becoming visually dominant.

- Navigation should be clear, concise, and unobtrusive.
- The active state should be visible but not loud.
- Keep primary navigation simple and consistent across the product.
- Secondary navigation should remain subordinate to the main workflow.

## Accessibility
Accessibility is not an afterthought; it is part of the quality bar.

- Ensure strong contrast between text and background.
- Support keyboard navigation for all interactive elements.
- Use semantic structure and clear labels.
- Avoid color-only indicators for meaning.
- Provide sufficient focus states that are visible without being harsh.
- Design for screen readers and reduced-motion preferences.

## Future Component Library
The design system should evolve into a coherent component library over time. Components should be grounded in the same principles as the broader product experience.

Future components should include:
- Page headers
- Empty states
- List rows
- Detail panels
- Form controls
- Table patterns
- Navigation patterns
- Inline selection states
- Loading placeholders
- Utility surfaces for metadata and secondary information

Each component should be designed to be:
- simple
- composable
- consistent
- accessible
- visually restrained

The long-term goal is a design language that feels premium, trustworthy, and deeply usable across the entire Imagyn product surface.
