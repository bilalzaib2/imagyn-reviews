# IMAGYN INTERACTION PRINCIPLES

---

# Introduction

Two products can share every color, every typeface, every spacing token, and still feel like they were built by different companies — because visual consistency and behavioral consistency are not the same thing. A merchant doesn't consciously notice that a button is the correct shade of black. They notice, immediately and viscerally, when a list behaves differently on two different screens, when a panel that used to slide in from the right suddenly navigates them away entirely, when the same action requires a different number of clicks depending on where they are.

Visual consistency makes a product look like one thing. Interaction consistency makes it *feel* like one thing to use. The second is harder to achieve, easier to break, and far more important. A merchant builds a mental model of how IMAGYN works within their first few sessions. Every screen that honors that model is invisible. Every screen that violates it costs them a moment of relearning — and a moment of trust.

This document exists to make sure that mental model, once earned, is never betrayed. It is not a design system. It does not specify colors, spacing, or components. It specifies behavior: how selection works, how navigation works, how a list should feel to scroll through, how a form should feel to fill out — regardless of which product, which screen, or which engineer built it. If a visual design system is the skeleton, this is the nervous system. It's what makes the product move like one animal instead of several stitched together.

---

# Selection

Selection tells a merchant "the product knows what I'm looking at." It must be unambiguous at a glance and never require a second look to confirm.

**How lists behave.** A single click on a row selects it and shows its detail — selection and inspection are the same action, not two. A merchant should never have to click once to select and again to see anything happen.

**How selected items look.** A selected row is distinguished by a persistent, unmistakable visual state — not a flash, not a hover-only effect. It must remain visibly selected even after the merchant's cursor moves away or their attention shifts elsewhere in the interface.

**How focus is maintained.** When a merchant navigates away from a selected item and returns — closing a detail panel, switching a tab, returning from a sub-screen — the selection state is preserved exactly as they left it. Nothing in IMAGYN should silently forget what the merchant was looking at.

**Multi-selection.** Multi-selection is opt-in, never the default interaction. A merchant enters multi-select deliberately (a checkbox appearing on hover, a dedicated toggle) and every selected item is counted and visible in a persistent summary, so the merchant is always certain how many items they're about to act on before they act.

---

# Navigation

Navigation should always answer two questions without the merchant having to think about them: where am I, and how do I get back.

**How users move through the product.** Primary navigation is structural and stable — it does not change shape or reorder itself as the merchant works. Sub-navigation within a section may be contextual, but the primary structure is a fixed map the merchant can build permanent muscle memory around.

**Breadcrumbs.** Breadcrumbs exist only where a merchant can genuinely be more than one level deep in a hierarchy they need to retrace. Each breadcrumb segment is a real, clickable return point — not decoration describing a path that isn't actually navigable.

**Side navigation vs. tabs.** Side navigation is for moving between distinct areas of the product — different domains of work that don't share context. Tabs are for viewing the same object through different lenses — filtered views of one underlying thing. If switching between two views loses the merchant's place in what they were looking at, it should have been side navigation. If it doesn't, it should have been a tab.

**When not to use modals.** A modal is an interruption, and interruption is a cost we charge deliberately, never by default. Modals are reserved for decisions that must be made before the merchant can proceed, or confirmations of something irreversible. Anything else — reviewing detail, editing a record, browsing related information — belongs in a detail panel (see *Detail Panels*) or a full navigable screen, not a modal. A modal that exists because it was the easiest thing to build is a modal that shouldn't exist.

---

# Search

Search is not a feature. It is a shortcut around every other interaction in the product, and it must behave like one.

**Search should always be immediate.** Results appear as the merchant types, not after they press enter. A search that requires an explicit submit step is asking the merchant to trust it before it's proven it deserves that trust.

**Search should reduce work.** The purpose of search is to let a merchant skip navigation entirely. If using search takes as long as clicking through the product's normal structure, search has failed at its one job. Results should be scannable in the same visual language as the lists they're drawn from, so a merchant recognizes what they're looking at instantly, without translating a new results format.

**Philosophy.** Search should never punish an imprecise query with zero results when a close match exists. It should never require a merchant to know which section of the product something lives in before they can find it. A merchant reaching for search has already decided navigation is too slow for this moment — the product's job is to prove them right.

---

# Lists

Lists are where merchants spend most of their time in IMAGYN, and they are scanned, not read. Every decision about a list should optimize for the eye moving quickly, not for information density.

