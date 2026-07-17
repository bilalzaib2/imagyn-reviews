# IMAGYN INFORMATION ARCHITECTURE

---

# 1. Purpose

A merchant forgives an imperfect color palette. A merchant does not forgive not being able to find their own data. Visual design determines how a product looks in a single moment; information architecture determines whether the product makes sense across every moment a merchant spends in it — today, next month, and after they've forgotten exactly how they got somewhere the first time.

Visual polish is what a merchant notices. Information architecture is what a merchant depends on. A beautifully designed screen that lives in the wrong place, or duplicates a concept that already exists somewhere else, does more damage to the product than a plainly styled screen that's exactly where it should be. Visual design can be fixed in an afternoon. A broken structure has to be relearned by every merchant who's already built a mental model of the old one — which means it's rarely fixed at all. It's simply lived with.

This document exists because structure is the part of the product a merchant can't see and therefore can't complain about directly — they just quietly struggle, or quietly leave. Getting it right the first time is the only real option.

---

# 2. Navigation Philosophy

**Keep navigation shallow.** A merchant should never descend more than two or three levels to reach anything they need regularly. Every additional level is a decision point, and every decision point is a place a merchant can second-guess themselves, or simply give up.

**Avoid nested menus unless absolutely necessary.** A nested menu hides its own contents from the merchant until they've already committed to opening it. If a category of navigation needs a submenu to organize it, that's usually a sign the top-level structure has too many things trying to share one home — the fix is almost always a flatter structure, not a deeper one.

**A merchant should never wonder where something lives.** This is the actual test of good navigation: not whether it looks organized, but whether a merchant's first guess about where to find something is correct. If a merchant has to search for a feature they've used before because they can't remember which section it's under, the architecture — not the merchant's memory — has failed.

**Similar concepts should always appear in the same place across all IMAGYN apps.** Settings live in the same relative position in Reviews as they will in Wishlist, in Loyalty, in every product that follows. Team management, billing, notifications — a merchant who has learned where these live in one IMAGYN product should never have to relearn it in another. Consistency across apps is not a nicety; it's what allows the whole ecosystem to feel like one product family instead of a collection of separately-learned tools.

---

# 3. Product Structure

Every IMAGYN app is built from the same structural layers, in the same order, so a merchant's understanding of one product transfers directly to the next.

**Primary Navigation.** The fixed, always-visible map of the product's major areas. This layer answers "what can I do here" at the broadest level and does not change shape based on what a merchant is currently doing.

**Page.** The specific area within primary navigation the merchant has chosen — a bounded workspace with one clear purpose, holding everything relevant to that purpose and nothing that belongs somewhere else.

**Toolbar (only if necessary).** A toolbar exists only when a page genuinely requires actions or filters that apply broadly across its content — search, bulk actions, view options. A page with nothing that needs this treatment should not have an empty toolbar bar taking up space out of habit.

**Main Content.** The primary substance of the page — most often a list, sometimes a dashboard, sometimes a single configuration surface. This is where a merchant's attention should spend the majority of its time, and every other layer exists to serve it, not compete with it.

**Detail Panel.** The focused view of a single item selected from the main content, without navigating away from it. This layer exists specifically so a merchant never loses their place in what they were scanning in order to look closely at one thing.

**Secondary Actions.** Actions that matter but aren't the primary reason a merchant is on this page — visually present but subordinate, reachable without being in the way of the page's main purpose.

Each layer has exactly one job. A layer that starts doing another layer's job — a toolbar that becomes a second content area, a detail panel that requires its own sub-navigation — is a sign the structure has started to bend under a feature that doesn't actually fit it.

---

# 4. Information Hierarchy

Every screen communicates a hierarchy whether it's designed deliberately or not. IMAGYN designs it deliberately, in this order:

**Primary information** — the one or two facts a merchant needs to make sense of what they're looking at (a review's rating and text; a customer's name). This is the first and most visually dominant thing on any given row, card, or panel.

**Secondary information** — context that supports the primary information but isn't the reason the merchant is looking at this item (a submission date, a product name). Present, legible, but visually quieter than the primary information.

**Metadata** — details a merchant needs only occasionally, and only once they've already decided this item matters to them (an internal ID, a verification method, a source). Available on inspection, not competing for attention on first glance.

**Actions** — what a merchant can do with what they're looking at. Visually distinct from information entirely, so a merchant never confuses "something I can act on" with "something I'm just being told."

Merchants scan before they read. They move through a screen the way someone scans a room for the one detail they came in for — hierarchy is what lets that scan land correctly the first time, rather than forcing a merchant to read everything to find the one thing that matters to them right now.

---

# 5. Screen Hierarchy

**Dashboard.** Exists to answer "how is this going" at a glance, and nothing more. A dashboard should exist only where a merchant genuinely benefits from a standing summary they return to repeatedly — not as a mandatory landing page for a product area that doesn't have enough ongoing state to summarize.

