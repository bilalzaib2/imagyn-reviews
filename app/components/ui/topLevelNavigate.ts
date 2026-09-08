// Shared by every real top-level navigation inside the embedded app's own iframe (Settings'
// sidebar, ActionCard's "Configure"/"Manage" buttons, and any future caller with the same
// need) — see app.settings.tsx's own extensive comment for how this was discovered: App
// Bridge intercepts a same-origin <a href> click in this iframe before any of the anchor's own
// handler code (native or scripted) ever runs, confirmed by comparing against production
// request logs showing zero second HTTP request on click. The fix is removing anchor semantics
// entirely — a real <button onClick> with nothing for that interception to match against, then
// a genuine window.location.assign so the browser performs an un-intercepted top-level
// navigation, carrying the current embedded-context query string (host/shop/embedded/id_token/
// session/etc., which all live in the query string, not the path) rather than a bare path that
// would silently drop it.
export interface TopLevelNavigateEvent {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function handleTopLevelNavigate(event: TopLevelNavigateEvent, href: string, search: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  window.location.assign(`${href}${search}`);
}