**Cards vs. tables.** Tables are for comparing many items across the same few attributes — when the value is in the columns lining up. Cards are for browsing items that are each individually rich — when the value is in the item itself, not in comparison across a row. If a merchant's task is "find the one that's different," use a table. If it's "find the one I want," use cards.

**Spacing philosophy.** Rows and cards carry enough space to be scanned individually without merging into a visual block, but never so much that a merchant loses their place scrolling past information they've already dismissed. Density is a deliberate choice made per-context, not a single fixed value — a moderation queue processed at volume earns tighter spacing than a browsing experience.

**Hover behavior.** Hover reveals what becomes possible, not what already is. Row actions that aren't relevant until the merchant is considering that specific row appear on hover; information the merchant needs to make that decision is visible without it.

**Selection behavior.** See *Selection* above — lists are the primary place selection happens and must follow that section's rules without exception.

**Empty lists.** An empty list is never a bare, unexplained void. It tells the merchant what would appear here and, where relevant, offers the single most likely next action to populate it (see *Empty States*).

**Loading lists.** A list loads as a skeleton shaped like the content that's coming, not a spinner floating in empty space (see *Loading States*). The merchant should be able to predict the shape of what's arriving before it arrives.

---

# Detail Panels

IMAGYN prefers a side panel that slides in over navigating to a separate page, because navigation makes the merchant leave their context to look at one thing, and a panel lets them inspect one thing without losing the list they were scanning. The list is the merchant's working memory of what they were doing; a full-page navigation erases it every time.

**When they should appear.** A detail panel opens on selection (see *Selection*) — never requiring a separate, additional click after an item is already selected.

**What belongs inside.** Everything a merchant needs to understand and act on this one item, and nothing that requires them to leave the panel to get more context. If a detail panel routinely needs the merchant to also open something else to complete their work, the panel's contents were scoped incorrectly.

**How they close.** A single, obvious action closes the panel — a close control, a click outside its bounds, or the escape key — and returns the merchant to exactly the list state they left, selection and scroll position intact.

**Responsive behavior.** On a narrower viewport where a side-by-side panel can't coexist with the list, the panel takes over the full view rather than compressing illegibly — but it still closes back to the list, never forward to a new page, preserving the same mental model regardless of screen size.

---

# Forms

A form is the moment a merchant is doing the most cognitive work in the entire product. Every principle here exists to lower that load, not add to it.

**How forms should feel.** Short, single-purpose, and honest about what happens next. A form should never ask for more than the current step genuinely requires, and it should never surprise the merchant with a consequence they weren't told about before they submitted.

**Required fields.** Marked clearly and minimized aggressively — a field is required only if the product genuinely cannot function without it, not because it might be useful someday.

**Validation.** Happens as the merchant moves past a field, not only on submit. A merchant should never fill out an entire form only to discover on submission that something near the top was wrong.

**Error messaging.** States exactly what's wrong and exactly what to do about it, at the specific field where the problem is — never a generic banner disconnected from its cause.

**Success feedback.** Confirms the action took effect, briefly and without requiring dismissal — the merchant should never wonder whether their submission actually worked.

**Autosave philosophy.** Where the cost of lost work is real (long-form content, multi-step configuration), IMAGYN saves progress automatically and communicates that it has, quietly, so a merchant never loses work to a closed tab or a lost connection — and never has to wonder whether they need to remember to save.

---

# Buttons

A button is a promise about what will happen. The fewer promises visible on a screen at once, the easier each one is to trust.

**Primary actions.** One per screen. The single action the merchant is most likely to want, visually the most prominent element in its context.

**Secondary actions.** Available, but visually subordinate — present for the merchant who needs them, not competing for attention with the primary action.

**Danger actions.** Visually distinct from both, and never placed where a merchant could reach it by the same motion or muscle memory as a routine action. A destructive action should require a deliberate, separate gesture to reach.

**Button hierarchy.** A screen with three buttons of equal visual weight has given the merchant a puzzle instead of a decision. Hierarchy — through weight, placement, and count — is what makes a screen's next step obvious without a caption explaining it.

**When not to add another button.** Whenever the honest answer to "who is this for" is "an edge case," or when an existing action could be extended to cover the new need instead. A new button is the easiest way to make a screen more complicated and the hardest thing to remove once merchants have learned it's there.

---

# Empty States

**Purpose.** An empty state is not a failure to display data — it's the first thing a merchant sees before they've done anything, and it should teach them what this part of the product is for.

**Tone.** Calm and factual. Explains what will appear here and, where useful, why — never apologetic, never cute for its own sake.

**Illustrations.** Used sparingly, only where they clarify rather than decorate. An illustration that a merchant sees once and never needs again is doing its job; one that competes with the real content every time the list happens to be empty is not.