**Lists.** The default home for any collection of things a merchant works with repeatedly — reviews, campaigns, team members. If a merchant's core task in an area is "find one of these and do something with it," it belongs on a list.

**Details.** Exist wherever an individual item has enough substance to warrant its own focused view — but as a panel over the list wherever possible (see the *Product Structure* section), reserving a full separate screen only for items complex enough that a panel genuinely can't hold them.

**Settings.** Exist for configuration that is infrequent, store-wide, and not part of any regular workflow. If a merchant is visiting a "settings" area as part of their regular week-to-week work, that configuration was probably misclassified — it belongs closer to the workflow it affects.

**Reports.** Exist specifically for information a merchant wants to review over a time range, export, or share outside the product — distinct from a dashboard's at-a-glance summary. A report is something a merchant goes looking for with a question in mind; a dashboard is something that answers a question before they've asked it.

**Configuration.** Exists for setup that happens rarely — often once — and shapes how the rest of the product behaves afterward (a widget's initial style, a moderation policy). Configuration screens should never need to be revisited as part of routine work; if they do, the thing being configured needed to live inside the workflow it affects, not in a separate configuration area.

Each of these exists to serve a distinct merchant intent. None of them should be built simply because a "complete" product seems to need one — a product area gets a dashboard, a report, or a settings page only when a merchant's real behavior calls for it.

---

# 6. Progressive Disclosure

A screen's first impression should contain exactly what a merchant needs for the most common case, and nothing else. Everything less common — advanced filters, secondary configuration, edge-case options — exists one deliberate step away, reachable but not requiring the merchant to look past it every time they use the common path.

**Visible immediately:** the primary content, the most likely next action, and enough context to make an informed decision about that action.

**Hidden until needed:** anything that serves a less common scenario, anything that only matters after a merchant has already succeeded at the primary task, and any configuration that has a sensible default a merchant doesn't need to think about on day one.

The test is simple: a first-time merchant and an experienced merchant should both be able to do the common task equally quickly, while only the experienced merchant ever needs to go looking for what's underneath. Progressive disclosure fails when a beginner is confronted with expert-level complexity up front — and it also fails when an expert has to dig through unnecessary steps to reach something they use constantly. Both are architecture problems, not just design ones.

---

# 7. Cross-App Consistency

Reviews, Wishlist, Loyalty, Forms, Email, Analytics, and everything IMAGYN builds after them are different products solving different problems — but they are read by the same merchant, in the same browser tab, often in the same working session, and they must feel like rooms in one house.

**What must always remain consistent:**
- The four structural layers described in *Product Structure*, in the same order, every time.
- The relative position of shared concepts — team management, billing, notifications, settings — across every app.
- List behavior, selection behavior, and detail-panel behavior, identical regardless of what kind of item is being listed.
- The vocabulary used for the same concept (a "campaign" is never called something different in one app than another if it means the same thing).

**What is allowed to differ:** the specific content of a page, the specific fields on a form, the specific charts on a report — anything that reflects the actual domain difference between, say, a review and a loyalty point. The architecture is the shared skeleton; the content each product hangs on that skeleton is free to be exactly what that product's problem requires.

A merchant who has never used Loyalty should be able to open it for the first time and already know, from having used Reviews, roughly where everything will be. That transferred familiarity is the entire economic case for building an ecosystem instead of a portfolio of disconnected apps.

---

# 8. Scalability

The architecture is not allowed to grow in proportion to the number of features IMAGYN ships. A tenth product should slot into the same four structural layers as the first one did — new content within an existing shape, not a new shape invented to hold it.

New features are evaluated against the existing structure before any new structure is considered. A new capability should almost always become: a new row type within an existing list, a new section within an existing settings area, a new panel within an existing detail view, or — only when a genuinely new domain of merchant work is being introduced — a new top-level primary navigation item, added sparingly and only at that scale.

The architecture scales by staying the same shape and getting richer inside it, not by adding new shapes. The day a new feature requires inventing a structural pattern that doesn't exist anywhere else in IMAGYN is the day to question whether the feature has been scoped correctly, before questioning whether the architecture needs to change.

---

# 9. Decision Checklist

Before adding any new page or feature, ask:

- **Does it belong here?** Is this the section of the product a merchant would actually look for it in first?
- **Can it live inside an existing workflow?** Does it need its own destination, or does it belong as a step inside something a merchant already does?
- **Can an existing screen handle this instead?** Is a new screen solving a real gap, or duplicating something close enough to an existing one that the two should simply be one?
- **Are we increasing complexity?** Does this addition cost every merchant a small amount of navigation or comprehension, even the ones who never use it?
- **Would removing something make the product better?** Before adding, is there something nearby that should be simplified or removed first, so the addition doesn't compound existing clutter?

If a new page or feature can't clear this checklist, it isn't ready to be built — regardless of how useful it might be in isolation.

---

# 10. Final Principle

We organize information so merchants never have to organize it in their minds.
