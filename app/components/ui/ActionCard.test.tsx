// ActionCard's two non-obvious guarantees.
//
// 1. It is a <button>, not an <a href>, and that is deliberate — App Bridge intercepts a
//    same-origin anchor click inside the embedded iframe before the anchor's own handler ever
//    runs, so a link navigates nowhere. The component's own header documents the production
//    evidence. A later refactor "fixing" it back to an anchor would silently break every
//    Settings entry point, so the shape is pinned here.
//
// 2. Its accessible name is distinct per card. Settings → Overview renders eight ActionCards,
//    six of which show the label "Configure". Listed out of context — which is exactly how a
//    screen reader's element list presents them — those six were indistinguishable.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", () => ({ useLocation: () => ({ search: "?shop=demo.myshopify.com" }) }));

const { ActionCard } = await import("./ActionCard");

const render = (props: Parameters<typeof ActionCard>[0]) => renderToStaticMarkup(<ActionCard {...props} />);

describe("ActionCard", () => {
  it("renders its action as a button, never as a link", () => {
    const html = render({
      title: "Request Scheduling",
      description: "Set when review requests are sent.",
      action: { label: "Configure", href: "/app/settings/requests" },
    });

    expect(html).toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("names the action for the card it belongs to", () => {
    const html = render({
      title: "Publishing & Moderation",
      description: "Control which reviews appear.",
      action: { label: "Manage", href: "/app/settings/moderation" },
    });

    expect(html).toContain('aria-label="Manage Publishing &amp; Moderation"');
  });

  it("keeps the visible label short", () => {
    // The accessible name is the long one; the button a merchant reads stays "Configure".
    const html = render({
      title: "Request Scheduling",
      description: "Set when review requests are sent.",
      action: { label: "Configure", href: "/app/settings/requests" },
    });

    expect(html).toMatch(/>Configure<\/button>/);
  });

  it("gives two cards sharing a label different accessible names", () => {
    const a = render({ title: "Coupons", description: "d", action: { label: "Configure", href: "/a" } });
    const b = render({ title: "Review Rewards", description: "d", action: { label: "Configure", href: "/b" } });

    const nameOf = (html: string) => html.match(/aria-label="([^"]*)"/)?.[1];
    expect(nameOf(a)).not.toBe(nameOf(b));
  });
});