**Calls to action.** An empty state offers exactly one clear next step when one genuinely exists — never a menu of options masquerading as a single suggestion.

**When to avoid them.** A heavily-designed empty state on a screen a merchant will only see once, briefly, on their way to a populated one is effort spent in the wrong place. Reserve real design investment for empty states merchants will actually encounter and dwell on.

---

# Loading States

**Skeletons.** The default loading treatment for anything with a predictable shape — a list, a panel, a table. The skeleton mirrors the real content's layout so the transition from loading to loaded is a fade of detail, not a jarring layout shift.

**Progress indicators.** Used only for operations with a genuinely knowable duration or step count (an import, an export) — a determinate progress indicator that can show real progress and never fabricates one that isn't backed by real information.

**Optimistic UI.** Where an action's success is near-certain (approving a review, saving a setting), the interface reflects the completed state immediately and reconciles quietly in the background, rather than making the merchant wait for a round-trip to see what they already know is about to happen.

**Never use unnecessary spinners.** A spinner is an admission that we couldn't predict the shape of what's loading. It is the least informative loading state available and is used only when nothing better applies — never as a default reflex for every asynchronous action in the product.

---

# Notifications

**Success.** Brief, quiet, self-dismissing. Confirms without demanding acknowledgment.

**Warning.** Visible and persistent until the merchant has addressed or explicitly dismissed it — reserved for situations that don't block work but genuinely deserve attention before they become a problem.

**Error.** Specific about what failed and what the merchant can do next — never a generic failure notice disconnected from the action that caused it.

**Informational.** The lowest-priority tier, used sparingly enough that merchants don't learn to ignore the notification system altogether.

**When to interrupt.** Only when a merchant's next action depends on information they don't yet have, or when something has happened that they must decide how to handle before continuing.

**When not to interrupt.** For anything the merchant can absorb passively — most success and informational states — a notification that doesn't demand a response respects the fact that the merchant's attention was on something else, and it should stay there.

---

# Motion

Motion exists to answer one question: where did that come from, and where did it go. Every other justification for animation in IMAGYN is secondary to that one.

**How transitions should feel.** Fast enough to never make a merchant wait on the animation itself, and directionally honest — a panel that opens from the right closes to the right; nothing appears from a direction it didn't logically come from.

**When animation should never be used.** As a substitute for a state that should have been instant, as decoration unconnected to any state change, or anywhere it would run repeatedly during a high-frequency task (like processing a moderation queue) and become friction instead of clarity. If removing an animation would leave the interaction's meaning unchanged, the animation should be removed.

---

# Keyboard Support

A merchant who is fast with a keyboard should never be forced back to a mouse by IMAGYN's own limitations.

**Shortcuts.** Provided for the highest-frequency actions in any given context — most notably moderation and list review — and consistent across the product, so a shortcut learned in one place works the same way everywhere it applies.

**Focus.** Always visible, always logical in order, and never lost silently after an action completes (a submitted form, a closed panel) — focus lands somewhere sensible, not back at the top of the page by default.

**Accessibility.** Every interaction available by mouse is available by keyboard, without exception. This is not a supplementary mode for a subset of merchants — it is the same product, navigated a different way.

**Power-user workflow.** For repetitive, high-volume tasks, the keyboard is not an alternative to the primary interaction — it is the primary interaction, with the mouse as the alternative.

---

# Mobile Adaptation

Desktop interactions translate to mobile by preserving their intent, not their exact mechanism. A hover state has no mobile equivalent, so information it revealed must be visible by default or reachable by a tap, never lost entirely. A side-by-side detail panel becomes a full-screen view, but still closes back to the list it came from, never forward to a dead end. Multi-selection, where it exists on mobile at all, uses the same deliberate opt-in gesture as desktop, adapted to touch rather than hover-and-click. Nothing about the mobile experience should require a merchant to relearn what an interaction *means* — only how, physically, to perform it.

---

# Interaction Checklist

Before any interaction ships, it must answer:

- **Is it obvious?** Could a merchant understand what this does without being told?
- **Is it calm?** Does it ask for the merchant's attention only when it's actually earned it?
- **Is it reversible?** Can the merchant recover from doing this by accident?
- **Is it fast?** Does it respond as quickly as the merchant expects to think?
- **Does it reduce thinking?** Does it leave the merchant with less to figure out than before, not more?

If the honest answer to any of these is no, the interaction is not ready — regardless of how complete it looks.

Every interaction should feel inevitable.
